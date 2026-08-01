/**
 * What you can do to the current sketch selection.
 *
 * The whole point of this file is that a beginner should never have to know the
 * word "constraint", let alone which of seventeen kinds applies. They point at
 * two lines, right-click, and the menu offers "Parallel" and "Square" because
 * those are the only things that make sense for two lines. Anything that does
 * not apply is simply not there.
 *
 * Pure on purpose: given a sketch and a selection this returns a list, with no
 * reference to React, the store or the kernel, so it can be unit tested.
 */
import { v2, type Vec2 } from '../core/math'
import { findCorner, maxChamferDistance, maxFilletRadius } from './corner'
import type { SketchTarget } from './inference'
import type { NewConstraint, Sketch2D, SketchEntity } from './types'

export type ActionResult =
  | { kind: 'constraint'; constraint: NewConstraint }
  | { kind: 'deleteEntity'; entityId: string }
  | { kind: 'deletePoint'; pointId: string }
  | { kind: 'toggleConstruction'; entityId: string }
  | { kind: 'deleteConstraint'; constraintId: string }
  | { kind: 'filletCorner'; pointId: string; radius: number }
  | { kind: 'chamferCorner'; pointId: string; distance: number }
  | { kind: 'trim'; entityId: string; at: Vec2 }
  | {
      kind: 'filletBetween'
      aId: string
      bId: string
      radius: number
      cursor: Vec2
    }
  | {
      kind: 'linearPattern'
      entityIds: string[]
      count: number
      dx: number
      dy: number
    }
  | {
      kind: 'mirror'
      entityIds: string[]
      axis: 'vertical' | 'horizontal'
    }
  | { kind: 'offset'; entityIds: string[]; distance: number }
  | { kind: 'addPolygon'; centre: Vec2; sides: number; radius: number }
  | { kind: 'addSlot'; centre: Vec2; length: number; width: number }
  | {
      kind: 'circularPattern'
      entityIds: string[]
      count: number
      centre: Vec2
      totalAngle: number
    }

export interface PromptField {
  label: string
  initial: number
  unit: string
}

export interface SketchAction {
  id: string
  label: string
  /** Heading this sits under in the menu. Derived from the id, see groupOf. */
  group?: string
  /** One line under the label, in plain English. */
  hint?: string
  /** When set, the menu asks for a number before applying. */
  prompt?: PromptField
  /** A second number, for the handful of things that genuinely need two. */
  prompt2?: PromptField
  build: (value: number, value2?: number) => ActionResult
}


/**
 * Which heading each action belongs under.
 *
 * Derived from the action id rather than set at every call site: the list is
 * then in one place where the grouping can be read at a glance, and adding an
 * action cannot silently land it in the wrong section.
 */
const SKETCH_GROUPS: Array<[string, string[]]> = [
  [
    'Hold it in place',
    [
      'horizontal',
      'vertical',
      'parallel',
      'perpendicular',
      'equal',
      'equal-radius',
      'tangent',
      'coincident',
      'fix',
      'point-on-line',
      'point-on-circle',
      'midpoint',
      'symmetric',
    ],
  ],
  ['Set a size', ['length', 'diameter', 'radius', 'angle', 'distance', 'distanceX', 'distanceY']],
  [
    'Change the shape',
    ['fillet-corner', 'chamfer-corner', 'fillet-between', 'trim', 'construction', 'delete'],
  ],
  ['Repeat or copy', ['linear-pattern', 'circular-pattern', 'mirror-vertical', 'mirror-horizontal', 'offset']],
  ['Add a shape', ['add-polygon', 'add-slot']],
]

/** Section names in the order the menu lists them. */
export const SKETCH_GROUP_ORDER = SKETCH_GROUPS.map(([name]) => name)

export function groupOf(id: string): string {
  for (const [group, ids] of SKETCH_GROUPS) {
    if (ids.includes(id)) return group
  }
  return 'Other'
}

const lines = (entities: SketchEntity[]) => entities.filter((e) => e.kind === 'line')
const rounds = (entities: SketchEntity[]) =>
  entities.filter((e) => e.kind === 'circle' || e.kind === 'arc')

function radiusOf(entity: SketchEntity, pts: Map<string, Vec2>): number {
  if (entity.kind === 'circle') return entity.r
  if (entity.kind === 'arc') return v2.dist(pts.get(entity.c)!, pts.get(entity.p1)!)
  return 0
}

/**
 * Which side of a line a circle sits on, so a tangent constraint holds it where
 * the user can already see it rather than flipping it across.
 */
function tangentSide(
  line: Extract<SketchEntity, { kind: 'line' }>,
  circleCentre: Vec2,
  pts: Map<string, Vec2>,
): 1 | -1 {
  const a = pts.get(line.p1)!
  const b = pts.get(line.p2)!
  const cross = v2.cross(v2.sub(circleCentre, a), v2.sub(b, a))
  return cross >= 0 ? 1 : -1
}

export function sketchActions(
  sketch: Sketch2D,
  selection: SketchTarget[],
  /** Where the user right-clicked, needed by trim to know which piece to cut. */
  cursor?: Vec2,
): SketchAction[] {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const pointIds = selection.filter((s) => s.kind === 'point').map((s) => s.id)
  const entities = selection
    .filter((s) => s.kind === 'entity')
    .map((s) => sketch.entities.find((e) => e.id === s.id))
    .filter((e): e is SketchEntity => !!e)

  const out: SketchAction[] = []
  const push = (a: SketchAction) => out.push({ ...a, group: groupOf(a.id) })
  const constraint = (c: NewConstraint): ActionResult => ({ kind: 'constraint', constraint: c })

  const straight = lines(entities)
  const curved = rounds(entities)

  // ---- one line ----------------------------------------------------------
  if (straight.length === 1 && entities.length === 1 && pointIds.length === 0) {
    const line = straight[0] as Extract<SketchEntity, { kind: 'line' }>
    const a = pts.get(line.p1)!
    const b = pts.get(line.p2)!
    push({
      id: 'horizontal',
      label: 'Make horizontal',
      hint: 'Lock it flat, left to right',
      build: () => constraint({ kind: 'horizontal', e: line.id }),
    })
    push({
      id: 'vertical',
      label: 'Make vertical',
      hint: 'Lock it straight up and down',
      build: () => constraint({ kind: 'vertical', e: line.id }),
    })
    push({
      id: 'length',
      label: 'Set its length',
      hint: 'Freeze how long it is',
      prompt: { label: 'Length', initial: Math.round(v2.dist(a, b) * 1000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'distance', a: line.p1, b: line.p2, value }),
    })
    push({
      id: 'construction',
      label: line.construction ? 'Make it a real edge' : 'Use only as a guide',
      hint: line.construction
        ? 'It will become part of the shape again'
        : 'Helps you line things up, but is not part of the shape',
      build: () => ({ kind: 'toggleConstruction', entityId: line.id }),
    })
    if (cursor) {
      push({
        id: 'trim',
        label: 'Trim this piece away',
        hint: 'Cuts back to where it crosses something else',
        build: () => ({ kind: 'trim', entityId: line.id, at: cursor }),
      })
    }
    push({
      id: 'delete',
      label: 'Delete this line',
      build: () => ({ kind: 'deleteEntity', entityId: line.id }),
    })
  }

  // ---- two lines ---------------------------------------------------------
  if (straight.length === 2 && entities.length === 2) {
    const [l1, l2] = straight as Array<Extract<SketchEntity, { kind: 'line' }>>
    push({
      id: 'parallel',
      label: 'Make parallel',
      hint: 'Keep them running the same way',
      build: () => constraint({ kind: 'parallel', a: l1.id, b: l2.id }),
    })
    push({
      id: 'perpendicular',
      label: 'Make square',
      hint: 'Hold them at a right angle',
      build: () => constraint({ kind: 'perpendicular', a: l1.id, b: l2.id }),
    })
    push({
      id: 'equal',
      label: 'Make the same length',
      build: () => constraint({ kind: 'equal', a: l1.id, b: l2.id }),
    })
    const d1 = v2.sub(pts.get(l1.p2)!, pts.get(l1.p1)!)
    const d2 = v2.sub(pts.get(l2.p2)!, pts.get(l2.p1)!)
    const current = Math.abs(
      (Math.atan2(v2.cross(d1, d2), v2.dot(d1, d2)) * 180) / Math.PI,
    )
    push({
      id: 'angle',
      label: 'Set the angle between them',
      prompt: { label: 'Angle', initial: Math.round(current * 10) / 10, unit: 'deg' },
      build: (value) => constraint({ kind: 'angle', a: l1.id, b: l2.id, value }),
    })
  }

  // ---- one circle or arc -------------------------------------------------
  if (curved.length === 1 && entities.length === 1 && pointIds.length === 0) {
    const circle = curved[0]
    const r = radiusOf(circle, pts)
    push({
      id: 'diameter',
      label: 'Set the diameter',
      hint: 'The measurement across the whole circle',
      prompt: { label: 'Diameter', initial: Math.round(r * 2000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'diameter', e: circle.id, value }),
    })
    push({
      id: 'radius',
      label: 'Set the radius',
      hint: 'The measurement from the centre out',
      prompt: { label: 'Radius', initial: Math.round(r * 1000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'radius', e: circle.id, value }),
    })
    if (circle.kind === 'circle') {
      push({
        id: 'construction',
        label: circle.construction ? 'Make it a real edge' : 'Use only as a guide',
        build: () => ({ kind: 'toggleConstruction', entityId: circle.id }),
      })
    }
    if (cursor) {
      push({
        id: 'trim',
        label: 'Trim this piece away',
        hint: 'Cuts back to where it crosses something else',
        build: () => ({ kind: 'trim', entityId: circle.id, at: cursor }),
      })
    }
    push({
      id: 'delete',
      label: 'Delete this circle',
      build: () => ({ kind: 'deleteEntity', entityId: circle.id }),
    })
  }

  // ---- two circles -------------------------------------------------------
  if (curved.length === 2 && entities.length === 2) {
    push({
      id: 'equal-radius',
      label: 'Make the same size',
      build: () => constraint({ kind: 'equal', a: curved[0].id, b: curved[1].id }),
    })
  }

  // ---- a line and a circle ----------------------------------------------
  if (straight.length === 1 && curved.length === 1 && entities.length === 2) {
    const line = straight[0] as Extract<SketchEntity, { kind: 'line' }>
    const circle = curved[0]
    push({
      id: 'tangent',
      label: 'Make them touch smoothly',
      hint: 'The line will just graze the circle',
      build: () =>
        constraint({
          kind: 'tangent',
          line: line.id,
          circle: circle.id,
          side: tangentSide(line, pts.get(circle.c)!, pts),
        }),
    })
  }

  // ---- one point ---------------------------------------------------------
  if (pointIds.length === 1 && entities.length === 0) {
    const id = pointIds[0]
    const p = pts.get(id)!

    // Where two lines meet, offer to soften it. Suggest something proportional
    // to the corner rather than a fixed 2 mm, which would be silly on a 500 mm
    // frame and impossible on a 3 mm tab.
    const corner = findCorner(sketch, id)
    if (corner) {
      const roomFillet = maxFilletRadius(corner)
      const roomChamfer = maxChamferDistance(corner)
      push({
        id: 'fillet-corner',
        label: 'Round this corner',
        hint: 'Replaces the sharp corner with a curve',
        prompt: {
          label: 'Radius',
          initial: Math.max(0.5, Math.round(Math.min(roomFillet * 0.35, 5) * 10) / 10),
          unit: 'mm',
        },
        build: (radius) => ({ kind: 'filletCorner', pointId: id, radius }),
      })
      push({
        id: 'chamfer-corner',
        label: 'Cut this corner off',
        hint: 'Replaces the sharp corner with a flat',
        prompt: {
          label: 'Size',
          initial: Math.max(0.5, Math.round(Math.min(roomChamfer * 0.35, 5) * 10) / 10),
          unit: 'mm',
        },
        build: (distance) => ({ kind: 'chamferCorner', pointId: id, distance }),
      })
    }

    if (id !== 'origin') {
      push({
        id: 'fix',
        label: 'Pin it in place',
        hint: 'Nothing will move this corner again',
        build: () => constraint({ kind: 'fix', p: id, x: p[0], y: p[1] }),
      })
    }
  }

  // ---- two points --------------------------------------------------------
  if (pointIds.length === 2 && entities.length === 0) {
    const [a, b] = pointIds
    const pa = pts.get(a)!
    const pb = pts.get(b)!
    push({
      id: 'coincident',
      label: 'Join them together',
      hint: 'Treat the two corners as one',
      build: () => constraint({ kind: 'coincident', a, b }),
    })
    push({
      id: 'distance',
      label: 'Set the distance apart',
      prompt: { label: 'Distance', initial: Math.round(v2.dist(pa, pb) * 1000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'distance', a, b, value }),
    })
    push({
      id: 'distanceX',
      label: 'Set the distance across',
      hint: 'Left-to-right gap only',
      prompt: { label: 'Across', initial: Math.round((pb[0] - pa[0]) * 1000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'distanceX', a, b, value }),
    })
    push({
      id: 'distanceY',
      label: 'Set the distance up',
      hint: 'Up-and-down gap only',
      prompt: { label: 'Up', initial: Math.round((pb[1] - pa[1]) * 1000) / 1000, unit: 'mm' },
      build: (value) => constraint({ kind: 'distanceY', a, b, value }),
    })
  }

  // ---- a point and a line ------------------------------------------------
  if (pointIds.length === 1 && straight.length === 1 && entities.length === 1) {
    const p = pointIds[0]
    const line = straight[0] as Extract<SketchEntity, { kind: 'line' }>
    if (p !== line.p1 && p !== line.p2) {
      push({
        id: 'point-on-line',
        label: 'Put it on the line',
        hint: 'It can slide along, but never off',
        build: () => constraint({ kind: 'pointOnLine', p, e: line.id }),
      })
      push({
        id: 'midpoint',
        label: 'Put it at the middle',
        build: () => constraint({ kind: 'midpoint', p, e: line.id }),
      })
    }
  }

  // ---- a point and a circle ----------------------------------------------
  if (pointIds.length === 1 && curved.length === 1 && entities.length === 1) {
    push({
      id: 'point-on-circle',
      label: 'Put it on the circle',
      build: () => constraint({ kind: 'pointOnCircle', p: pointIds[0], e: curved[0].id }),
    })
  }

  // ---- two edges of any kind: round where they meet -----------------------
  if (entities.length === 2 && pointIds.length === 0 && cursor) {
    const [e1, e2] = entities
    const suggested = 3
    push({
      id: 'fillet-between',
      label: 'Round where these meet',
      hint: 'Works even if they only cross, or do not touch at all',
      prompt: { label: 'Radius', initial: suggested, unit: 'mm' },
      build: (radius) => ({
        kind: 'filletBetween',
        aId: e1.id,
        bId: e2.id,
        radius,
        cursor,
      }),
    })
  }

  // ---- repeating whatever is selected ------------------------------------
  if (entities.length >= 1) {
    const ids = entities.map((e) => e.id)
    // Work out how wide the selection is, so the suggested spacing clears it
    // instead of stacking every copy on top of the last.
    let minX = Infinity
    let maxX = -Infinity
    for (const e of entities) {
      const touching =
        e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'arc' ? [e.c, e.p1, e.p2] : [e.c]
      for (const id of touching) {
        const p = pts.get(id)
        if (!p) continue
        const pad = e.kind === 'circle' ? e.r : 0
        minX = Math.min(minX, p[0] - pad)
        maxX = Math.max(maxX, p[0] + pad)
      }
    }
    const width = Number.isFinite(minX) ? maxX - minX : 10
    const suggested = Math.max(5, Math.round((width + 5) * 10) / 10)

    push({
      id: 'linear-pattern',
      label: 'Repeat in a row',
      hint: 'Evenly spaced copies, held in place by their spacing',
      prompt: { label: 'How many', initial: 4, unit: 'total' },
      prompt2: { label: 'Spacing', initial: suggested, unit: 'mm' },
      build: (count, spacing) => ({
        kind: 'linearPattern',
        entityIds: ids,
        count: Math.round(count),
        dx: spacing ?? suggested,
        dy: 0,
      }),
    })
    push({
      id: 'offset',
      label: 'Make a parallel copy',
      hint: 'A second outline a fixed distance away',
      prompt: { label: 'Distance', initial: 3, unit: 'mm' },
      build: (distance) => ({ kind: 'offset', entityIds: ids, distance }),
    })
    push({
      id: 'mirror-vertical',
      label: 'Mirror left to right',
      hint: 'Reflects across the upright axis through the origin',
      build: () => ({ kind: 'mirror', entityIds: ids, axis: 'vertical' }),
    })
    push({
      id: 'mirror-horizontal',
      label: 'Mirror top to bottom',
      hint: 'Reflects across the flat axis through the origin',
      build: () => ({ kind: 'mirror', entityIds: ids, axis: 'horizontal' }),
    })
    push({
      id: 'circular-pattern',
      label: 'Repeat in a ring',
      hint: 'Copies swung around the sketch origin, for a bolt circle',
      prompt: { label: 'How many', initial: 6, unit: 'total' },
      prompt2: { label: 'Around', initial: 360, unit: 'deg' },
      build: (count, angle) => ({
        kind: 'circularPattern',
        entityIds: ids,
        count: Math.round(count),
        centre: pts.get('origin') ?? [0, 0],
        totalAngle: angle ?? 360,
      }),
    })
  }

  // ---- nothing picked: drop in a ready-made shape -------------------------
  if (selection.length === 0 && cursor) {
    push({
      id: 'add-polygon',
      label: 'Add a polygon here',
      hint: 'Hexagons, octagons and the rest, sized by the circle they fit in',
      prompt: { label: 'Sides', initial: 6, unit: '' },
      prompt2: { label: 'Across corners', initial: 20, unit: 'mm' },
      build: (sides, across) => ({
        kind: 'addPolygon',
        centre: cursor,
        sides,
        radius: (across ?? 20) / 2,
      }),
    })
    push({
      id: 'add-slot',
      label: 'Add a slot here',
      hint: 'A rounded slot, for something that needs to be adjustable',
      prompt: { label: 'Length', initial: 30, unit: 'mm' },
      prompt2: { label: 'Width', initial: 8, unit: 'mm' },
      build: (length, width) => ({
        kind: 'addSlot',
        centre: cursor,
        length,
        width: width ?? 8,
      }),
    })
  }

  // ---- two points and a line: mirror -------------------------------------
  if (pointIds.length === 2 && straight.length === 1 && entities.length === 1) {
    const line = straight[0] as Extract<SketchEntity, { kind: 'line' }>
    push({
      id: 'symmetric',
      label: 'Mirror about this line',
      hint: 'Keep the two corners opposite each other',
      build: () =>
        constraint({ kind: 'symmetric', a: pointIds[0], b: pointIds[1], line: line.id }),
    })
  }

  return out
}

/** Explains why the menu is empty, so a right-click never feels broken. */
export function emptySelectionHint(selection: SketchTarget[]): string {
  if (selection.length === 0) {
    return 'Click something first. Shift-click to pick a second one.'
  }
  if (selection.length > 2) {
    return 'That is more than any of these work on. Try two things, or two corners and a line.'
  }
  return 'Nothing applies to that combination. Try two lines, two corners, or a line and a circle.'
}
