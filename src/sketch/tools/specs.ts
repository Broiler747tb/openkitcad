import { v2, type Vec2 } from '../../core/math'
import { curveOf, entityEnds, pointLookup, tessellate } from '../curves'
import type { Sketch2D, SketchEntity } from '../types'
import {
  alignmentOf,
  arcPolyline,
  arcThrough,
  arcWithRadius,
  circumcircle,
  closed,
  DEG,
  degrees,
  ellipsePolyline,
  freeAnchor,
  keepOrFree,
  perpendicular,
  polar,
  regularPolygon,
  ring,
  signedTurn,
  slotOutline,
  tangentArc,
  TAU,
  wrapAngle,
  type ArcShape,
} from './shapes'
import type {
  FieldKind,
  SketchToolId,
  SketchToolSpec,
  ToolAnchor,
  ToolBuild,
  ToolField,
  ToolFrame,
  ToolState,
  ToolWriter,
} from './types'

const DEFAULT_SIDES = 6

function field(
  state: ToolState,
  id: string,
  label: string,
  kind: FieldKind,
  value: number,
  at: Vec2,
): ToolField {
  return { id, label, kind, value, at, locked: state.locked[id] !== undefined }
}

function idle(cursor: ToolAnchor): ToolFrame {
  return { anchor: cursor, curves: [], construction: [], fields: [] }
}

function lengthOr(state: ToolState, id: string, measured: number): number {
  const locked = state.locked[id]
  return locked !== undefined && locked > 0 ? locked : measured
}

function sidesOf(state: ToolState): number {
  const locked = state.locked.sides ?? state.dims.sides
  return Math.max(3, Math.min(64, Math.round(locked ?? DEFAULT_SIDES)))
}

function segmentFrame(state: ToolState, cursor: ToolAnchor): { end: Vec2; anchor: ToolAnchor } {
  const start = state.anchors[state.anchors.length - 1].point
  const delta = v2.sub(cursor.point, start)
  const lockedAngle = state.locked.angle
  const lockedLength = state.locked.length
  if (lockedAngle === undefined && lockedLength === undefined) {
    return { end: cursor.point, anchor: cursor }
  }
  const angle = lockedAngle !== undefined ? lockedAngle * DEG : Math.atan2(delta[1], delta[0])
  const length = lockedLength !== undefined ? lockedLength : v2.len(delta)
  const end = polar(start, length, angle)
  return { end, anchor: freeAnchor(end, alignmentOf(lockedAngle) ?? cursor.align) }
}

function segmentFields(state: ToolState, start: Vec2, end: Vec2): ToolField[] {
  const delta = v2.sub(end, start)
  return [
    field(state, 'length', 'Length', 'length', v2.len(delta), v2.mid(start, end)),
    field(state, 'angle', 'Angle', 'angle', degrees(Math.atan2(delta[1], delta[0])), start),
  ]
}

function roundConstraint(writer: ToolWriter, anchor: ToolAnchor, entity: string) {
  if (anchor.snapToPointId)
    writer.constrain({ kind: 'pointOnCircle', p: anchor.snapToPointId, e: entity })
}

function lineSide(from: Vec2, to: Vec2, centre: Vec2): 1 | -1 {
  const u = v2.sub(to, from)
  const w = v2.sub(centre, from)
  return w[0] * u[1] - w[1] * u[0] >= 0 ? 1 : -1
}

function pointOf(writer: ToolWriter, id: string): Vec2 {
  const p = writer.sketch.points.find((candidate) => candidate.id === id)!
  return [p.x, p.y]
}

const line: SketchToolSpec = {
  id: 'line',
  label: 'Line',
  menu: 'Line',
  hint: 'Straight lines, one after another. Click the last point again or press Esc to stop.',
  shortcut: 'L',
  prompts: ['Click where the line starts', 'Click the end, or type a length and angle'],
  clicks: 2,
  chain: true,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const start = state.anchors[0].point
    const { end, anchor } = segmentFrame(state, cursor)
    return {
      anchor,
      curves: [[start, end]],
      construction: [],
      fields: segmentFields(state, start, end),
    }
  },
  build(writer, anchors, dims) {
    if (v2.dist(anchors[0].point, anchors[1].point) < 1e-9) return { error: 'same point' }
    const p1 = writer.point(anchors[0])
    const p2 = writer.point(anchors[1])
    if (p1 === p2) return { error: 'same point' }
    const id = writer.entity({ kind: 'line', p1, p2, construction: false })
    if (anchors[1].align === 'horizontal') writer.constrain({ kind: 'horizontal', e: id })
    if (anchors[1].align === 'vertical') writer.constrain({ kind: 'vertical', e: id })
    if (dims.length !== undefined) {
      writer.constrain({ kind: 'distance', a: p1, b: p2, value: dims.length })
    }
    return { chainFrom: p2, chainStart: p1 }
  },
}

function boxLines(writer: ToolWriter, corners: [string, string, string, string]): string[] {
  return corners.map((p1, i) =>
    writer.entity({ kind: 'line', p1, p2: corners[(i + 1) % 4], construction: false }),
  )
}

const rectangle: SketchToolSpec = {
  id: 'rectangle',
  label: '2-Point Rectangle',
  menu: 'Rectangle',
  hint: 'A rectangle square to the sketch, from one corner to the opposite one.',
  shortcut: 'R',
  prompts: ['Click the first corner', 'Click the opposite corner, or type the width and height'],
  clicks: 2,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const a = state.anchors[0].point
    const dx = cursor.point[0] - a[0]
    const dy = cursor.point[1] - a[1]
    const width = lengthOr(state, 'width', Math.abs(dx))
    const height = lengthOr(state, 'height', Math.abs(dy))
    const corner: Vec2 = [a[0] + (Math.sign(dx) || 1) * width, a[1] + (Math.sign(dy) || 1) * height]
    return {
      anchor: keepOrFree(cursor, corner),
      curves: [closed([a, [corner[0], a[1]], corner, [a[0], corner[1]]])],
      construction: [],
      fields: [
        field(state, 'width', 'Width', 'length', width, [(a[0] + corner[0]) / 2, a[1]]),
        field(state, 'height', 'Height', 'length', height, [corner[0], (a[1] + corner[1]) / 2]),
      ],
    }
  },
  build(writer, anchors, dims) {
    const [a, c] = anchors.map((anchor) => anchor.point)
    if (Math.abs(c[0] - a[0]) < 1e-9 || Math.abs(c[1] - a[1]) < 1e-9) {
      return { error: 'A rectangle needs both a width and a height.' }
    }
    const p1 = writer.point(anchors[0])
    const p2 = writer.point([c[0], a[1]])
    const p3 = writer.point(anchors[1])
    const p4 = writer.point([a[0], c[1]])
    const [e1, e2, e3, e4] = boxLines(writer, [p1, p2, p3, p4])
    writer.constrain({ kind: 'horizontal', e: e1 })
    writer.constrain({ kind: 'horizontal', e: e3 })
    writer.constrain({ kind: 'vertical', e: e2 })
    writer.constrain({ kind: 'vertical', e: e4 })
    if (dims.width !== undefined)
      writer.constrain({ kind: 'distance', a: p1, b: p2, value: dims.width })
    if (dims.height !== undefined) {
      writer.constrain({ kind: 'distance', a: p2, b: p3, value: dims.height })
    }
    return {}
  },
}

function thirdCorner(
  a: Vec2,
  b: Vec2,
  cursor: Vec2,
  width?: number,
): { c: Vec2; d: Vec2; w: number } {
  const edge = v2.sub(b, a)
  const length = Math.max(v2.len(edge), 1e-12)
  const normal = v2.scale(perpendicular(edge), 1 / length)
  const offset = v2.dot(v2.sub(cursor, a), normal)
  const w = width !== undefined && width > 0 ? width : Math.abs(offset)
  const shift = v2.scale(normal, (Math.sign(offset) || 1) * w)
  return { c: v2.add(b, shift), d: v2.add(a, shift), w }
}

const rectangle3: SketchToolSpec = {
  id: 'rectangle3',
  label: '3-Point Rectangle',
  menu: 'Rectangle',
  hint: 'A rectangle at any angle: draw one edge, then pull out the width.',
  prompts: ['Click the first corner', 'Click the end of the first edge', 'Click the width'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      const start = state.anchors[0].point
      const { end, anchor } = segmentFrame(state, cursor)
      return {
        anchor,
        curves: [[start, end]],
        construction: [],
        fields: segmentFields(state, start, end),
      }
    }
    const [a, b] = state.anchors.map((anchor) => anchor.point)
    const { c, d, w } = thirdCorner(a, b, cursor.point, state.locked.width)
    return {
      anchor: freeAnchor(c),
      curves: [closed([a, b, c, d])],
      construction: [],
      fields: [field(state, 'width', 'Width', 'length', w, v2.mid(b, c))],
    }
  },
  build(writer, anchors, dims) {
    const [a, b, c] = anchors.map((anchor) => anchor.point)
    const d = v2.add(a, v2.sub(c, b))
    if (v2.dist(a, b) < 1e-9 || v2.dist(b, c) < 1e-9) {
      return { error: 'A rectangle needs both a length and a width.' }
    }
    const p1 = writer.point(anchors[0])
    const p2 = writer.point(anchors[1])
    const p3 = writer.point(c)
    const p4 = writer.point(d)
    const [e1, e2, e3, e4] = boxLines(writer, [p1, p2, p3, p4])
    writer.constrain({ kind: 'perpendicular', a: e1, b: e2 })
    writer.constrain({ kind: 'perpendicular', a: e2, b: e3 })
    writer.constrain({ kind: 'perpendicular', a: e3, b: e4 })
    if (anchors[1].align === 'horizontal') writer.constrain({ kind: 'horizontal', e: e1 })
    if (anchors[1].align === 'vertical') writer.constrain({ kind: 'vertical', e: e1 })
    if (dims.length !== undefined)
      writer.constrain({ kind: 'distance', a: p1, b: p2, value: dims.length })
    if (dims.width !== undefined)
      writer.constrain({ kind: 'distance', a: p2, b: p3, value: dims.width })
    return {}
  },
}

const rectangleCentre: SketchToolSpec = {
  id: 'rectangleCentre',
  label: 'Center Rectangle',
  menu: 'Rectangle',
  hint: 'A rectangle square to the sketch, grown out from its centre.',
  prompts: ['Click the centre', 'Click a corner, or type the width and height'],
  clicks: 2,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const centre = state.anchors[0].point
    const dx = cursor.point[0] - centre[0]
    const dy = cursor.point[1] - centre[1]
    const width = lengthOr(state, 'width', Math.abs(dx) * 2)
    const height = lengthOr(state, 'height', Math.abs(dy) * 2)
    const corner: Vec2 = [
      centre[0] + ((Math.sign(dx) || 1) * width) / 2,
      centre[1] + ((Math.sign(dy) || 1) * height) / 2,
    ]
    const opposite = v2.sub(v2.scale(centre, 2), corner)
    return {
      anchor: keepOrFree(cursor, corner),
      curves: [closed([opposite, [corner[0], opposite[1]], corner, [opposite[0], corner[1]]])],
      construction: [[opposite, corner]],
      fields: [
        field(state, 'width', 'Width', 'length', width, [centre[0], opposite[1]]),
        field(state, 'height', 'Height', 'length', height, [corner[0], centre[1]]),
      ],
    }
  },
  build(writer, anchors, dims) {
    const centre = anchors[0].point
    const corner = anchors[1].point
    if (Math.abs(corner[0] - centre[0]) < 1e-9 || Math.abs(corner[1] - centre[1]) < 1e-9) {
      return { error: 'A rectangle needs both a width and a height.' }
    }
    const opposite = v2.sub(v2.scale(centre, 2), corner)
    const middle = writer.point(anchors[0])
    const p1 = writer.point(opposite)
    const p2 = writer.point([corner[0], opposite[1]])
    const p3 = writer.point(anchors[1])
    const p4 = writer.point([opposite[0], corner[1]])
    const [e1, e2, e3, e4] = boxLines(writer, [p1, p2, p3, p4])
    writer.constrain({ kind: 'horizontal', e: e1 })
    writer.constrain({ kind: 'horizontal', e: e3 })
    writer.constrain({ kind: 'vertical', e: e2 })
    writer.constrain({ kind: 'vertical', e: e4 })
    const diagonal = writer.entity({ kind: 'line', p1, p2: p3, construction: true })
    writer.constrain({ kind: 'midpoint', p: middle, e: diagonal })
    if (dims.width !== undefined)
      writer.constrain({ kind: 'distance', a: p1, b: p2, value: dims.width })
    if (dims.height !== undefined) {
      writer.constrain({ kind: 'distance', a: p2, b: p3, value: dims.height })
    }
    return {}
  },
}

const circle: SketchToolSpec = {
  id: 'circle',
  label: 'Center Diameter Circle',
  menu: 'Circle',
  hint: 'A circle from its centre out to its edge.',
  shortcut: 'C',
  prompts: ['Click the centre', 'Click the edge, or type the diameter'],
  clicks: 2,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const centre = state.anchors[0].point
    const delta = v2.sub(cursor.point, centre)
    const angle = v2.len(delta) > 1e-12 ? Math.atan2(delta[1], delta[0]) : 0
    const radius = lengthOr(state, 'diameter', v2.len(delta) * 2) / 2
    const edge = polar(centre, radius, angle)
    return {
      anchor: keepOrFree(cursor, edge),
      curves: [ring(centre, radius)],
      construction: [[centre, edge]],
      fields: [field(state, 'diameter', 'Diameter', 'length', radius * 2, edge)],
    }
  },
  build(writer, anchors, dims) {
    const radius = v2.dist(anchors[0].point, anchors[1].point)
    if (!(radius > 1e-9))
      return { error: 'The circle needs a size. Click further from the centre.' }
    const c = writer.point(anchors[0])
    const id = writer.entity({ kind: 'circle', c, r: radius, construction: false })
    roundConstraint(writer, anchors[1], id)
    if (dims.diameter !== undefined)
      writer.constrain({ kind: 'diameter', e: id, value: dims.diameter })
    return {}
  },
}

const circle2: SketchToolSpec = {
  id: 'circle2',
  label: '2-Point Circle',
  menu: 'Circle',
  hint: 'A circle across two points that sit opposite each other.',
  prompts: ['Click one side of the circle', 'Click the opposite side, or type the diameter'],
  clicks: 2,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const start = state.anchors[0].point
    const delta = v2.sub(cursor.point, start)
    const angle = v2.len(delta) > 1e-12 ? Math.atan2(delta[1], delta[0]) : 0
    const diameter = lengthOr(state, 'diameter', v2.len(delta))
    const end = polar(start, diameter, angle)
    const centre = v2.mid(start, end)
    return {
      anchor: keepOrFree(cursor, end),
      curves: [ring(centre, diameter / 2)],
      construction: [[start, end]],
      fields: [field(state, 'diameter', 'Diameter', 'length', diameter, centre)],
    }
  },
  build(writer, anchors, dims) {
    const [a, b] = anchors.map((anchor) => anchor.point)
    if (!(v2.dist(a, b) > 1e-9)) return { error: 'The two points have to be apart.' }
    const c = writer.point(v2.mid(a, b))
    const id = writer.entity({ kind: 'circle', c, r: v2.dist(a, b) / 2, construction: false })
    roundConstraint(writer, anchors[0], id)
    roundConstraint(writer, anchors[1], id)
    if (dims.diameter !== undefined)
      writer.constrain({ kind: 'diameter', e: id, value: dims.diameter })
    return {}
  },
}

const circle3: SketchToolSpec = {
  id: 'circle3',
  label: '3-Point Circle',
  menu: 'Circle',
  hint: 'The circle through three points.',
  prompts: ['Click the first point', 'Click the second point', 'Click the third point'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      return { ...idle(cursor), construction: [[state.anchors[0].point, cursor.point]] }
    }
    const fit = circumcircle(state.anchors[0].point, state.anchors[1].point, cursor.point)
    return {
      anchor: cursor,
      curves: fit ? [ring(fit.centre, fit.radius)] : [],
      construction: [[state.anchors[0].point, state.anchors[1].point, cursor.point]],
      fields: fit
        ? [field(state, 'diameter', 'Diameter', 'length', fit.radius * 2, fit.centre)]
        : [],
      blocked: fit ? undefined : 'The three points are in a line.',
    }
  },
  build(writer, anchors) {
    const fit = circumcircle(anchors[0].point, anchors[1].point, anchors[2].point)
    if (!fit) return { error: 'The three points are in a line, so no circle passes through them.' }
    const c = writer.point(fit.centre)
    const id = writer.entity({ kind: 'circle', c, r: fit.radius, construction: false })
    for (const anchor of anchors) roundConstraint(writer, anchor, id)
    return {}
  },
}

function arcEntity(writer: ToolWriter, shape: ArcShape, from: ToolAnchor, to: ToolAnchor): string {
  const c = writer.point(shape.centre)
  const p1 = writer.point(from)
  const p2 = writer.point(to)
  return writer.entity({ kind: 'arc', c, p1, p2, ccw: shape.sweep > 0, construction: false })
}

const arcCentre: SketchToolSpec = {
  id: 'arc',
  label: 'Center Point Arc',
  menu: 'Arc',
  hint: 'An arc around a centre: click the centre, the start, then swing round to the end.',
  prompts: ['Click the centre', 'Click where the arc starts', 'Swing round and click the end'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const centre = state.anchors[0].point
    if (state.anchors.length === 1) {
      const delta = v2.sub(cursor.point, centre)
      const angle = v2.len(delta) > 1e-12 ? Math.atan2(delta[1], delta[0]) : 0
      const radius = lengthOr(state, 'radius', v2.len(delta))
      const start = polar(centre, radius, angle)
      return {
        anchor: keepOrFree(cursor, start),
        curves: [],
        construction: [[centre, start], ring(centre, radius)],
        fields: [field(state, 'radius', 'Radius', 'length', radius, v2.mid(centre, start))],
      }
    }
    const start = state.anchors[1].point
    const radius = v2.dist(centre, start)
    const from = Math.atan2(start[1] - centre[1], start[0] - centre[0])
    const now = Math.atan2(cursor.point[1] - centre[1], cursor.point[0] - centre[0])
    const previous = state.memory.last ?? from
    const turned = (state.memory.turned ?? 0) + signedTurn(now - previous)
    const bounded = Math.max(-TAU + 1e-6, Math.min(TAU - 1e-6, turned))
    const locked = state.locked.angle
    const sweep =
      locked !== undefined ? (Math.sign(bounded) || 1) * Math.min(locked, 359.999) * DEG : bounded
    const end = polar(centre, radius, from + sweep)
    return {
      anchor: {
        ...freeAnchor(end),
        snapToPointId: v2.dist(cursor.point, end) < 1e-9 ? cursor.snapToPointId : null,
        turn: sweep,
      },
      curves: Math.abs(sweep) > 1e-9 ? [arcPolyline(centre, radius, from, sweep)] : [],
      construction: [
        [centre, start],
        [centre, end],
      ],
      fields: [
        field(
          state,
          'angle',
          'Angle',
          'angle',
          Math.abs(sweep) / DEG,
          polar(centre, radius, from + sweep / 2),
        ),
      ],
      memory: { last: now, turned: bounded },
    }
  },
  build(writer, anchors) {
    const [centre, start, end] = anchors.map((anchor) => anchor.point)
    const sweep =
      anchors[2].turn ??
      signedTurn(
        Math.atan2(end[1] - centre[1], end[0] - centre[0]) -
          Math.atan2(start[1] - centre[1], start[0] - centre[0]),
      )
    if (!(v2.dist(centre, start) > 1e-9) || Math.abs(sweep) < 1e-9) {
      return { error: 'The arc needs a radius and some sweep.' }
    }
    const c = writer.point(anchors[0])
    const p1 = writer.point(anchors[1])
    const p2 = writer.point(anchors[2])
    writer.entity({ kind: 'arc', c, p1, p2, ccw: sweep > 0, construction: false })
    return {}
  },
}

const arc3: SketchToolSpec = {
  id: 'arc3',
  label: '3-Point Arc',
  menu: 'Arc',
  hint: 'An arc through its two ends and one point on the way.',
  shortcut: '',
  prompts: ['Click where the arc starts', 'Click where it ends', 'Click a point on the arc'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      return { ...idle(cursor), construction: [[state.anchors[0].point, cursor.point]] }
    }
    const [from, to] = state.anchors.map((anchor) => anchor.point)
    const radius = state.locked.radius
    const shape =
      radius !== undefined
        ? arcWithRadius(from, to, cursor.point, radius)
        : arcThrough(from, to, cursor.point)
    if (!shape)
      return {
        ...idle(cursor),
        construction: [[from, to]],
        blocked: 'Pull the arc away from the straight line.',
      }
    const middle = polar(shape.centre, shape.radius, shape.start + shape.sweep / 2)
    return {
      anchor: freeAnchor(middle),
      curves: [arcPolyline(shape.centre, shape.radius, shape.start, shape.sweep)],
      construction: [],
      fields: [field(state, 'radius', 'Radius', 'length', shape.radius, middle)],
    }
  },
  build(writer, anchors, dims) {
    const shape = arcThrough(anchors[0].point, anchors[1].point, anchors[2].point)
    if (!shape) return { error: 'The three points are in a line.' }
    const id = arcEntity(writer, shape, anchors[0], anchors[1])
    if (dims.radius !== undefined) writer.constrain({ kind: 'radius', e: id, value: dims.radius })
    return {}
  },
}

interface Leaving {
  entity: SketchEntity
  direction: Vec2
}

function leavingAt(sketch: Sketch2D, pointId: string | null): Leaving | null {
  if (!pointId) return null
  const pts = pointLookup(sketch)
  for (const entity of sketch.entities) {
    if (entity.construction) continue
    const ends = entityEnds(entity)
    if (!ends || !ends.includes(pointId)) continue
    const curve = curveOf(entity, pts)
    if (!curve) continue
    const atEnd = ends[1] === pointId
    const d = curve.d1(atEnd ? 1 : 0)
    const direction: Vec2 = atEnd ? d : [-d[0], -d[1]]
    if (v2.len(direction) < 1e-12) continue
    return { entity, direction: v2.norm(direction) }
  }
  return null
}

const arcTangent: SketchToolSpec = {
  id: 'arcTangent',
  label: 'Tangent Arc',
  menu: 'Arc',
  hint: 'An arc that carries straight on from the end of a line or curve.',
  prompts: ['Click the end of a line or curve', 'Click where the arc ends'],
  clicks: 2,
  frame(state, cursor, sketch) {
    if (!state.anchors.length) {
      return leavingAt(sketch, cursor.snapToPointId)
        ? idle(cursor)
        : { ...idle(cursor), blocked: 'Start on the end of a line or curve.' }
    }
    const start = state.anchors[0]
    const leaving = leavingAt(sketch, start.snapToPointId)
    if (!leaving) return idle(cursor)
    const shape = tangentArc(start.point, leaving.direction, cursor.point)
    if (!shape) return { ...idle(cursor), curves: [[start.point, cursor.point]] }
    return {
      anchor: cursor,
      curves: [arcPolyline(shape.centre, shape.radius, shape.start, shape.sweep)],
      construction: [],
      fields: [field(state, 'radius', 'Radius', 'length', shape.radius, cursor.point)],
    }
  },
  build(writer, anchors) {
    const leaving = leavingAt(writer.sketch, anchors[0].snapToPointId)
    if (!leaving) return { error: 'A tangent arc has to start on the end of a line or curve.' }
    const shape = tangentArc(anchors[0].point, leaving.direction, anchors[1].point)
    if (!shape) return { error: 'That end point is straight ahead. Draw a line instead.' }
    const id = arcEntity(writer, shape, anchors[0], anchors[1])
    const other = leaving.entity
    if (other.kind === 'line') {
      writer.constrain({
        kind: 'tangent',
        line: other.id,
        circle: id,
        side: lineSide(pointOf(writer, other.p1), pointOf(writer, other.p2), shape.centre),
      })
    } else if (other.kind === 'arc' || other.kind === 'circle') {
      writer.constrain({ kind: 'tangentArcs', a: other.id, b: id, side: 1 })
    } else {
      writer.constrain({ kind: 'tangentCurves', a: other.id, b: id })
    }
    return {}
  },
}

function polygonFrame(state: ToolState, cursor: ToolAnchor, inscribed: boolean): ToolFrame {
  if (!state.anchors.length) return idle(cursor)
  const centre = state.anchors[0].point
  const delta = v2.sub(cursor.point, centre)
  const angle = v2.len(delta) > 1e-12 ? Math.atan2(delta[1], delta[0]) : Math.PI / 2
  const sides = sidesOf(state)
  const size = lengthOr(state, 'diameter', v2.len(delta) * 2) / 2
  const outer = inscribed ? size : size / Math.cos(Math.PI / sides)
  const first = inscribed ? angle : angle + Math.PI / sides
  const corners = regularPolygon(centre, outer, first, sides)
  const handle = polar(centre, size, angle)
  return {
    anchor: { ...freeAnchor(handle), turn: sides },
    curves: [closed(corners)],
    construction: [ring(centre, size)],
    fields: [
      field(state, 'diameter', 'Diameter', 'length', size * 2, handle),
      field(state, 'sides', 'Sides', 'count', sides, centre),
    ],
  }
}

function buildPolygon(
  writer: ToolWriter,
  centreAnchor: ToolAnchor,
  corners: Vec2[],
  inscribedSize: number | null,
  innerSize: number | null,
  dims: Readonly<Record<string, number>>,
  firstEdge?: [ToolAnchor, ToolAnchor],
): ToolBuild {
  const centre = writer.point(centreAnchor)
  const ids = corners.map((corner, index) =>
    firstEdge && index < 2 ? writer.point(firstEdge[index]) : writer.point(corner),
  )
  if (new Set(ids).size !== ids.length) return { error: 'The polygon is too small.' }
  const edges = ids.map((p1, i) =>
    writer.entity({ kind: 'line', p1, p2: ids[(i + 1) % ids.length], construction: false }),
  )
  const outerRadius = v2.dist(pointOf(writer, centre), corners[0])
  const outer = writer.entity({ kind: 'circle', c: centre, r: outerRadius, construction: true })
  for (const id of ids) writer.constrain({ kind: 'pointOnCircle', p: id, e: outer })
  if (innerSize !== null) {
    const inner = writer.entity({ kind: 'circle', c: centre, r: innerSize, construction: true })
    edges.forEach((edge, i) =>
      writer.constrain({
        kind: 'tangent',
        line: edge,
        circle: inner,
        side: lineSide(corners[i], corners[(i + 1) % corners.length], pointOf(writer, centre)),
      }),
    )
    if (dims.diameter !== undefined)
      writer.constrain({ kind: 'diameter', e: inner, value: dims.diameter })
  } else {
    for (let i = 1; i < edges.length; i++)
      writer.constrain({ kind: 'equal', a: edges[0], b: edges[i] })
    if (inscribedSize !== null && dims.diameter !== undefined) {
      writer.constrain({ kind: 'diameter', e: outer, value: dims.diameter })
    }
    if (firstEdge && dims.length !== undefined) {
      writer.constrain({ kind: 'distance', a: ids[0], b: ids[1], value: dims.length })
    }
  }
  return {}
}

const polygon: SketchToolSpec = {
  id: 'polygon',
  label: 'Circumscribed Polygon',
  menu: 'Polygon',
  hint: 'A regular polygon around a circle: the diameter is measured across the flats.',
  prompts: ['Click the centre', 'Click the middle of an edge, or type the size and sides'],
  clicks: 2,
  frame: (state, cursor) => polygonFrame(state, cursor, false),
  build(writer, anchors, dims) {
    const centre = anchors[0].point
    const handle = anchors[1].point
    const sides = Math.round(anchors[1].turn ?? dims.sides ?? DEFAULT_SIDES)
    const size = v2.dist(centre, handle)
    if (!(size > 1e-9)) return { error: 'The polygon needs a size.' }
    const angle = Math.atan2(handle[1] - centre[1], handle[0] - centre[0])
    const corners = regularPolygon(
      centre,
      size / Math.cos(Math.PI / sides),
      angle + Math.PI / sides,
      sides,
    )
    return buildPolygon(writer, anchors[0], corners, null, size, dims)
  },
}

const polygonInscribed: SketchToolSpec = {
  id: 'polygonInscribed',
  label: 'Inscribed Polygon',
  menu: 'Polygon',
  hint: 'A regular polygon inside a circle: the diameter is measured across the corners.',
  prompts: ['Click the centre', 'Click a corner, or type the size and sides'],
  clicks: 2,
  frame: (state, cursor) => polygonFrame(state, cursor, true),
  build(writer, anchors, dims) {
    const centre = anchors[0].point
    const handle = anchors[1].point
    const sides = Math.round(anchors[1].turn ?? dims.sides ?? DEFAULT_SIDES)
    const size = v2.dist(centre, handle)
    if (!(size > 1e-9)) return { error: 'The polygon needs a size.' }
    const angle = Math.atan2(handle[1] - centre[1], handle[0] - centre[0])
    return buildPolygon(
      writer,
      anchors[0],
      regularPolygon(centre, size, angle, sides),
      size,
      null,
      dims,
    )
  },
}

function edgePolygon(
  a: Vec2,
  b: Vec2,
  side: Vec2,
  sides: number,
): { centre: Vec2; corners: Vec2[] } {
  const edge = v2.sub(b, a)
  const length = v2.len(edge)
  const normal = v2.scale(perpendicular(edge), 1 / Math.max(length, 1e-12))
  const direction = Math.sign(v2.dot(v2.sub(side, a), normal)) || 1
  const apothem = length / (2 * Math.tan(Math.PI / sides))
  const centre = v2.add(v2.mid(a, b), v2.scale(normal, direction * apothem))
  const radius = v2.dist(centre, a)
  const start = Math.atan2(a[1] - centre[1], a[0] - centre[0])
  const turn = direction * (TAU / sides)
  const corners: Vec2[] = []
  for (let k = 0; k < sides; k++) corners.push(polar(centre, radius, start + turn * k))
  return { centre, corners }
}

const polygonEdge: SketchToolSpec = {
  id: 'polygonEdge',
  label: 'Edge Polygon',
  menu: 'Polygon',
  hint: 'A regular polygon built on one edge you draw.',
  prompts: [
    'Click the start of an edge',
    'Click the end of the edge',
    'Click the side it grows on',
  ],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      const start = state.anchors[0].point
      const { end, anchor } = segmentFrame(state, cursor)
      return {
        anchor,
        curves: [[start, end]],
        construction: [],
        fields: [
          ...segmentFields(state, start, end),
          field(state, 'sides', 'Sides', 'count', sidesOf(state), start),
        ],
      }
    }
    const [a, b] = state.anchors.map((anchor) => anchor.point)
    const sides = sidesOf(state)
    const { centre, corners } = edgePolygon(a, b, cursor.point, sides)
    return {
      anchor: { ...freeAnchor(cursor.point), turn: sides },
      curves: [closed(corners)],
      construction: [ring(centre, v2.dist(centre, a))],
      fields: [field(state, 'sides', 'Sides', 'count', sides, centre)],
    }
  },
  build(writer, anchors, dims) {
    const [a, b, side] = anchors.map((anchor) => anchor.point)
    if (!(v2.dist(a, b) > 1e-9)) return { error: 'The edge needs a length.' }
    const sides = Math.round(anchors[2].turn ?? dims.sides ?? DEFAULT_SIDES)
    const { centre, corners } = edgePolygon(a, b, side, sides)
    return buildPolygon(writer, freeAnchor(centre), corners, null, null, dims, [
      anchors[0],
      anchors[1],
    ])
  },
}

const ellipse: SketchToolSpec = {
  id: 'ellipse',
  label: 'Ellipse',
  menu: 'Ellipse',
  hint: 'An ellipse from its centre, the end of its long axis, and a point on its side.',
  prompts: ['Click the centre', 'Click the end of the first axis', 'Click a point on the ellipse'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const centre = state.anchors[0].point
    if (state.anchors.length === 1) {
      const delta = v2.sub(cursor.point, centre)
      const angle = v2.len(delta) > 1e-12 ? Math.atan2(delta[1], delta[0]) : 0
      const major = lengthOr(state, 'major', v2.len(delta) * 2) / 2
      const end = polar(centre, major, angle)
      return {
        anchor: keepOrFree(cursor, end),
        curves: [],
        construction: [[polar(centre, major, angle + Math.PI), end]],
        fields: [field(state, 'major', 'Major Diameter', 'length', major * 2, end)],
      }
    }
    const end = state.anchors[1].point
    const axis = v2.sub(end, centre)
    const rx = v2.len(axis)
    const rotation = Math.atan2(axis[1], axis[0])
    const normal = v2.scale(perpendicular(axis), 1 / Math.max(rx, 1e-12))
    const measured = Math.abs(v2.dot(v2.sub(cursor.point, centre), normal))
    const ry = lengthOr(state, 'minor', measured * 2) / 2
    const side = polar(centre, ry, rotation + Math.PI / 2)
    return {
      anchor: freeAnchor(side),
      curves: [ellipsePolyline(centre, rx, ry, rotation)],
      construction: [[polar(centre, rx, rotation + Math.PI), end]],
      fields: [field(state, 'minor', 'Minor Diameter', 'length', ry * 2, side)],
    }
  },
  build(writer, anchors, dims) {
    const [centre, end, side] = anchors.map((anchor) => anchor.point)
    const axis = v2.sub(end, centre)
    const rx = v2.len(axis)
    const ry = Math.abs(
      v2.dot(v2.sub(side, centre), v2.scale(perpendicular(axis), 1 / Math.max(rx, 1e-12))),
    )
    if (!(rx > 1e-9) || !(ry > 1e-9)) return { error: 'The ellipse needs both axes.' }
    const c = writer.point(anchors[0])
    const id = writer.entity({
      kind: 'ellipse',
      c,
      rx,
      ry,
      rotation: Math.atan2(axis[1], axis[0]) / DEG,
      construction: false,
    })
    if (dims.major !== undefined)
      writer.constrain({ kind: 'diameter', e: id, value: dims.major, axis: 'major' })
    if (dims.minor !== undefined)
      writer.constrain({ kind: 'diameter', e: id, value: dims.minor, axis: 'minor' })
    return {}
  },
}

function buildSlot(
  writer: ToolWriter,
  ends: [ToolAnchor, ToolAnchor],
  halfWidth: number,
  dims: Readonly<Record<string, number>>,
  middle?: ToolAnchor,
): ToolBuild {
  const a = ends[0].point
  const b = ends[1].point
  if (!(v2.dist(a, b) > 1e-9) || !(halfWidth > 1e-9))
    return { error: 'The slot needs a length and a width.' }
  const u = v2.norm(v2.sub(b, a))
  const n = perpendicular(u)
  const c1 = writer.point(ends[0])
  const c2 = writer.point(ends[1])
  const t1 = writer.point(v2.add(a, v2.scale(n, halfWidth)))
  const t2 = writer.point(v2.add(b, v2.scale(n, halfWidth)))
  const b2 = writer.point(v2.sub(b, v2.scale(n, halfWidth)))
  const b1 = writer.point(v2.sub(a, v2.scale(n, halfWidth)))
  const top = writer.entity({ kind: 'line', p1: t1, p2: t2, construction: false })
  const far = writer.entity({ kind: 'arc', c: c2, p1: t2, p2: b2, ccw: false, construction: false })
  const bottom = writer.entity({ kind: 'line', p1: b2, p2: b1, construction: false })
  const near = writer.entity({
    kind: 'arc',
    c: c1,
    p1: b1,
    p2: t1,
    ccw: false,
    construction: false,
  })
  const axis = writer.entity({ kind: 'line', p1: c1, p2: c2, construction: true })
  for (const [line, round] of [
    [top, far],
    [bottom, far],
    [bottom, near],
    [top, near],
  ] as const) {
    writer.constrain({ kind: 'tangent', line, circle: round, side: 1 })
  }
  writer.constrain({ kind: 'equal', a: near, b: far })
  if (middle) writer.constrain({ kind: 'midpoint', p: writer.point(middle), e: axis })
  if (dims.length !== undefined)
    writer.constrain({ kind: 'distance', a: c1, b: c2, value: dims.length })
  if (dims.width !== undefined) writer.constrain({ kind: 'diameter', e: far, value: dims.width })
  return {}
}

function slotWidthFrame(state: ToolState, cursor: ToolAnchor, c1: Vec2, c2: Vec2): ToolFrame {
  const axis = v2.sub(c2, c1)
  const normal = v2.scale(perpendicular(axis), 1 / Math.max(v2.len(axis), 1e-12))
  const half = lengthOr(state, 'width', Math.abs(v2.dot(v2.sub(cursor.point, c1), normal)) * 2) / 2
  const handle = v2.add(c2, v2.scale(normal, half))
  return {
    anchor: freeAnchor(handle),
    curves: half > 1e-9 ? [slotOutline(c1, c2, half)] : [],
    construction: [[c1, c2]],
    fields: [field(state, 'width', 'Width', 'length', half * 2, handle)],
  }
}

function halfWidthOf(c1: Vec2, c2: Vec2, handle: Vec2): number {
  const axis = v2.sub(c2, c1)
  const normal = v2.scale(perpendicular(axis), 1 / Math.max(v2.len(axis), 1e-12))
  return Math.abs(v2.dot(v2.sub(handle, c1), normal))
}

const slot: SketchToolSpec = {
  id: 'slot',
  label: 'Center to Center Slot',
  menu: 'Slot',
  hint: 'A slot measured between the centres of its round ends.',
  prompts: ['Click the first end centre', 'Click the second end centre', 'Click the width'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      const start = state.anchors[0].point
      const { end, anchor } = segmentFrame(state, cursor)
      return {
        anchor,
        curves: [],
        construction: [[start, end]],
        fields: segmentFields(state, start, end),
      }
    }
    return slotWidthFrame(state, cursor, state.anchors[0].point, state.anchors[1].point)
  },
  build(writer, anchors, dims) {
    const half = halfWidthOf(anchors[0].point, anchors[1].point, anchors[2].point)
    return buildSlot(writer, [anchors[0], anchors[1]], half, dims)
  },
}

function overallCentres(a: Vec2, b: Vec2, half: number): [Vec2, Vec2] {
  const u = v2.norm(v2.sub(b, a))
  return [v2.add(a, v2.scale(u, half)), v2.sub(b, v2.scale(u, half))]
}

const slotOverall: SketchToolSpec = {
  id: 'slotOverall',
  label: 'Overall Slot',
  menu: 'Slot',
  hint: 'A slot measured over its whole length, tip to tip.',
  prompts: ['Click one tip', 'Click the other tip', 'Click the width'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    if (state.anchors.length === 1) {
      const start = state.anchors[0].point
      const { end, anchor } = segmentFrame(state, cursor)
      return {
        anchor,
        curves: [],
        construction: [[start, end]],
        fields: segmentFields(state, start, end),
      }
    }
    const [a, b] = state.anchors.map((anchor) => anchor.point)
    const axis = v2.sub(b, a)
    const normal = v2.scale(perpendicular(axis), 1 / Math.max(v2.len(axis), 1e-12))
    const half = Math.min(
      lengthOr(state, 'width', Math.abs(v2.dot(v2.sub(cursor.point, a), normal)) * 2) / 2,
      v2.len(axis) / 2 - 1e-6,
    )
    const [c1, c2] = overallCentres(a, b, Math.max(half, 0))
    const handle = v2.add(c2, v2.scale(normal, half))
    return {
      anchor: freeAnchor(handle),
      curves: half > 1e-9 ? [slotOutline(c1, c2, half)] : [],
      construction: [[a, b]],
      fields: [field(state, 'width', 'Width', 'length', half * 2, handle)],
    }
  },
  build(writer, anchors, dims) {
    const [a, b] = [anchors[0].point, anchors[1].point]
    const half = halfWidthOf(a, b, anchors[2].point)
    if (v2.dist(a, b) <= half * 2 + 1e-9)
      return { error: 'The slot has to be longer than it is wide.' }
    const [c1, c2] = overallCentres(a, b, half)
    const { length: _length, ...rest } = dims
    return buildSlot(writer, [freeAnchor(c1), freeAnchor(c2)], half, rest)
  },
}

const slotCentrePoint: SketchToolSpec = {
  id: 'slotCentrePoint',
  label: 'Center Point Slot',
  menu: 'Slot',
  hint: 'A slot grown out both ways from its middle.',
  prompts: ['Click the middle of the slot', 'Click one end centre', 'Click the width'],
  clicks: 3,
  frame(state, cursor) {
    if (!state.anchors.length) return idle(cursor)
    const middle = state.anchors[0].point
    if (state.anchors.length === 1) {
      const { end, anchor } = segmentFrame(state, cursor)
      const other = v2.sub(v2.scale(middle, 2), end)
      return {
        anchor,
        curves: [],
        construction: [[other, end]],
        fields: segmentFields(state, middle, end),
      }
    }
    const c2 = state.anchors[1].point
    return slotWidthFrame(state, cursor, v2.sub(v2.scale(middle, 2), c2), c2)
  },
  build(writer, anchors, dims) {
    const middle = anchors[0].point
    const c2 = anchors[1].point
    const c1 = v2.sub(v2.scale(middle, 2), c2)
    const half = halfWidthOf(c1, c2, anchors[2].point)
    const { length, ...rest } = dims
    return buildSlot(
      writer,
      [freeAnchor(c1), anchors[1]],
      half,
      length !== undefined ? { ...rest, length: length * 2 } : rest,
      anchors[0],
    )
  },
}

function splinePreview(points: Vec2[], mode: 'fit' | 'control'): Vec2[][] {
  if (points.length < 2) return []
  const pts = new Map(points.map((p, i) => [`q${i}`, p] as const))
  const entity: SketchEntity = {
    id: 'preview',
    kind: 'spline',
    mode,
    points: points.map((_, i) => `q${i}`),
    construction: false,
  }
  const span = Math.max(...points.map((p) => v2.dist(p, points[0])), 1e-3)
  return [tessellate(entity, pts, span * 1e-3)]
}

function splineTool(mode: 'fit' | 'control'): SketchToolSpec {
  return {
    id: mode === 'fit' ? 'spline' : 'splineControl',
    label: mode === 'fit' ? 'Fit Point Spline' : 'Control Point Spline',
    menu: 'Spline',
    hint:
      mode === 'fit'
        ? 'A smooth curve through every point you click. Press Enter or double-click to finish.'
        : 'A smooth curve pulled towards the points you click. Press Enter or double-click to finish.',
    prompts: ['Click the first point', 'Click the next point, Enter or double-click to finish'],
    clicks: 0,
    minimum: 2,
    frame(state, cursor) {
      if (!state.anchors.length) return idle(cursor)
      const points = [...state.anchors.map((anchor) => anchor.point), cursor.point]
      return {
        anchor: cursor,
        curves: splinePreview(points, mode),
        construction: mode === 'control' ? [points] : [],
        fields: [],
      }
    },
    build(writer, anchors) {
      const ids: string[] = []
      for (const anchor of anchors) {
        const id = writer.point(anchor)
        if (ids[ids.length - 1] !== id) ids.push(id)
      }
      if (ids.length < 2) return { error: 'A spline needs at least two points.' }
      writer.entity({ kind: 'spline', mode, points: ids, construction: false })
      return {}
    },
  }
}

const point: SketchToolSpec = {
  id: 'point',
  label: 'Point',
  menu: 'Point',
  hint: 'A single point, for holes, references and construction.',
  prompts: ['Click to place a point'],
  clicks: 1,
  frame: (_state, cursor) => idle(cursor),
  build(writer, anchors) {
    const p = writer.point(anchors[0])
    writer.entity({ kind: 'point', p, construction: false })
    return {}
  },
}

export const SKETCH_TOOLS: readonly SketchToolSpec[] = [
  line,
  rectangle,
  rectangle3,
  rectangleCentre,
  circle,
  circle2,
  circle3,
  arc3,
  arcCentre,
  arcTangent,
  polygon,
  polygonInscribed,
  polygonEdge,
  ellipse,
  slot,
  slotOverall,
  slotCentrePoint,
  splineTool('fit'),
  splineTool('control'),
  point,
]

const BY_ID = new Map(SKETCH_TOOLS.map((tool) => [tool.id, tool]))

export function sketchTool(id: string): SketchToolSpec | undefined {
  return BY_ID.get(id as SketchToolId)
}

export function isSketchTool(id: string): id is SketchToolId {
  return BY_ID.has(id as SketchToolId)
}

export const SKETCH_TOOL_MENUS: ReadonlyArray<{ menu: string; tools: SketchToolSpec[] }> = [
  ...new Set(SKETCH_TOOLS.map((tool) => tool.menu)),
].map((menu) => ({ menu, tools: SKETCH_TOOLS.filter((tool) => tool.menu === menu) }))

export { wrapAngle }
