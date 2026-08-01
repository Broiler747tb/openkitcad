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
// Trimming round things
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2
const norm = (a: number) => ((a % TAU) + TAU) % TAU

/** Angles round a circle where something else crosses it. */
function crossingAngles(
  sketch: Sketch2D,
  target: Extract<SketchEntity, { kind: 'circle' | 'arc' }>,
  pts: Map<string, Vec2>,
): number[] {
  const centre = pts.get(target.c)!
  const R =
    target.kind === 'circle' ? target.r : v2.dist(centre, pts.get(target.p1)!)
  const out: number[] = []
  const record = (p: Vec2) => out.push(norm(Math.atan2(p[1] - centre[1], p[0] - centre[0])))

  for (const other of sketch.entities) {
    if (other.id === target.id) continue

    if (other.kind === 'line') {
      const a = pts.get(other.p1)!
      const b = pts.get(other.p2)!
      const d = v2.sub(b, a)
      const m = v2.sub(a, centre)
      const qa = v2.dot(d, d)
      const qb = 2 * v2.dot(m, d)
      const qc = v2.dot(m, m) - R * R
      const disc = qb * qb - 4 * qa * qc
      if (disc <= 0 || qa < 1e-12) continue
      const root = Math.sqrt(disc)
      for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
        if (t > -1e-6 && t < 1 + 1e-6) record([a[0] + d[0] * t, a[1] + d[1] * t])
      }
      continue
    }

    // Circle against circle.
    const c2 = pts.get(other.c)!
    const R2 = other.kind === 'circle' ? other.r : v2.dist(c2, pts.get(other.p1)!)
    const d = v2.dist(centre, c2)
    if (d < 1e-9 || d > R + R2 || d < Math.abs(R - R2)) continue
    const x = (d * d - R2 * R2 + R * R) / (2 * d)
    const hSq = R * R - x * x
    if (hSq < 0) continue
    const h = Math.sqrt(hSq)
    const u = v2.norm(v2.sub(c2, centre))
    const mid = v2.add(centre, v2.scale(u, x))
    const n: Vec2 = [-u[1], u[0]]
    record(v2.add(mid, v2.scale(n, h)))
    record(v2.sub(mid, v2.scale(n, h)))
  }

  return [...new Set(out.map((a) => Math.round(a * 1e9) / 1e9))].sort((p, q) => p - q)
}

/**
 * Cut a piece out of a circle or an arc.
 *
 * This is what turns a crossing into a corner. A line running across a circle
 * shares no endpoint with it, so there is nothing to round; trim the circle
 * back to the crossing and the two now genuinely meet, at which point the
 * existing corner rounding handles it.
 */
export function trimRound(
  sketch: Sketch2D,
  entityId: string,
  at: Vec2,
  nextId: (prefix: string) => string,
): EditResult {
  const entity = sketch.entities.find((e) => e.id === entityId)
  if (!entity || entity.kind === 'line') {
    return { ok: false, message: 'That is not a circle or an arc.' }
  }

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const centre = pts.get(entity.c)!
  const R = entity.kind === 'circle' ? entity.r : v2.dist(centre, pts.get(entity.p1)!)
  const clickAngle = norm(Math.atan2(at[1] - centre[1], at[0] - centre[0]))
  const cuts = crossingAngles(sketch, entity, pts)

  const pointAt = (angle: number): string => {
    const id = nextId('p')
    sketch.points.push({
      id,
      x: centre[0] + R * Math.cos(angle),
      y: centre[1] + R * Math.sin(angle),
    })
    return id
  }
  const drop = () => {
    sketch.entities = sketch.entities.filter((e) => e.id !== entityId)
    sketch.constraints = sketch.constraints.filter(
      (c) => !Object.values(c).includes(entityId),
    )
  }

  if (cuts.length === 0) {
    drop()
    return { ok: true }
  }

  if (entity.kind === 'circle') {
    if (cuts.length === 1) {
      drop()
      return { ok: true }
    }
    // Find the gap between crossings that the click sits in, and keep the rest.
    let from = cuts[cuts.length - 1]
    let to = cuts[0]
    for (let i = 0; i < cuts.length; i++) {
      const a = cuts[i]
      const bAngle = cuts[(i + 1) % cuts.length]
      const span = norm(bAngle - a)
      if (norm(clickAngle - a) <= span + 1e-9) {
        from = a
        to = bAngle
        break
      }
    }
    // What is left runs the other way round, from the far cut back to the near.
    const startId = pointAt(to)
    const endId = pointAt(from)
    sketch.entities = sketch.entities.filter((e) => e.id !== entityId)
    sketch.constraints = sketch.constraints.filter(
      (c) => !Object.values(c).includes(entityId),
    )
    sketch.entities.push({
      id: nextId('e'),
      kind: 'arc',
      c: entity.c,
      p1: startId,
      p2: endId,
      ccw: true,
      construction: entity.construction,
    })
    return { ok: true }
  }

  // An arc: work in its own sweep, then shorten or split.
  const a1 = norm(Math.atan2(pts.get(entity.p1)![1] - centre[1], pts.get(entity.p1)![0] - centre[0]))
  const a2 = norm(Math.atan2(pts.get(entity.p2)![1] - centre[1], pts.get(entity.p2)![0] - centre[0]))
  const sweep = entity.ccw ? norm(a2 - a1) : norm(a1 - a2)
  const along = (angle: number) => (entity.ccw ? norm(angle - a1) : norm(a1 - angle))

  const inside = cuts.map(along).filter((t) => t > 1e-6 && t < sweep - 1e-6).sort((p, q) => p - q)
  const clickT = along(clickAngle)
  if (inside.length === 0 || clickT > sweep) {
    drop()
    return { ok: true }
  }

  const bounds = [0, ...inside, sweep]
  let lo = 0
  let hi = sweep
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (clickT >= bounds[i] && clickT <= bounds[i + 1]) {
      lo = bounds[i]
      hi = bounds[i + 1]
      break
    }
  }
  const angleAt = (t: number) => (entity.ccw ? a1 + t : a1 - t)

  if (lo === 0 && hi === sweep) {
    drop()
  } else if (lo === 0) {
    entity.p1 = pointAt(angleAt(hi))
  } else if (hi === sweep) {
    entity.p2 = pointAt(angleAt(lo))
  } else {
    const tailStart = pointAt(angleAt(hi))
    const originalEnd = entity.p2
    entity.p2 = pointAt(angleAt(lo))
    sketch.entities.push({
      id: nextId('e'),
      kind: 'arc',
      c: entity.c,
      p1: tailStart,
      p2: originalEnd,
      ccw: entity.ccw,
      construction: entity.construction,
    })
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Ready-made shapes
// ---------------------------------------------------------------------------

/**
 * A regular polygon, sized by the circle it fits inside.
 *
 * Dimensioned from that circle rather than by edge length, because that is how
 * hex stock and bolt heads are specified, and because it keeps the shape fully
 * defined with one number.
 */
export function addPolygon(
  sketch: Sketch2D,
  centre: Vec2,
  sides: number,
  radius: number,
  nextId: (prefix: string) => string,
): EditResult {
  const n = Math.round(sides)
  if (n < 3 || n > 64) return { ok: false, message: 'Pick between 3 and 64 sides.' }
  if (!(radius > 0)) return { ok: false, message: 'The size has to be more than zero.' }

  const centreId = nextId('p')
  sketch.points.push({ id: centreId, x: centre[0], y: centre[1] })
  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  const corners: string[] = []
  for (let i = 0; i < n; i++) {
    // First corner straight up, so a hexagon reads flat-to-flat left and right.
    const angle = Math.PI / 2 + (i / n) * Math.PI * 2
    const id = nextId('p')
    sketch.points.push({
      id,
      x: centre[0] + radius * Math.cos(angle),
      y: centre[1] + radius * Math.sin(angle),
    })
    corners.push(id)
    // Tie every corner to the centre, which is what holds it regular.
    add({ kind: 'distanceX', a: centreId, b: id, value: radius * Math.cos(angle) })
    add({ kind: 'distanceY', a: centreId, b: id, value: radius * Math.sin(angle) })
  }
  for (let i = 0; i < n; i++) {
    sketch.entities.push({
      id: nextId('e'),
      kind: 'line',
      p1: corners[i],
      p2: corners[(i + 1) % n],
      construction: false,
    })
  }
  return { ok: true }
}

/**
 * A slot: two parallel sides capped with semicircles. The everyday shape for
 * anything that needs to be adjustable after it is bolted down.
 */
export function addSlot(
  sketch: Sketch2D,
  centre: Vec2,
  length: number,
  width: number,
  nextId: (prefix: string) => string,
): EditResult {
  if (!(width > 0)) return { ok: false, message: 'The width has to be more than zero.' }
  const radius = width / 2
  const straight = length - width
  if (straight <= 0) {
    return {
      ok: false,
      message: `A ${length} mm slot cannot be ${width} mm wide - the length is measured over the round ends, so it has to be the larger of the two.`,
    }
  }

  const half = straight / 2
  const point = (x: number, y: number): string => {
    const id = nextId('p')
    sketch.points.push({ id, x: centre[0] + x, y: centre[1] + y })
    return id
  }
  const leftCentre = point(-half, 0)
  const rightCentre = point(half, 0)
  const topLeft = point(-half, radius)
  const topRight = point(half, radius)
  const bottomRight = point(half, -radius)
  const bottomLeft = point(-half, -radius)

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)
  const top = nextId('e')
  const bottom = nextId('e')
  sketch.entities.push(
    { id: top, kind: 'line', p1: topLeft, p2: topRight, construction: false },
    { id: bottom, kind: 'line', p1: bottomRight, p2: bottomLeft, construction: false },
    {
      id: nextId('e'),
      kind: 'arc',
      c: rightCentre,
      p1: topRight,
      p2: bottomRight,
      ccw: false,
      construction: false,
    },
    {
      id: nextId('e'),
      kind: 'arc',
      c: leftCentre,
      p1: bottomLeft,
      p2: topLeft,
      ccw: false,
      construction: false,
    },
  )

  add({ kind: 'horizontal', e: top })
  add({ kind: 'horizontal', e: bottom })
  add({ kind: 'distanceX', a: leftCentre, b: rightCentre, value: straight })
  add({ kind: 'distanceY', a: leftCentre, b: rightCentre, value: 0 })
  add({ kind: 'distanceX', a: leftCentre, b: topLeft, value: 0 })
  add({ kind: 'distanceY', a: leftCentre, b: topLeft, value: radius })
  add({ kind: 'distanceX', a: leftCentre, b: bottomLeft, value: 0 })
  add({ kind: 'distanceY', a: leftCentre, b: bottomLeft, value: -radius })
  add({ kind: 'distanceX', a: rightCentre, b: topRight, value: 0 })
  add({ kind: 'distanceY', a: rightCentre, b: topRight, value: radius })
  add({ kind: 'distanceX', a: rightCentre, b: bottomRight, value: 0 })
  add({ kind: 'distanceY', a: rightCentre, b: bottomRight, value: -radius })
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
 * Reflect geometry across one of the sketch's own axes.
 *
 * Mirroring about a picked line would be more general, but symmetric parts are
 * nearly always symmetric about the origin, and asking someone to first draw a
 * construction line to mirror about is a step they should not need.
 */
export function mirrorEntities(
  sketch: Sketch2D,
  entityIds: string[],
  axis: 'vertical' | 'horizontal',
  nextId: (prefix: string) => string,
): EditResult {
  if (!entityIds.length) return { ok: false, message: 'Pick something to mirror first.' }

  const reflect = (p: Vec2): Vec2 =>
    axis === 'vertical' ? [-p[0], p[1]] : [p[0], -p[1]]

  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  const before = new Map<string, Vec2>()
  for (const p of sketch.points) before.set(p.id, [p.x, p.y])

  const plan = copyGeometry(sketch, entityIds, reflect, nextId)
  for (const [original, copy] of plan.points) {
    const from = before.get(original)!
    const to = reflect(from)
    add({ kind: 'distanceX', a: original, b: copy, value: to[0] - from[0] })
    add({ kind: 'distanceY', a: original, b: copy, value: to[1] - from[1] })
  }
  tieRadii(sketch, plan, add)
  return { ok: true }
}

/**
 * A parallel copy at a fixed distance: the outline of a wall from the outline
 * of a room, or a cut line inside a panel edge.
 *
 * Each entity is offset on its own rather than the chain being offset as a
 * unit, so corners between offset pieces do not automatically meet. That is
 * honest about what it does - trim or round them afterwards - and it means a
 * single line or circle, which is the common case, always behaves.
 */
export function offsetEntities(
  sketch: Sketch2D,
  entityIds: string[],
  distance: number,
  nextId: (prefix: string) => string,
): EditResult {
  if (!entityIds.length) return { ok: false, message: 'Pick something to offset first.' }
  if (Math.abs(distance) < 1e-9) {
    return { ok: false, message: 'An offset of zero would land on top of the original.' }
  }

  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  const add = (c: NewConstraint) =>
    sketch.constraints.push({ ...c, id: nextId('c') } as never)

  let made = 0
  for (const id of entityIds) {
    const entity = sketch.entities.find((e) => e.id === id)
    if (!entity) continue

    if (entity.kind === 'circle') {
      // Concentric: shares the original centre, so it costs no new freedom.
      const radius = entity.r + distance
      if (radius <= 0) continue
      const copyId = nextId('e')
      sketch.entities.push({
        id: copyId,
        kind: 'circle',
        c: entity.c,
        r: radius,
        construction: entity.construction,
      })
      add({ kind: 'radius', e: copyId, value: radius })
      made++
      continue
    }

    if (entity.kind === 'line') {
      const a = pts.get(entity.p1)!
      const b = pts.get(entity.p2)!
      const dir = v2.norm(v2.sub(b, a))
      if (v2.len(dir) < 1e-9) continue
      const n: Vec2 = [-dir[1], dir[0]]
      const shift = v2.scale(n, distance)
      const p1 = nextId('p')
      const p2 = nextId('p')
      sketch.points.push({ id: p1, x: a[0] + shift[0], y: a[1] + shift[1] })
      sketch.points.push({ id: p2, x: b[0] + shift[0], y: b[1] + shift[1] })
      sketch.entities.push({
        id: nextId('e'),
        kind: 'line',
        p1,
        p2,
        construction: entity.construction,
      })
      for (const [from, to] of [
        [entity.p1, p1],
        [entity.p2, p2],
      ]) {
        add({ kind: 'distanceX', a: from, b: to, value: shift[0] })
        add({ kind: 'distanceY', a: from, b: to, value: shift[1] })
      }
      made++
      continue
    }

    // Arc: same centre, endpoints pushed out or pulled in along their radials.
    const centre = pts.get(entity.c)!
    const radius = v2.dist(centre, pts.get(entity.p1)!) + distance
    if (radius <= 0) continue
    const moved = (id: string): string => {
      const dir = v2.norm(v2.sub(pts.get(id)!, centre))
      const newId = nextId('p')
      sketch.points.push({
        id: newId,
        x: centre[0] + dir[0] * radius,
        y: centre[1] + dir[1] * radius,
      })
      return newId
    }
    const p1 = moved(entity.p1)
    const p2 = moved(entity.p2)
    sketch.entities.push({
      id: nextId('e'),
      kind: 'arc',
      c: entity.c,
      p1,
      p2,
      ccw: entity.ccw,
      construction: entity.construction,
    })
    for (const [from, to] of [
      [entity.p1, p1],
      [entity.p2, p2],
    ]) {
      const a = pts.get(from)!
      const b = sketch.points.find((p) => p.id === to)!
      add({ kind: 'distanceX', a: from, b: to, value: b.x - a[0] })
      add({ kind: 'distanceY', a: from, b: to, value: b.y - a[1] })
    }
    made++
  }

  if (made === 0) return { ok: false, message: 'Nothing there could be offset.' }
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
