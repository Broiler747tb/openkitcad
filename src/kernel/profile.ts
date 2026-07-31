/**
 * Turning a constraint-solved 2D sketch into a closed B-rep profile.
 *
 * This is the step where a sketch stops being a pile of line segments and
 * becomes something extrudable, and it is where most "why won't it extrude?"
 * frustration lives. Two decisions matter:
 *
 * - Connectivity is decided by *position*, not by shared point ids. Two lines
 *   joined by a coincident constraint keep separate point ids that the solver
 *   drives to the same coordinates, and a user can also just draw two ends on
 *   top of each other. Snapping on position catches both.
 *
 * - Nesting uses the even-odd rule, so a hole inside a hole comes back as
 *   solid, which is what anyone drawing a washer inside a plate expects.
 */
import { draw, drawCircle, type Drawing } from 'replicad'
import type { Vec2 } from '../core/math'
import type { ArcEntity, Sketch2D, SketchEntity } from '../sketch/types'

/** Points closer than this are treated as the same node, in mm. */
const WELD_TOLERANCE = 1e-6

export interface ProfileResult {
  drawing: Drawing | null
  /** Entities that could not be joined into a closed loop. */
  openChains: number
  closedLoops: number
}

interface Node {
  key: string
  p: Vec2
}

const nodeKey = (p: Vec2) =>
  `${Math.round(p[0] / WELD_TOLERANCE)},${Math.round(p[1] / WELD_TOLERANCE)}`

interface Step {
  entity: SketchEntity
  /** True when the loop traverses this entity from p2 to p1. */
  reversed: boolean
}

/** Arc midpoint, needed because replicad builds arcs from three points. */
export function arcMidpoint(arc: ArcEntity, pts: Map<string, Vec2>): Vec2 {
  const c = pts.get(arc.c)!
  const p1 = pts.get(arc.p1)!
  const p2 = pts.get(arc.p2)!
  const r = Math.hypot(p1[0] - c[0], p1[1] - c[1])
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0])
  const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0])
  const TAU = Math.PI * 2
  let sweep = arc.ccw ? a2 - a1 : a1 - a2
  sweep = ((sweep % TAU) + TAU) % TAU
  if (sweep < 1e-9) sweep = TAU
  const mid = arc.ccw ? a1 + sweep / 2 : a1 - sweep / 2
  return [c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid)]
}

/** Sample an entity into a polyline, used for containment and area tests. */
function samplePolyline(step: Step, pts: Map<string, Vec2>, out: Vec2[]): void {
  const e = step.entity
  if (e.kind === 'line') {
    out.push(pts.get(step.reversed ? e.p1 : e.p2)!)
    return
  }
  if (e.kind === 'arc') {
    const c = pts.get(e.c)!
    const from = pts.get(step.reversed ? e.p2 : e.p1)!
    const to = pts.get(step.reversed ? e.p1 : e.p2)!
    const r = Math.hypot(from[0] - c[0], from[1] - c[1])
    const a1 = Math.atan2(from[1] - c[1], from[0] - c[0])
    const a2 = Math.atan2(to[1] - c[1], to[0] - c[0])
    const TAU = Math.PI * 2
    const ccw = step.reversed ? !e.ccw : e.ccw
    let sweep = ccw ? a2 - a1 : a1 - a2
    sweep = ((sweep % TAU) + TAU) % TAU
    if (sweep < 1e-9) sweep = TAU
    const segments = Math.max(4, Math.ceil((sweep / TAU) * 32))
    for (let i = 1; i <= segments; i++) {
      const a = ccw ? a1 + (sweep * i) / segments : a1 - (sweep * i) / segments
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
    }
  }
}

function signedArea(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1]
    const yj = poly[j][1]
    if (yi > pt[1] !== yj > pt[1]) {
      const x = ((poly[j][0] - poly[i][0]) * (pt[1] - yi)) / (yj - yi) + poly[i][0]
      if (pt[0] < x) inside = !inside
    }
  }
  return inside
}

interface Loop {
  steps: Step[]
  polygon: Vec2[]
  area: number
  /** Set for a standalone circle, which needs no traversal. */
  circle?: { c: Vec2; r: number }
}

/**
 * Walk the sketch graph and collect closed loops. Entities that never close a
 * loop are counted so the UI can say "this shape isn't closed yet".
 */
function findLoops(sketch: Sketch2D): { loops: Loop[]; openChains: number } {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const loops: Loop[] = []
  const chained = sketch.entities.filter(
    (e) => !e.construction && (e.kind === 'line' || e.kind === 'arc'),
  )

  // Circles are already closed; take them straight out.
  for (const e of sketch.entities) {
    if (e.construction || e.kind !== 'circle') continue
    const c = pts.get(e.c)!
    const polygon: Vec2[] = []
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      polygon.push([c[0] + e.r * Math.cos(a), c[1] + e.r * Math.sin(a)])
    }
    loops.push({
      steps: [],
      polygon,
      area: Math.abs(Math.PI * e.r * e.r),
      circle: { c, r: e.r },
    })
  }

  // Adjacency by welded position.
  const adjacency = new Map<string, Array<{ index: number; atStart: boolean }>>()
  const nodeOf = (e: SketchEntity, start: boolean): Node => {
    const id = e.kind === 'line' || e.kind === 'arc' ? (start ? e.p1 : e.p2) : e.c
    const p = pts.get(id)!
    return { key: nodeKey(p), p }
  }
  chained.forEach((e, index) => {
    for (const atStart of [true, false]) {
      const k = nodeOf(e, atStart).key
      const list = adjacency.get(k) ?? []
      list.push({ index, atStart })
      adjacency.set(k, list)
    }
  })

  const used = new Uint8Array(chained.length)
  let openChains = 0

  for (let seed = 0; seed < chained.length; seed++) {
    if (used[seed]) continue
    const steps: Step[] = []
    // Annotated rather than inferred: `reversed` feeds the lookup that decides
    // the next `reversed`, and TypeScript will not untangle that on its own.
    let index: number = seed
    let reversed: boolean = false
    const startKey = nodeOf(chained[seed], true).key
    let closed = false

    for (let guard = 0; guard < chained.length + 1; guard++) {
      used[index] = 1
      steps.push({ entity: chained[index], reversed })
      // `reversed ? p1 : p2` - the end we arrived at travelling this way.
      const endKey: string = nodeOf(chained[index], reversed).key
      if (endKey === startKey && steps.length > 1) {
        closed = true
        break
      }
      const candidates: Array<{ index: number; atStart: boolean }> = (
        adjacency.get(endKey) ?? []
      ).filter((c) => !used[c.index])
      if (candidates.length === 0) break
      const next: { index: number; atStart: boolean } = candidates[0]
      index = next.index
      // If we arrived at this entity's start node we traverse it forwards.
      reversed = !next.atStart
    }

    if (!closed) {
      openChains += steps.length
      continue
    }

    const polygon: Vec2[] = [pts.get(stepStartId(steps[0]))!]
    for (const s of steps) samplePolyline(s, pts, polygon)
    loops.push({ steps, polygon, area: Math.abs(signedArea(polygon)) })
  }

  return { loops, openChains }
}

function stepStartId(step: Step): string {
  const e = step.entity
  if (e.kind === 'circle') return e.c
  return step.reversed ? e.p2 : e.p1
}

function stepEndId(step: Step): string {
  const e = step.entity
  if (e.kind === 'circle') return e.c
  return step.reversed ? e.p1 : e.p2
}

/**
 * Whether a sketch encloses anything, without touching the geometry kernel.
 *
 * The UI needs this on every render to decide if "Make solid" should be
 * enabled, and the UI runs on the main thread where OpenCascade does not
 * exist. Loop-finding is pure arithmetic, so it is safe to expose separately;
 * only `sketchToProfile` below actually builds B-rep and must stay in the
 * worker.
 */
export function sketchLoopSummary(sketch: Sketch2D): {
  closedLoops: number
  openChains: number
} {
  const { loops, openChains } = findLoops(sketch)
  return { closedLoops: loops.length, openChains }
}

/** Build a replicad Drawing for one closed loop. */
function loopToDrawing(loop: Loop, pts: Map<string, Vec2>): Drawing {
  if (loop.circle) {
    return drawCircle(loop.circle.r).translate(loop.circle.c[0], loop.circle.c[1])
  }
  const start = pts.get(stepStartId(loop.steps[0]))!
  const pen = draw(start)
  for (const step of loop.steps) {
    const end = pts.get(stepEndId(step))!
    if (step.entity.kind === 'line') {
      pen.lineTo(end)
    } else if (step.entity.kind === 'arc') {
      pen.threePointsArcTo(end, arcMidpoint(step.entity, pts))
    }
  }
  return pen.close()
}

/**
 * Convert a whole sketch into a single Drawing, with inner loops cut out.
 * Returns null when there is nothing closed to extrude.
 */
export function sketchToProfile(sketch: Sketch2D): ProfileResult {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const { loops, openChains } = findLoops(sketch)
  if (loops.length === 0) return { drawing: null, openChains, closedLoops: 0 }

  // Largest first, so containment can be decided by looking only at earlier
  // loops. A loop nested an odd number of deep is a hole.
  const ordered = [...loops].sort((a, b) => b.area - a.area)
  let result: Drawing | null = null

  for (let i = 0; i < ordered.length; i++) {
    const loop = ordered[i]
    const probe = loop.polygon[0]
    let depth = 0
    for (let j = 0; j < i; j++) {
      if (pointInPolygon(probe, ordered[j].polygon)) depth++
    }
    const piece = loopToDrawing(loop, pts)
    if (!result) {
      result = piece
    } else if (depth % 2 === 1) {
      result = result.cut(piece)
    } else {
      result = result.fuse(piece)
    }
  }

  return { drawing: result, openChains, closedLoops: loops.length }
}
