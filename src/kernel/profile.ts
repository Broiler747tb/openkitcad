import { Blueprint, Blueprints, CompoundBlueprint, Curve2D, Drawing, getOC } from 'replicad'
import type { Vec2 } from '../core/math'
import {
  arcGeometry,
  curveOf,
  ellipseGeometry,
  pointLookup,
  splineGeometry,
  TAU,
  type PointLookup,
} from '../sketch/curves'
import { selectProfiles, type ProfileLoop, type RegionRing } from '../sketch/regions'
import { isTextKey, profileTexts, textKey, winding } from '../sketch/text'
import type { Sketch2D, SketchEntity } from '../sketch/types'
import type { PieceSample } from './naming/profileMatch'
import type { SketchChain } from '../sketch/chains'
import {
  arrangeAreas,
  groupsInteract,
  selfOverlapping,
  textGroup,
  textOutlineGroup,
  type AreaGroup,
  type AreaRing,
  type AreaShape,
} from './textProfile'

export type ProfilePiece = PieceSample

export type ProfileResult =
  | { ok: true; drawing: Drawing; pieces: ProfilePiece[]; loops: number }
  | { ok: false; message: string; hint: string }

type OcAny = any

function track<T extends { delete(): void }>(list: Array<{ delete(): void }>, value: T): T {
  list.push(value)
  return value
}

function axis(oc: OcAny, garbage: Array<{ delete(): void }>, at: Vec2, dir: Vec2) {
  return track(
    garbage,
    new oc.gp_Ax2d_2(
      track(garbage, new oc.gp_Pnt2d_3(at[0], at[1])),
      track(garbage, new oc.gp_Dir2d_4(dir[0], dir[1])),
    ),
  )
}

function curveFromHandle(handle: { delete(): void }): Curve2D {
  const curve = new Curve2D(handle as never)
  handle.delete()
  return curve
}

function trimmed(
  oc: OcAny,
  garbage: Array<{ delete(): void }>,
  conic: unknown,
  kind: 'circle' | 'ellipse',
  t0: number,
  t1: number,
  full: boolean,
): Curve2D {
  if (full) {
    const maker = track(
      garbage,
      kind === 'circle' ? new oc.GCE2d_MakeCircle_1(conic) : new oc.GCE2d_MakeEllipse_1(conic),
    )
    const curve = curveFromHandle(maker.Value())
    if (t1 < t0) curve.wrapped.get().Reverse()
    return curve
  }
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  const maker = track(
    garbage,
    kind === 'circle'
      ? new oc.GCE2d_MakeArcOfCircle_1(conic, lo, hi, true)
      : new oc.GCE2d_MakeArcOfEllipse_1(conic, lo, hi, true),
  )
  const curve = curveFromHandle(maker.Value())
  if (t1 < t0) curve.wrapped.get().Reverse()
  return curve
}

function pieceCurve(
  oc: OcAny,
  entity: SketchEntity,
  pts: PointLookup,
  from: number,
  to: number,
  full: boolean,
  start: Vec2,
  end: Vec2,
): Curve2D {
  const garbage: Array<{ delete(): void }> = []
  try {
    switch (entity.kind) {
      case 'line': {
        const maker = track(
          garbage,
          new oc.GCE2d_MakeSegment_1(
            track(garbage, new oc.gp_Pnt2d_3(start[0], start[1])),
            track(garbage, new oc.gp_Pnt2d_3(end[0], end[1])),
          ),
        )
        return curveFromHandle(maker.Value())
      }
      case 'circle':
      case 'arc': {
        const g =
          entity.kind === 'arc'
            ? arcGeometry(entity, pts)
            : { centre: pts.get(entity.c)!, radius: Math.abs(entity.r), start: 0, sweep: TAU }
        const circle = track(
          garbage,
          new oc.gp_Circ2d_2(axis(oc, garbage, g.centre, [1, 0]), g.radius, true),
        )
        return trimmed(
          oc,
          garbage,
          circle,
          'circle',
          g.start + g.sweep * from,
          g.start + g.sweep * to,
          full,
        )
      }
      case 'ellipse':
      case 'ellipticalArc': {
        const g = ellipseGeometry(entity, pts)
        const swap = g.ry > g.rx
        const rotation = swap ? g.rotation + Math.PI / 2 : g.rotation
        const shift = swap ? -Math.PI / 2 : 0
        const ellipse = track(
          garbage,
          new oc.gp_Elips2d_2(
            axis(oc, garbage, g.centre, [Math.cos(rotation), Math.sin(rotation)]),
            Math.max(g.rx, g.ry),
            Math.min(g.rx, g.ry),
            true,
          ),
        )
        return trimmed(
          oc,
          garbage,
          ellipse,
          'ellipse',
          g.start + g.sweep * from + shift,
          g.start + g.sweep * to + shift,
          full,
        )
      }
      case 'spline': {
        const spline = splineGeometry(entity, pts)
        const poles = track(garbage, new oc.TColgp_Array1OfPnt2d_2(1, spline.ctrl.length))
        spline.ctrl.forEach((p, i) =>
          poles.SetValue(i + 1, track(garbage, new oc.gp_Pnt2d_3(p[0], p[1]))),
        )
        const distinct: number[] = []
        const multiplicity: number[] = []
        for (const knot of spline.knots) {
          if (distinct.length && Math.abs(knot - distinct[distinct.length - 1]) < 1e-12) {
            multiplicity[multiplicity.length - 1]++
          } else {
            distinct.push(knot)
            multiplicity.push(1)
          }
        }
        const knots = track(garbage, new oc.TColStd_Array1OfReal_2(1, distinct.length))
        const mults = track(garbage, new oc.TColStd_Array1OfInteger_2(1, distinct.length))
        distinct.forEach((knot, i) => {
          knots.SetValue(i + 1, knot)
          mults.SetValue(i + 1, multiplicity[i])
        })
        const raw = new oc.Geom2d_BSplineCurve_1(poles, knots, mults, spline.degree, false)
        const handle = new oc.Handle_Geom2d_Curve_2(raw)
        const lo = spline.knots[spline.degree]
        const hi = spline.knots[spline.ctrl.length]
        const u0 = lo + (hi - lo) * Math.min(from, to)
        const u1 = lo + (hi - lo) * Math.max(from, to)
        if (u0 > lo + 1e-12 || u1 < hi - 1e-12) raw.Segment(u0, u1, 1e-9)
        if (to < from) raw.Reverse()
        return curveFromHandle(handle)
      }
      default:
        throw new Error(`A ${entity.kind} cannot bound a profile`)
    }
  } finally {
    for (const item of garbage.reverse()) item.delete()
  }
}

function ringArea(
  oc: OcAny,
  ring: RegionRing,
  byId: Map<string, SketchEntity>,
  pts: PointLookup,
): AreaRing {
  const pieces: ProfilePiece[] = []
  const curves: Curve2D[] = []
  const ends = ring.pieces.map((piece) => {
    const curve = curveOf(byId.get(piece.entityId)!, pts)!
    return [curve.at(piece.from), curve.at(piece.to)] as const
  })
  ring.pieces.forEach((piece, index) => {
    const entity = byId.get(piece.entityId)!
    const start = index === 0 ? ends[0][0] : ends[index - 1][1]
    const end = index === ring.pieces.length - 1 ? ends[0][0] : ends[index][1]
    const full =
      (entity.kind === 'circle' || entity.kind === 'ellipse') &&
      Math.abs(piece.to - piece.from) >= 1 - 1e-9
    curves.push(pieceCurve(oc, entity, pts, piece.from, piece.to, full, start, end))
    pieces.push({ entityId: piece.entityId, token: piece.token, start, end })
  })
  return { curves, pieces, polygon: ring.polygon }
}

export function chainBlueprint(sketch: Sketch2D, chain: SketchChain): Blueprint {
  const oc = getOC() as OcAny
  const pts = pointLookup(sketch)
  const byId = new Map(sketch.entities.map((entity) => [entity.id, entity]))
  const curves = chain.pieces.map((piece) => {
    const entity = byId.get(piece.entityId)!
    const curve = curveOf(entity, pts)!
    const from = piece.reversed ? 1 : 0
    const to = piece.reversed ? 0 : 1
    return pieceCurve(oc, entity, pts, from, to, curve.closed, curve.at(from), curve.at(to))
  })
  return new Blueprint(curves)
}

function regionGroup(oc: OcAny, sketch: Sketch2D, loops: readonly ProfileLoop[]): AreaGroup {
  const pts = pointLookup(sketch)
  const byId = new Map(sketch.entities.map((entity) => [entity.id, entity]))
  const areas = loops.map((loop) => ({
    outer: ringArea(oc, loop.outer, byId, pts),
    holes: loop.holes.map((hole) => ringArea(oc, hole, byId, pts)),
  }))
  return {
    rings: areas.flatMap((area) => [area.outer, ...area.holes]),
    filled: (point) =>
      loops.some(
        (loop) =>
          winding(loop.outer.polygon, point) !== 0 &&
          loop.holes.every((hole) => winding(hole.polygon, point) === 0),
      ),
    shapes: () =>
      areas.map((area) => {
        const outer = new Blueprint(area.outer.curves)
        if (!area.holes.length) return outer
        return new CompoundBlueprint([
          outer,
          ...area.holes.map((hole) => new Blueprint(hole.curves)),
        ])
      }),
  }
}

export function loopsDrawing(
  sketch: Sketch2D,
  loops: readonly ProfileLoop[],
): { drawing: Drawing; pieces: ProfilePiece[] } {
  const group = regionGroup(getOC() as OcAny, sketch, loops)
  const shapes = group.shapes()
  const drawing = new Drawing(shapes.length === 1 ? shapes[0] : new Blueprints(shapes))
  return { drawing, pieces: group.rings.flatMap((ring) => ring.pieces) }
}

function gone(count: number): ProfileResult {
  return {
    ok: false,
    message:
      count === 1
        ? 'A profile this step used is gone from the sketch.'
        : `${count} profiles this step used are gone from the sketch.`,
    hint: 'A curve that bounded it was deleted, or a new curve now splits it. Edit this step and pick the profiles again.',
  }
}

const CANCELLED: ProfileResult = {
  ok: false,
  message: 'The picked profiles cancel each other out.',
  hint: 'Pick the areas again.',
}

export function sketchToProfile(sketch: Sketch2D, keys?: readonly string[]): ProfileResult {
  const pts = pointLookup(sketch)
  const texts = profileTexts(sketch).filter((entity) => pts.has(entity.p))
  const byText = new Map(texts.map((entity) => [textKey(entity.id), entity]))
  const textKeys = keys ? [...new Set(keys.filter(isTextKey))] : [...byText.keys()]
  const regionKeys = keys?.filter((key) => !isTextKey(key))
  const lostTexts = textKeys.filter((key) => !byText.has(key)).length
  const wantsRegions = !keys || !!regionKeys?.length || !textKeys.length
  const selection = wantsRegions ? selectProfiles(sketch, regionKeys) : null
  const regionsFailed = !!selection && !selection.ok && (!!keys || !textKeys.length)
  const missing = lostTexts + (selection && !selection.ok ? selection.missing.length : 0)
  if (missing && (lostTexts || regionsFailed)) return gone(missing)
  if (selection && !selection.ok && regionsFailed) {
    return {
      ok: false,
      message: keys ? 'No profile is picked.' : 'That sketch does not enclose an area yet.',
      hint: keys
        ? 'Edit this step and click the areas of the sketch to use.'
        : selection.dangling.length
          ? `${selection.dangling.length} curve(s) do not join up into a closed shape. Zoom in on the corners and drag the loose ends together.`
          : 'Draw a closed shape - a rectangle or circle - before extruding.',
    }
  }
  const loops = selection?.ok ? selection.loops : []
  if (!loops.length && !textKeys.length) return CANCELLED
  const oc = getOC() as OcAny
  const region = loops.length ? regionGroup(oc, sketch, loops) : null
  const chosen = textKeys.map((key) => {
    const entity = byText.get(key)!
    return textGroup(oc, entity, pts.get(entity.p)!)
  })
  const others = region
    ? texts
        .filter((entity) => !textKeys.includes(textKey(entity.id)))
        .filter((entity) => groupsInteract(textOutlineGroup(entity, pts.get(entity.p)!), region))
        .map((entity) => textGroup(oc, entity, pts.get(entity.p)!))
    : []
  const groups = [...(region ? [region] : []), ...chosen]
  const tangled =
    others.length > 0 ||
    chosen.some(selfOverlapping) ||
    groups.some((group, i) => groups.slice(i + 1).some((other) => groupsInteract(group, other)))
  let shapes: AreaShape[]
  let pieces: ProfilePiece[]
  if (!tangled) {
    shapes = groups.flatMap((group) => group.shapes())
    pieces = groups.flatMap((group) => group.rings.flatMap((ring) => ring.pieces))
  } else {
    try {
      const arranged = arrangeAreas(
        oc,
        [...groups, ...others],
        (point) =>
          (!!region?.filled(point) && !others.some((other) => other.filled(point))) ||
          chosen.some((text) => text.filled(point)),
      )
      shapes = arranged.shapes
      pieces = arranged.pieces
    } catch {
      return {
        ok: false,
        message: 'The text and the picked areas could not be combined.',
        hint: 'Move the text so its letters do not cross other curves, or pick another font.',
      }
    }
  }
  if (!shapes.length) return CANCELLED
  const drawing = new Drawing(shapes.length === 1 ? shapes[0] : new Blueprints(shapes))
  return { ok: true, drawing, pieces, loops: shapes.length }
}
