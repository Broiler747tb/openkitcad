/**
 * Rounding and chamfering the corner where two lines meet.
 *
 * Both operations keep the original corner point in place rather than deleting
 * it, constrained to sit on the extension of both lines. Real CAD calls that a
 * "virtual sharp", and keeping it has two benefits: you can still dimension to
 * where the corner would have been, and - the reason it is done this way here -
 * it makes the operation exactly degrees-of-freedom neutral, so rounding a
 * corner never quietly loosens a sketch that was fully defined a moment ago.
 *
 * The arithmetic for a fillet:
 *
 *   setback = r / tan(theta/2)      distance back along each line
 *   offset  = r / sin(theta/2)      distance from corner to the arc centre
 *
 * where theta is the interior angle. Both blow up as theta approaches zero or
 * pi, which is why near-collinear corners are rejected rather than fudged.
 */
import { v2, type Vec2 } from '../core/math'
import type { LineEntity, NewConstraint, Sketch2D, SketchEntity } from './types'

export interface CornerInfo {
  pointId: string
  lineA: LineEntity
  lineB: LineEntity
  /** Corner position. */
  corner: Vec2
  /** Unit vectors from the corner along each line. */
  dirA: Vec2
  dirB: Vec2
  /** Interior angle in radians. */
  angle: number
  /** How far each line runs from the corner. Limits the size of the cut. */
  lengthA: number
  lengthB: number
}

/** Farthest we will let a corner operation eat into the shorter of the two lines. */
const MAX_CONSUMED = 0.9

function otherEnd(line: LineEntity, pointId: string): string {
  return line.p1 === pointId ? line.p2 : line.p1
}

/**
 * Describe the corner at a point, or return null if it is not one: fewer or
 * more than two lines, a zero-length line, or an angle too flat to round.
 */
export function findCorner(sketch: Sketch2D, pointId: string): CornerInfo | null {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const corner = pts.get(pointId)
  if (!corner) return null

  const touching = sketch.entities.filter(
    (e): e is LineEntity =>
      e.kind === 'line' && !e.construction && (e.p1 === pointId || e.p2 === pointId),
  )
  if (touching.length !== 2) return null

  const [lineA, lineB] = touching
  const a = pts.get(otherEnd(lineA, pointId))!
  const b = pts.get(otherEnd(lineB, pointId))!
  const va = v2.sub(a, corner)
  const vb = v2.sub(b, corner)
  const lengthA = v2.len(va)
  const lengthB = v2.len(vb)
  if (lengthA < 1e-6 || lengthB < 1e-6) return null

  const dirA = v2.norm(va)
  const dirB = v2.norm(vb)
  const angle = Math.acos(Math.max(-1, Math.min(1, v2.dot(dirA, dirB))))
  // Below about 3 degrees from straight or from folded back, the maths is
  // numerically hopeless and the result would be invisible anyway.
  if (angle < 0.05 || angle > Math.PI - 0.05) return null

  return { pointId, lineA, lineB, corner, dirA, dirB, angle, lengthA, lengthB }
}

/** Largest radius that still leaves both lines with something left. */
export function maxFilletRadius(corner: CornerInfo): number {
  const shortest = Math.min(corner.lengthA, corner.lengthB)
  return (shortest * MAX_CONSUMED) / (1 / Math.tan(corner.angle / 2))
}

export function maxChamferDistance(corner: CornerInfo): number {
  return Math.min(corner.lengthA, corner.lengthB) * MAX_CONSUMED
}

/** Sign convention matching the solver's tangent constraint. */
function tangentSide(line: LineEntity, pts: Map<string, Vec2>, centre: Vec2): 1 | -1 {
  const p1 = pts.get(line.p1)!
  const p2 = pts.get(line.p2)!
  return v2.cross(v2.sub(centre, p1), v2.sub(p2, p1)) >= 0 ? 1 : -1
}

/** Point the line's corner end at a new point. */
function retarget(line: LineEntity, from: string, to: string): void {
  if (line.p1 === from) line.p1 = to
  else line.p2 = to
}

export interface CornerResult {
  ok: boolean
  /** Why it could not be done, in words a beginner can act on. */
  message?: string
}

/**
 * Replace a sharp corner with an arc. Mutates the sketch.
 * `nextId` supplies fresh ids for the geometry that gets created.
 */
export function filletCorner(
  sketch: Sketch2D,
  pointId: string,
  radius: number,
  nextId: (prefix: string) => string,
): CornerResult {
  const corner = findCorner(sketch, pointId)
  if (!corner) {
    return {
      ok: false,
      message: 'That is not a corner between two straight lines.',
    }
  }
  if (!(radius > 0)) return { ok: false, message: 'The radius has to be more than zero.' }

  const limit = maxFilletRadius(corner)
  if (radius > limit) {
    return {
      ok: false,
      message: `That radius is too big for these lines. The most that fits is about ${limit.toFixed(1)} mm.`,
    }
  }

  const half = corner.angle / 2
  const setback = radius / Math.tan(half)
  const offset = radius / Math.sin(half)

  const t1: Vec2 = v2.add(corner.corner, v2.scale(corner.dirA, setback))
  const t2: Vec2 = v2.add(corner.corner, v2.scale(corner.dirB, setback))
  const bisector = v2.norm(v2.add(corner.dirA, corner.dirB))
  const centre: Vec2 = v2.add(corner.corner, v2.scale(bisector, offset))

  const t1Id = nextId('p')
  const t2Id = nextId('p')
  const centreId = nextId('p')
  sketch.points.push({ id: t1Id, x: t1[0], y: t1[1] })
  sketch.points.push({ id: t2Id, x: t2[0], y: t2[1] })
  sketch.points.push({ id: centreId, x: centre[0], y: centre[1] })

  // Pick the minor arc: a fillet is never the long way round.
  const a1 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0])
  const a2 = Math.atan2(t2[1] - centre[1], t2[0] - centre[0])
  const TAU = Math.PI * 2
  const ccwSweep = ((a2 - a1) % TAU + TAU) % TAU
  const arcId = nextId('e')
  const arc: SketchEntity = {
    id: arcId,
    kind: 'arc',
    c: centreId,
    p1: t1Id,
    p2: t2Id,
    ccw: ccwSweep <= Math.PI,
    construction: false,
  }

  retarget(corner.lineA, pointId, t1Id)
  retarget(corner.lineB, pointId, t2Id)
  sketch.entities.push(arc)

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  add({ kind: 'radius', e: arcId, value: radius })
  add({
    kind: 'tangent',
    line: corner.lineA.id,
    circle: arcId,
    side: tangentSide(corner.lineA, pts, centre),
  })
  add({
    kind: 'tangent',
    line: corner.lineB.id,
    circle: arcId,
    side: tangentSide(corner.lineB, pts, centre),
  })
  // Keep the old corner as the virtual sharp, on both lines' extensions.
  add({ kind: 'pointOnLine', p: pointId, e: corner.lineA.id })
  add({ kind: 'pointOnLine', p: pointId, e: corner.lineB.id })

  return { ok: true }
}

/** Cut the corner off with a straight line. Mutates the sketch. */
export function chamferCorner(
  sketch: Sketch2D,
  pointId: string,
  distance: number,
  nextId: (prefix: string) => string,
): CornerResult {
  const corner = findCorner(sketch, pointId)
  if (!corner) {
    return { ok: false, message: 'That is not a corner between two straight lines.' }
  }
  if (!(distance > 0)) {
    return { ok: false, message: 'The size has to be more than zero.' }
  }
  const limit = maxChamferDistance(corner)
  if (distance > limit) {
    return {
      ok: false,
      message: `That is too big for these lines. The most that fits is about ${limit.toFixed(1)} mm.`,
    }
  }

  const t1: Vec2 = v2.add(corner.corner, v2.scale(corner.dirA, distance))
  const t2: Vec2 = v2.add(corner.corner, v2.scale(corner.dirB, distance))
  const t1Id = nextId('p')
  const t2Id = nextId('p')
  sketch.points.push({ id: t1Id, x: t1[0], y: t1[1] })
  sketch.points.push({ id: t2Id, x: t2[0], y: t2[1] })

  retarget(corner.lineA, pointId, t1Id)
  retarget(corner.lineB, pointId, t2Id)
  sketch.entities.push({
    id: nextId('e'),
    kind: 'line',
    p1: t1Id,
    p2: t2Id,
    construction: false,
  })

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  add({ kind: 'pointOnLine', p: pointId, e: corner.lineA.id })
  add({ kind: 'pointOnLine', p: pointId, e: corner.lineB.id })
  add({ kind: 'distance', a: pointId, b: t1Id, value: distance })
  add({ kind: 'distance', a: pointId, b: t2Id, value: distance })

  return { ok: true }
}
