import { v2, type Vec2 } from '../core/math'
import { circumcircle } from './tools/shapes'
import { setFixed } from './power'
import type { Constraint, Sketch2D } from './types'

type Ids = (prefix: string) => string

export interface ProjectResult {
  ok: boolean
  added: string[]
  message?: string
}

function simplify(points: readonly Vec2[], tolerance: number): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    if (!out.length || v2.dist(out[out.length - 1], p) > tolerance) out.push(p)
  }
  return out
}

function onLine(points: readonly Vec2[], tolerance: number): boolean {
  const a = points[0]
  const b = points[points.length - 1]
  const d = v2.sub(b, a)
  const length = v2.len(d)
  if (length < tolerance) return false
  const u = v2.scale(d, 1 / length)
  return points.every((p) => Math.abs(v2.cross(u, v2.sub(p, a))) <= tolerance)
}

function onCircle(points: readonly Vec2[], tolerance: number) {
  if (points.length < 4) return null
  const a = points[0]
  const b = points[Math.floor(points.length / 3)]
  const c = points[Math.floor((2 * points.length) / 3)]
  const fit = circumcircle(a, b, c)
  if (!fit) return null
  return points.every((p) => Math.abs(v2.dist(p, fit.centre) - fit.radius) <= tolerance)
    ? fit
    : null
}

export function chainSegments(segments: ReadonlyArray<[Vec2, Vec2]>, tolerance: number): Vec2[][] {
  const remaining = segments.map((s) => [...s] as [Vec2, Vec2])
  const chains: Vec2[][] = []
  while (remaining.length) {
    const chain = [...remaining.shift()!]
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < remaining.length; i++) {
        const [p, q] = remaining[i]
        const head = chain[0]
        const tail = chain[chain.length - 1]
        if (v2.dist(tail, p) <= tolerance) chain.push(q)
        else if (v2.dist(tail, q) <= tolerance) chain.push(p)
        else if (v2.dist(head, q) <= tolerance) chain.unshift(p)
        else if (v2.dist(head, p) <= tolerance) chain.unshift(q)
        else continue
        remaining.splice(i, 1)
        grew = true
        break
      }
    }
    chains.push(chain)
  }
  return chains
}

export function projectPolylines(
  sketch: Sketch2D,
  polylines: readonly Vec2[][],
  ids: Ids,
  tolerance = 1e-3,
): ProjectResult {
  const added: string[] = []
  const pointAt = (p: Vec2): string => {
    const existing = sketch.points.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) <= tolerance)
    if (existing) return existing.id
    const id = ids('p')
    sketch.points.push({ id, x: p[0], y: p[1] })
    return id
  }
  for (const raw of polylines) {
    const points = simplify(raw, tolerance * 0.1)
    if (points.length < 2) continue
    const closed = points.length > 3 && v2.dist(points[0], points[points.length - 1]) <= tolerance
    const scale = Math.max(...points.map((p) => v2.dist(p, points[0])), tolerance)
    const fitTolerance = Math.max(tolerance, scale * 1e-4)
    if (onLine(points, fitTolerance) && !closed) {
      const id = ids('e')
      sketch.entities.push({
        id,
        kind: 'line',
        p1: pointAt(points[0]),
        p2: pointAt(points[points.length - 1]),
        construction: false,
      })
      added.push(id)
      continue
    }
    const circle = onCircle(closed ? points.slice(0, -1) : points, fitTolerance)
    if (circle && closed) {
      const id = ids('e')
      sketch.entities.push({
        id,
        kind: 'circle',
        c: pointAt(circle.centre),
        r: circle.radius,
        construction: false,
      })
      added.push(id)
      continue
    }
    if (circle) {
      const start = points[0]
      const end = points[points.length - 1]
      const middle = points[Math.floor(points.length / 2)]
      const a0 = Math.atan2(start[1] - circle.centre[1], start[0] - circle.centre[0])
      const a1 = Math.atan2(end[1] - circle.centre[1], end[0] - circle.centre[0])
      const am = Math.atan2(middle[1] - circle.centre[1], middle[0] - circle.centre[0])
      const tau = Math.PI * 2
      const wrap = (x: number) => ((x % tau) + tau) % tau
      const ccw = wrap(am - a0) <= wrap(a1 - a0)
      const id = ids('e')
      sketch.entities.push({
        id,
        kind: 'arc',
        c: pointAt(circle.centre),
        p1: pointAt(start),
        p2: pointAt(end),
        ccw,
        construction: false,
      })
      added.push(id)
      continue
    }
    const through = closed ? points.slice(0, -1) : points
    const count = Math.min(12, through.length)
    const chosen: Vec2[] = []
    for (let i = 0; i < count; i++) {
      chosen.push(through[Math.round((i * (through.length - 1)) / Math.max(1, count - 1))])
    }
    const segments = closed
      ? [
          chosen.slice(0, Math.ceil(count / 2) + 1),
          [...chosen.slice(Math.ceil(count / 2)), chosen[0]],
        ]
      : [chosen]
    for (const part of segments) {
      if (part.length < 2) continue
      const id = ids('e')
      sketch.entities.push({
        id,
        kind: 'spline',
        mode: 'fit',
        points: part.map(pointAt),
        construction: false,
      })
      added.push(id)
    }
  }
  if (!added.length) return { ok: false, added, message: 'Nothing there could be projected.' }
  setFixed(sketch, added, true, ids)
  sketch.constraints = dedupeFixes(sketch.constraints)
  return { ok: true, added }
}

function dedupeFixes(constraints: Constraint[]): Constraint[] {
  const seen = new Set<string>()
  return constraints.filter((c) => {
    if (c.kind !== 'fix') return true
    if (seen.has(c.p)) return false
    seen.add(c.p)
    return true
  })
}
