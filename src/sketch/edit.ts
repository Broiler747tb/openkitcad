/**
 * Sketch editing operations that change geometry rather than constrain it:
 * trimming a line back to where it crosses something, and repeating geometry
 * in a line or a ring.
 *
 * Both are the difference between a sketcher you can draw in and one you can
 * actually work in. Without trim, overlapping lines can only be deleted and
 * redrawn. Without patterns, a row of eight vent slots is eight hand-drawn
 * rectangles that will never quite line up.
 */
import { v2, type Vec2 } from '../core/math'
import type { LineEntity, NewConstraint, Sketch2D, SketchEntity } from './types'

export interface EditResult {
  ok: boolean
  message?: string
}

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

/** Parameters along `line` (0..1) where it crosses another entity. */
function crossings(sketch: Sketch2D, line: LineEntity, pts: Map<string, Vec2>): number[] {
  const a = pts.get(line.p1)!
  const b = pts.get(line.p2)!
  const d = v2.sub(b, a)
  const out: number[] = []

  for (const other of sketch.entities) {
    if (other.id === line.id) continue

    if (other.kind === 'line') {
      const c = pts.get(other.p1)!
      const e = pts.get(other.p2)!
      const f = v2.sub(e, c)
      const denominator = v2.cross(d, f)
      if (Math.abs(denominator) < 1e-12) continue // parallel
      const t = v2.cross(v2.sub(c, a), f) / denominator
      const u = v2.cross(v2.sub(c, a), d) / denominator
      if (t > 1e-6 && t < 1 - 1e-6 && u > -1e-6 && u < 1 + 1e-6) out.push(t)
      continue
    }

    // Circle or arc: solve |a + t*d - centre| = r.
    const centre = pts.get(other.c)!
    const radius =
      other.kind === 'circle' ? other.r : v2.dist(centre, pts.get(other.p1)!)
    const m = v2.sub(a, centre)
    const qa = v2.dot(d, d)
    const qb = 2 * v2.dot(m, d)
    const qc = v2.dot(m, m) - radius * radius
    const disc = qb * qb - 4 * qa * qc
    if (disc <= 0 || qa < 1e-12) continue
    const root = Math.sqrt(disc)
    for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
      if (t > 1e-6 && t < 1 - 1e-6) out.push(t)
    }
  }

  return [...new Set(out)].sort((x, y) => x - y)
}

/**
 * Cut away the piece of a line that contains `at`, back to the nearest place it
 * crosses something else. With nothing crossing it, the whole line goes.
 */
export function trimLine(
  sketch: Sketch2D,
  entityId: string,
  at: Vec2,
  nextId: (prefix: string) => string,
): EditResult {
  const line = sketch.entities.find(
    (e): e is LineEntity => e.id === entityId && e.kind === 'line',
  )
  if (!line) {
    return { ok: false, message: 'Trim only works on straight lines for now.' }
  }

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const a = pts.get(line.p1)!
  const b = pts.get(line.p2)!
  const d = v2.sub(b, a)
  const len2 = v2.dot(d, d)
  if (len2 < 1e-12) return { ok: false, message: 'That line has no length.' }

  const clickT = Math.max(0, Math.min(1, v2.dot(v2.sub(at, a), d) / len2))
  const cuts = crossings(sketch, line, pts)

  const dropEntity = (id: string) => {
    sketch.entities = sketch.entities.filter((e) => e.id !== id)
    sketch.constraints = sketch.constraints.filter(
      (c) =>
        !(
          ('e' in c && c.e === id) ||
          ('a' in c && c.a === id) ||
          ('b' in c && c.b === id) ||
          ('line' in c && c.line === id) ||
          ('circle' in c && c.circle === id)
        ),
    )
  }

  if (cuts.length === 0) {
    dropEntity(line.id)
    return { ok: true }
  }

  const bounds = [0, ...cuts, 1]
  let lo = 0
  let hi = 1
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (clickT >= bounds[i] && clickT <= bounds[i + 1]) {
      lo = bounds[i]
      hi = bounds[i + 1]
      break
    }
  }

  const pointAt = (t: number): Vec2 => [a[0] + d[0] * t, a[1] + d[1] * t]
  const makePoint = (t: number): string => {
    const p = pointAt(t)
    const id = nextId('p')
    sketch.points.push({ id, x: p[0], y: p[1] })
    return id
  }

  // Trimming a piece off an end just shortens the line. Trimming out of the
  // middle has to leave two lines behind.
  if (lo === 0 && hi === 1) {
    dropEntity(line.id)
  } else if (lo === 0) {
    line.p1 = makePoint(hi)
  } else if (hi === 1) {
    line.p2 = makePoint(lo)
  } else {
    const tailStart = makePoint(hi)
    const headEnd = makePoint(lo)
    const originalEnd = line.p2
    line.p2 = headEnd
    sketch.entities.push({
      id: nextId('e'),
      kind: 'line',
      p1: tailStart,
      p2: originalEnd,
      construction: line.construction,
    })
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

interface CopyPlan {
  /** Maps an original point id to its copy. */
  points: Map<string, string>
  /** Maps an original entity id to its copy. */
  entities: Map<string, string>
}

function copyGeometry(
  sketch: Sketch2D,
  entityIds: string[],
  place: (p: Vec2) => Vec2,
  nextId: (prefix: string) => string,
): CopyPlan {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const entities = sketch.entities.filter((e) => entityIds.includes(e.id))

  const map = new Map<string, string>()
  const clonePoint = (id: string): string => {
    const existing = map.get(id)
    if (existing) return existing
    const moved = place(pts.get(id)!)
    const newId = nextId('p')
    sketch.points.push({ id: newId, x: moved[0], y: moved[1] })
    map.set(id, newId)
    return newId
  }

  const entityMap = new Map<string, string>()
  for (const entity of entities) {
    const id = nextId('e')
    entityMap.set(entity.id, id)
    if (entity.kind === 'line') {
      sketch.entities.push({
        id,
        kind: 'line',
        p1: clonePoint(entity.p1),
        p2: clonePoint(entity.p2),
        construction: entity.construction,
      })
    } else if (entity.kind === 'circle') {
      sketch.entities.push({
        id,
        kind: 'circle',
        c: clonePoint(entity.c),
        r: entity.r,
        construction: entity.construction,
      })
    } else {
      sketch.entities.push({
        id,
        kind: 'arc',
        c: clonePoint(entity.c),
        p1: clonePoint(entity.p1),
        p2: clonePoint(entity.p2),
        ccw: entity.ccw,
        construction: entity.construction,
      })
    }
  }

  return { points: map, entities: entityMap }
}

/**
 * A copied circle carries its own independent radius variable, so without this
 * a row of eight holes is eight separate sizes waiting to drift apart - and the
 * sketch reports eight degrees of freedom nobody asked for. Arcs need nothing:
 * their radius is derived from their centre and endpoints, which are already
 * positioned.
 */
function tieRadii(
  sketch: Sketch2D,
  plan: CopyPlan,
  add: (c: NewConstraint) => void,
): void {
  for (const [originalId, copyId] of plan.entities) {
    const original = sketch.entities.find((e) => e.id === originalId)
    if (original?.kind === 'circle') {
      add({ kind: 'equal', a: originalId, b: copyId })
    }
  }
}

/**
 * Repeat geometry along a straight line.
 *
 * Each copy is tied back to the original with across/up dimensions rather than
 * left floating, so the pattern stays fully defined and the spacing can be
 * edited afterwards by changing those numbers.
 */
export function linearPattern(
  sketch: Sketch2D,
  entityIds: string[],
  options: { count: number; dx: number; dy: number },
  nextId: (prefix: string) => string,
): EditResult {
  const { count, dx, dy } = options
  if (!entityIds.length) return { ok: false, message: 'Pick something to repeat first.' }
  if (!(count >= 2) || count > 200) {
    return { ok: false, message: 'Choose a count between 2 and 200.' }
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return { ok: false, message: 'The spacing cannot be zero, or the copies land on top of each other.' }
  }

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  for (let k = 1; k < count; k++) {
    const plan = copyGeometry(
      sketch,
      entityIds,
      (p) => [p[0] + dx * k, p[1] + dy * k],
      nextId,
    )
    for (const [original, copy] of plan.points) {
      add({ kind: 'distanceX', a: original, b: copy, value: dx * k })
      add({ kind: 'distanceY', a: original, b: copy, value: dy * k })
    }
    tieRadii(sketch, plan, add)
  }
  return { ok: true }
}

/**
 * Repeat geometry around a centre. The centre is given as a sketch point, which
 * is usually the origin or a construction point at the middle of a bolt circle.
 */
export function circularPattern(
  sketch: Sketch2D,
  entityIds: string[],
  options: { count: number; centre: Vec2; totalAngle: number },
  nextId: (prefix: string) => string,
): EditResult {
  const { count, centre, totalAngle } = options
  if (!entityIds.length) return { ok: false, message: 'Pick something to repeat first.' }
  if (!(count >= 2) || count > 200) {
    return { ok: false, message: 'Choose a count between 2 and 200.' }
  }

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  // A full turn puts the last copy back on the first, so share the circle
  // between all of them; a partial sweep spans the copies end to end.
  const full = Math.abs(Math.abs(totalAngle) - 360) < 1e-6
  const step = ((full ? totalAngle / count : totalAngle / (count - 1)) * Math.PI) / 180

  for (let k = 1; k < count; k++) {
    const angle = step * k
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const plan = copyGeometry(
      sketch,
      entityIds,
      (p) => {
        const rx = p[0] - centre[0]
        const ry = p[1] - centre[1]
        return [centre[0] + rx * cos - ry * sin, centre[1] + rx * sin + ry * cos]
      },
      nextId,
    )
    const pts = new Map<string, Vec2>()
    for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
    for (const [original, copy] of plan.points) {
      const from = pts.get(original)!
      const to = pts.get(copy)!
      add({ kind: 'distanceX', a: original, b: copy, value: to[0] - from[0] })
      add({ kind: 'distanceY', a: original, b: copy, value: to[1] - from[1] })
    }
    tieRadii(sketch, plan, add)
  }
  return { ok: true }
}
