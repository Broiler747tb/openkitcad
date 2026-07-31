/**
 * Rounding and chamfering the corner where two edges meet.
 *
 * Three things this has to get right, each of which broke an earlier version:
 *
 * 1. Corners are found by *position*, not by shared point ids. Two lines whose
 *    ends sit on the same spot without ever having been fused still look like a
 *    corner to the user, and the profile builder already welds them the same
 *    way when it extrudes. Requiring a shared id meant half the corners in a
 *    hand-drawn outline silently offered nothing.
 *
 * 2. An edge may be an arc, not just a line. Otherwise rounding one corner of a
 *    rectangle immediately makes its neighbours un-roundable, which is exactly
 *    when someone wants to round them.
 *
 * 3. Both operations keep the original corner point as a "virtual sharp",
 *    constrained onto both edges' extensions. That keeps them exactly
 *    degrees-of-freedom neutral, so softening a corner never quietly loosens a
 *    sketch that was fully defined a moment before.
 *
 * The fillet centre is found by offsetting both edges inward by the radius and
 * intersecting them: a line offsets to a parallel line, an arc to a concentric
 * circle. That one construction covers line-line, line-arc and arc-arc without
 * three separate formulas.
 */
import { v2, type Vec2 } from '../core/math'
import type {
  ArcEntity,
  LineEntity,
  NewConstraint,
  Sketch2D,
  SketchEntity,
} from './types'

/** Ends this close together are the same corner, in mm. */
const WELD = 1e-6
/** Most of an edge a corner operation may eat. */
const MAX_CONSUMED = 0.9

type CornerEntity = LineEntity | ArcEntity

export interface CornerLeg {
  entity: CornerEntity
  /** Which of the entity's own point ids sits at this corner. */
  pointId: string
  /** Unit direction leaving the corner along this edge. */
  dir: Vec2
  /** How far the edge runs from the corner. */
  length: number
  /** Present only for arcs. */
  arc?: { centre: Vec2; radius: number }
}

export interface CornerInfo {
  /** The point the user picked, kept afterwards as the virtual sharp. */
  pointId: string
  corner: Vec2
  legs: [CornerLeg, CornerLeg]
  /** Angle between the two leaving directions, radians. */
  angle: number
  /** Unit vector bisecting the corner, pointing into its interior. */
  bisector: Vec2
  /** Other points sitting on this corner that no longer need to exist. */
  duplicates: string[]
}

export interface CornerResult {
  ok: boolean
  message?: string
}

const perp = (v: Vec2): Vec2 => [-v[1], v[0]]

function arcSweep(arc: ArcEntity, pts: Map<string, Vec2>): number {
  const c = pts.get(arc.c)!
  const a1 = Math.atan2(pts.get(arc.p1)![1] - c[1], pts.get(arc.p1)![0] - c[0])
  const a2 = Math.atan2(pts.get(arc.p2)![1] - c[1], pts.get(arc.p2)![0] - c[0])
  const TAU = Math.PI * 2
  let sweep = arc.ccw ? a2 - a1 : a1 - a2
  sweep = ((sweep % TAU) + TAU) % TAU
  return sweep < 1e-9 ? TAU : sweep
}

/**
 * Describe the corner at a point, or return null if it is not one: fewer or
 * more than two edges meeting, a zero-length edge, or an angle too flat to
 * round meaningfully.
 */
export function findCorner(sketch: Sketch2D, pointId: string): CornerInfo | null {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const corner = pts.get(pointId)
  if (!corner) return null

  const at = (id: string) => v2.dist(pts.get(id) ?? [1e9, 1e9], corner) <= WELD

  const legs: CornerLeg[] = []
  for (const entity of sketch.entities) {
    if (entity.construction) continue

    if (entity.kind === 'line') {
      const end = at(entity.p1) ? entity.p1 : at(entity.p2) ? entity.p2 : null
      if (!end) continue
      const other = pts.get(end === entity.p1 ? entity.p2 : entity.p1)!
      const away = v2.sub(other, corner)
      const length = v2.len(away)
      if (length < WELD) continue
      legs.push({ entity, pointId: end, dir: v2.norm(away), length })
      continue
    }

    if (entity.kind === 'arc') {
      const end = at(entity.p1) ? entity.p1 : at(entity.p2) ? entity.p2 : null
      if (!end) continue
      const centre = pts.get(entity.c)!
      const radial = v2.sub(corner, centre)
      const radius = v2.len(radial)
      if (radius < WELD) continue
      // Tangent at this end, pointing away along the arc.
      const forward = perp(v2.norm(radial))
      const atStart = end === entity.p1
      const sign = entity.ccw === atStart ? 1 : -1
      legs.push({
        entity,
        pointId: end,
        dir: v2.scale(forward, sign),
        length: radius * arcSweep(entity, pts),
        arc: { centre, radius },
      })
    }
  }

  if (legs.length !== 2) return null

  const [a, b] = legs
  const angle = Math.acos(Math.max(-1, Math.min(1, v2.dot(a.dir, b.dir))))
  // Below about 3 degrees from straight or from folded back the arithmetic is
  // hopeless and the result would be invisible anyway.
  if (angle < 0.05 || angle > Math.PI - 0.05) return null

  const bisector = v2.norm(v2.add(a.dir, b.dir))
  if (v2.len(bisector) < 1e-9) return null

  const duplicates = sketch.points
    .filter((p) => p.id !== pointId && v2.dist([p.x, p.y], corner) <= WELD)
    .map((p) => p.id)

  return { pointId, corner, legs: [a, b], angle, bisector, duplicates }
}

export function maxFilletRadius(corner: CornerInfo): number {
  const shortest = Math.min(corner.legs[0].length, corner.legs[1].length)
  return shortest * MAX_CONSUMED * Math.tan(corner.angle / 2)
}

export function maxChamferDistance(corner: CornerInfo): number {
  return Math.min(corner.legs[0].length, corner.legs[1].length) * MAX_CONSUMED
}

// ---------------------------------------------------------------------------
// Offset construction
// ---------------------------------------------------------------------------

type Offset =
  | { kind: 'line'; point: Vec2; dir: Vec2 }
  | { kind: 'circle'; centre: Vec2; radius: number }

/** Where the fillet centre may sit, given one edge and a radius. */
function offsetOf(leg: CornerLeg, corner: Vec2, bisector: Vec2, r: number): Offset {
  if (!leg.arc) {
    // Parallel line, shifted toward the inside of the corner.
    const n = perp(leg.dir)
    const inward = v2.dot(n, bisector) >= 0 ? n : v2.scale(n, -1)
    return { kind: 'line', point: v2.add(corner, v2.scale(inward, r)), dir: leg.dir }
  }
  // Concentric circle. Whether it grows or shrinks depends on which side of the
  // arc the corner's interior lies.
  const toCentre = v2.norm(v2.sub(leg.arc.centre, corner))
  const inside = v2.dot(bisector, toCentre) > 0
  return {
    kind: 'circle',
    centre: leg.arc.centre,
    radius: inside ? leg.arc.radius - r : leg.arc.radius + r,
  }
}

function intersect(a: Offset, b: Offset, near: Vec2): Vec2 | null {
  const best = (candidates: Vec2[]): Vec2 | null => {
    let winner: Vec2 | null = null
    let bestD = Infinity
    for (const c of candidates) {
      const d = v2.dist(c, near)
      if (d < bestD) {
        bestD = d
        winner = c
      }
    }
    return winner
  }

  if (a.kind === 'line' && b.kind === 'line') {
    const denominator = v2.cross(a.dir, b.dir)
    if (Math.abs(denominator) < 1e-12) return null
    const t = v2.cross(v2.sub(b.point, a.point), b.dir) / denominator
    return [a.point[0] + a.dir[0] * t, a.point[1] + a.dir[1] * t]
  }

  if (a.kind === 'circle' && b.kind === 'circle') {
    const d = v2.dist(a.centre, b.centre)
    if (d < 1e-12 || d > a.radius + b.radius || d < Math.abs(a.radius - b.radius)) {
      return null
    }
    const x = (d * d - b.radius * b.radius + a.radius * a.radius) / (2 * d)
    const hSq = a.radius * a.radius - x * x
    if (hSq < 0) return null
    const h = Math.sqrt(hSq)
    const u = v2.norm(v2.sub(b.centre, a.centre))
    const mid = v2.add(a.centre, v2.scale(u, x))
    const n = perp(u)
    return best([v2.add(mid, v2.scale(n, h)), v2.sub(mid, v2.scale(n, h))])
  }

  // One of each.
  const line = (a.kind === 'line' ? a : b) as Extract<Offset, { kind: 'line' }>
  const circle = (a.kind === 'circle' ? a : b) as Extract<Offset, { kind: 'circle' }>
  const m = v2.sub(line.point, circle.centre)
  const qa = v2.dot(line.dir, line.dir)
  const qb = 2 * v2.dot(m, line.dir)
  const qc = v2.dot(m, m) - circle.radius * circle.radius
  const disc = qb * qb - 4 * qa * qc
  if (disc < 0 || qa < 1e-12) return null
  const root = Math.sqrt(disc)
  return best(
    [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].map((t) => [
      line.point[0] + line.dir[0] * t,
      line.point[1] + line.dir[1] * t,
    ]),
  )
}

/** Where the fillet meets one edge. */
function tangentPoint(leg: CornerLeg, corner: Vec2, filletCentre: Vec2): Vec2 {
  if (!leg.arc) {
    const t = v2.dot(v2.sub(filletCentre, corner), leg.dir)
    return v2.add(corner, v2.scale(leg.dir, t))
  }
  const u = v2.norm(v2.sub(filletCentre, leg.arc.centre))
  return v2.add(leg.arc.centre, v2.scale(u, leg.arc.radius))
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

function retarget(entity: CornerEntity, from: string, to: string): void {
  if (entity.p1 === from) entity.p1 = to
  else if (entity.p2 === from) entity.p2 = to
}

/** Drop corner points that nothing refers to any more. */
function pruneDuplicates(sketch: Sketch2D, ids: string[]): void {
  for (const id of ids) {
    const usedByEntity = sketch.entities.some(
      (e) =>
        (e.kind !== 'circle' && (e.p1 === id || e.p2 === id)) ||
        (e.kind !== 'line' && e.c === id),
    )
    const usedByConstraint = sketch.constraints.some((c) =>
      Object.values(c).includes(id),
    )
    if (!usedByEntity && !usedByConstraint) {
      sketch.points = sketch.points.filter((p) => p.id !== id)
    }
  }
}

/** Hold the old corner on this edge's extension, so it stays a virtual sharp. */
function pinVirtualSharp(
  leg: CornerLeg,
  pointId: string,
  add: (c: NewConstraint) => void,
): void {
  if (leg.arc) add({ kind: 'pointOnCircle', p: pointId, e: leg.entity.id })
  else add({ kind: 'pointOnLine', p: pointId, e: leg.entity.id })
}

/** Which way round the new arc is tangent to an existing edge. */
function tangentSideToLine(leg: CornerLeg, pts: Map<string, Vec2>, centre: Vec2): 1 | -1 {
  const line = leg.entity as LineEntity
  const p1 = pts.get(line.p1)!
  const p2 = pts.get(line.p2)!
  return v2.cross(v2.sub(centre, p1), v2.sub(p2, p1)) >= 0 ? 1 : -1
}

export function filletCorner(
  sketch: Sketch2D,
  pointId: string,
  radius: number,
  nextId: (prefix: string) => string,
): CornerResult {
  const corner = findCorner(sketch, pointId)
  if (!corner) return { ok: false, message: describeRefusal(sketch, pointId) }
  if (!(radius > 0)) return { ok: false, message: 'The radius has to be more than zero.' }

  const limit = maxFilletRadius(corner)
  if (radius > limit) {
    return {
      ok: false,
      message: `That radius is too big for these edges. The most that fits is about ${limit.toFixed(1)} mm.`,
    }
  }

  const [legA, legB] = corner.legs
  const centre = intersect(
    offsetOf(legA, corner.corner, corner.bisector, radius),
    offsetOf(legB, corner.corner, corner.bisector, radius),
    corner.corner,
  )
  if (!centre) {
    return { ok: false, message: 'These two edges cannot be joined by a curve of that size.' }
  }

  const t1 = tangentPoint(legA, corner.corner, centre)
  const t2 = tangentPoint(legB, corner.corner, centre)
  if (
    v2.dist(t1, corner.corner) > legA.length * MAX_CONSUMED ||
    v2.dist(t2, corner.corner) > legB.length * MAX_CONSUMED
  ) {
    return { ok: false, message: 'That radius runs off the end of one of the edges.' }
  }

  const t1Id = nextId('p')
  const t2Id = nextId('p')
  const centreId = nextId('p')
  sketch.points.push({ id: t1Id, x: t1[0], y: t1[1] })
  sketch.points.push({ id: t2Id, x: t2[0], y: t2[1] })
  sketch.points.push({ id: centreId, x: centre[0], y: centre[1] })

  // A fillet is always the short way round.
  const a1 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0])
  const a2 = Math.atan2(t2[1] - centre[1], t2[0] - centre[0])
  const TAU = Math.PI * 2
  const ccwSweep = (((a2 - a1) % TAU) + TAU) % TAU
  const arcId = nextId('e')

  retarget(legA.entity, legA.pointId, t1Id)
  retarget(legB.entity, legB.pointId, t2Id)
  sketch.entities.push({
    id: arcId,
    kind: 'arc',
    c: centreId,
    p1: t1Id,
    p2: t2Id,
    ccw: ccwSweep <= Math.PI,
    construction: false,
  })

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  add({ kind: 'radius', e: arcId, value: radius })
  for (const leg of corner.legs) {
    if (leg.arc) {
      // Nested when the fillet sits inside the existing arc.
      const gap = v2.dist(centre, leg.arc.centre)
      const side: 1 | -1 = gap < leg.arc.radius ? -1 : 1
      add({ kind: 'tangentArcs', a: leg.entity.id, b: arcId, side })
    } else {
      add({
        kind: 'tangent',
        line: leg.entity.id,
        circle: arcId,
        side: tangentSideToLine(leg, pts, centre),
      })
    }
    pinVirtualSharp(leg, pointId, add)
  }

  pruneDuplicates(sketch, corner.duplicates)
  return { ok: true }
}

export function chamferCorner(
  sketch: Sketch2D,
  pointId: string,
  distance: number,
  nextId: (prefix: string) => string,
): CornerResult {
  const corner = findCorner(sketch, pointId)
  if (!corner) return { ok: false, message: describeRefusal(sketch, pointId) }
  if (!(distance > 0)) return { ok: false, message: 'The size has to be more than zero.' }

  const limit = maxChamferDistance(corner)
  if (distance > limit) {
    return {
      ok: false,
      message: `That is too big for these edges. The most that fits is about ${limit.toFixed(1)} mm.`,
    }
  }

  const [legA, legB] = corner.legs
  // Along a straight edge this is a plain step back; along an arc it follows
  // the curve, so the setback is measured as arc length.
  const along = (leg: CornerLeg): Vec2 => {
    if (!leg.arc) return v2.add(corner.corner, v2.scale(leg.dir, distance))
    const { centre, radius } = leg.arc
    const start = Math.atan2(
      corner.corner[1] - centre[1],
      corner.corner[0] - centre[0],
    )
    const forward = perp(v2.norm(v2.sub(corner.corner, centre)))
    const sign = v2.dot(forward, leg.dir) >= 0 ? 1 : -1
    const a = start + (sign * distance) / radius
    return [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)]
  }

  const t1 = along(legA)
  const t2 = along(legB)
  const t1Id = nextId('p')
  const t2Id = nextId('p')
  sketch.points.push({ id: t1Id, x: t1[0], y: t1[1] })
  sketch.points.push({ id: t2Id, x: t2[0], y: t2[1] })

  retarget(legA.entity, legA.pointId, t1Id)
  retarget(legB.entity, legB.pointId, t2Id)
  sketch.entities.push({
    id: nextId('e'),
    kind: 'line',
    p1: t1Id,
    p2: t2Id,
    construction: false,
  })

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)
  pinVirtualSharp(legA, pointId, add)
  pinVirtualSharp(legB, pointId, add)
  add({ kind: 'distance', a: pointId, b: t1Id, value: v2.dist(corner.corner, t1) })
  add({ kind: 'distance', a: pointId, b: t2Id, value: v2.dist(corner.corner, t2) })

  pruneDuplicates(sketch, corner.duplicates)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Rounding between two curves that were never joined
// ---------------------------------------------------------------------------

/** Where two edges cross, treating lines as infinite so they can be extended to meet. */
function crossingsOf(a: CornerEntity, b: CornerEntity, pts: Map<string, Vec2>): Vec2[] {
  const asLine = (e: CornerEntity) => {
    const p = pts.get((e as LineEntity).p1)!
    const q = pts.get((e as LineEntity).p2)!
    return { p, dir: v2.sub(q, p) }
  }
  const asCircle = (e: CornerEntity) => {
    const arc = e as ArcEntity
    const c = pts.get(arc.c)!
    return { c, r: v2.dist(c, pts.get(arc.p1)!) }
  }

  if (a.kind === 'line' && b.kind === 'line') {
    const la = asLine(a)
    const lb = asLine(b)
    const denominator = v2.cross(la.dir, lb.dir)
    if (Math.abs(denominator) < 1e-12) return []
    const t = v2.cross(v2.sub(lb.p, la.p), lb.dir) / denominator
    return [[la.p[0] + la.dir[0] * t, la.p[1] + la.dir[1] * t]]
  }

  if (a.kind !== 'line' && b.kind !== 'line') {
    const ca = asCircle(a)
    const cb = asCircle(b)
    const d = v2.dist(ca.c, cb.c)
    if (d < 1e-9 || d > ca.r + cb.r || d < Math.abs(ca.r - cb.r)) return []
    const x = (d * d - cb.r * cb.r + ca.r * ca.r) / (2 * d)
    const hSq = ca.r * ca.r - x * x
    if (hSq < 0) return []
    const h = Math.sqrt(hSq)
    const u = v2.norm(v2.sub(cb.c, ca.c))
    const mid = v2.add(ca.c, v2.scale(u, x))
    const n = perp(u)
    return [v2.add(mid, v2.scale(n, h)), v2.sub(mid, v2.scale(n, h))]
  }

  const line = asLine(a.kind === 'line' ? a : b)
  const circle = asCircle(a.kind === 'line' ? b : a)
  const m = v2.sub(line.p, circle.c)
  const qa = v2.dot(line.dir, line.dir)
  const qb = 2 * v2.dot(m, line.dir)
  const qc = v2.dot(m, m) - circle.r * circle.r
  const disc = qb * qb - 4 * qa * qc
  if (disc < 0 || qa < 1e-12) return []
  const root = Math.sqrt(disc)
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].map((t) => [
    line.p[0] + line.dir[0] * t,
    line.p[1] + line.dir[1] * t,
  ])
}

/** The two ways you can leave a curve from a point on it. */
function tangentsAt(e: CornerEntity, at: Vec2, pts: Map<string, Vec2>): [Vec2, Vec2] {
  if (e.kind === 'line') {
    const d = v2.norm(v2.sub(pts.get(e.p2)!, pts.get(e.p1)!))
    return [d, v2.scale(d, -1)]
  }
  const t = perp(v2.norm(v2.sub(at, pts.get(e.c)!)))
  return [t, v2.scale(t, -1)]
}

/**
 * Round the corner between two edges that were never joined - they cross, or
 * merely point at each other. This is what Fusion's sketch fillet does, and it
 * is the one people reach for: geometry drawn separately rarely shares an
 * endpoint, so waiting for a shared corner means waiting forever.
 *
 * Which of the four quadrants around the crossing gets rounded is decided by
 * where the user right-clicked, because it is genuinely ambiguous otherwise.
 */
export function filletBetween(
  sketch: Sketch2D,
  aId: string,
  bId: string,
  radius: number,
  cursor: Vec2,
  nextId: (prefix: string) => string,
): CornerResult {
  const find = (id: string) =>
    sketch.entities.find((e): e is CornerEntity => e.id === id && e.kind !== 'circle')
  const a = find(aId)
  const b = find(bId)
  if (!a || !b) {
    return {
      ok: false,
      message:
        'A whole circle has no ends to join onto. Trim it back to where it crosses first, then round the corner.',
    }
  }
  if (!(radius > 0)) return { ok: false, message: 'The radius has to be more than zero.' }

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const crossings = crossingsOf(a, b, pts)
  if (crossings.length === 0) {
    return { ok: false, message: 'These two never meet, even extended, so there is no corner.' }
  }
  const at = crossings.reduce((best, c) =>
    v2.dist(c, cursor) < v2.dist(best, cursor) ? c : best,
  )

  // Pick the quadrant the user clicked in.
  const toward = v2.norm(v2.sub(cursor, at))
  const [a1, a2] = tangentsAt(a, at, pts)
  const [b1, b2] = tangentsAt(b, at, pts)
  let choice: { da: Vec2; db: Vec2; score: number } | null = null
  for (const da of [a1, a2]) {
    for (const db of [b1, b2]) {
      const bisector = v2.norm(v2.add(da, db))
      if (v2.len(bisector) < 1e-9) continue
      const score = v2.len(toward) < 1e-9 ? 0 : v2.dot(bisector, toward)
      if (!choice || score > choice.score) choice = { da, db, score }
    }
  }
  if (!choice) return { ok: false, message: 'These run straight through each other.' }

  const bisector = v2.norm(v2.add(choice.da, choice.db))
  const angle = Math.acos(Math.max(-1, Math.min(1, v2.dot(choice.da, choice.db))))
  if (angle < 0.05 || angle > Math.PI - 0.05) {
    return { ok: false, message: 'They meet almost straight on, so there is no corner to round.' }
  }

  const legFor = (e: CornerEntity, dir: Vec2): CornerLeg => ({
    entity: e,
    pointId: e.p1,
    dir,
    length: Infinity,
    arc:
      e.kind === 'arc'
        ? { centre: pts.get(e.c)!, radius: v2.dist(pts.get(e.c)!, pts.get(e.p1)!) }
        : undefined,
  })
  const legA = legFor(a, choice.da)
  const legB = legFor(b, choice.db)

  const centre = intersect(
    offsetOf(legA, at, bisector, radius),
    offsetOf(legB, at, bisector, radius),
    at,
  )
  if (!centre) return { ok: false, message: 'No curve of that size fits between these two.' }

  const t1 = tangentPoint(legA, at, centre)
  const t2 = tangentPoint(legB, at, centre)

  /** Move the end that falls on the discarded side up to the tangent point. */
  const attach = (e: CornerEntity, dir: Vec2, tangent: Vec2): string => {
    const s1 = v2.dot(v2.sub(pts.get(e.p1)!, at), dir)
    const s2 = v2.dot(v2.sub(pts.get(e.p2)!, at), dir)
    // Whichever end is furthest back along the kept direction is the one being
    // cut away; if both are ahead, the edge is being extended to reach.
    const replaceP1 = s1 < s2
    const id = nextId('p')
    sketch.points.push({ id, x: tangent[0], y: tangent[1] })
    const stale = replaceP1 ? e.p1 : e.p2
    if (replaceP1) e.p1 = id
    else e.p2 = id
    pruneDuplicates(sketch, [stale])
    return id
  }

  const t1Id = attach(a, choice.da, t1)
  const t2Id = attach(b, choice.db, t2)
  const centreId = nextId('p')
  sketch.points.push({ id: centreId, x: centre[0], y: centre[1] })

  const ang1 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0])
  const ang2 = Math.atan2(t2[1] - centre[1], t2[0] - centre[0])
  const TAU = Math.PI * 2
  const ccwSweep = (((ang2 - ang1) % TAU) + TAU) % TAU
  const arcId = nextId('e')
  sketch.entities.push({
    id: arcId,
    kind: 'arc',
    c: centreId,
    p1: t1Id,
    p2: t2Id,
    ccw: ccwSweep <= Math.PI,
    construction: false,
  })

  const after = new Map<string, Vec2>()
  for (const p of sketch.points) after.set(p.id, [p.x, p.y])
  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  add({ kind: 'radius', e: arcId, value: radius })
  for (const leg of [legA, legB]) {
    if (leg.arc) {
      const gap = v2.dist(centre, leg.arc.centre)
      add({
        kind: 'tangentArcs',
        a: leg.entity.id,
        b: arcId,
        side: gap < leg.arc.radius ? -1 : 1,
      })
    } else {
      add({
        kind: 'tangent',
        line: leg.entity.id,
        circle: arcId,
        side: tangentSideToLine(leg, after, centre),
      })
    }
  }
  return { ok: true }
}

/** Say why a point is not a corner, rather than just refusing. */
function describeRefusal(sketch: Sketch2D, pointId: string): string {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const corner = pts.get(pointId)
  if (!corner) return 'That point is not part of the sketch any more.'

  let touching = 0
  for (const e of sketch.entities) {
    if (e.construction || e.kind === 'circle') continue
    for (const end of [e.p1, e.p2]) {
      if (v2.dist(pts.get(end) ?? [1e9, 1e9], corner) <= WELD) touching++
    }
  }
  if (touching === 0) return 'Nothing meets at that point.'
  if (touching === 1) {
    return 'Only one edge ends there. A corner needs two edges meeting.'
  }
  if (touching > 2) {
    return `${touching} edges meet there, so it is not clear which corner you mean. Try a point where exactly two meet.`
  }
  return 'Those two edges run almost straight through, so there is no corner to soften.'
}
