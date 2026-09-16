import { v2, type Vec2 } from '../core/math'
import {
  arcGeometry,
  curveOf,
  entityEnds,
  pointLookup,
  sampleCurve,
  type PointLookup,
} from './curves'
import type { ModifyResult } from './modify'
import type { Constraint, NewConstraint, Sketch2D, SketchEntity } from './types'

type Ids = (prefix: string) => string

interface Step {
  entity: SketchEntity
  forward: boolean
}

interface Offsetted {
  kind: 'line' | 'arc' | 'circle' | 'spline'
  start: Vec2
  end: Vec2
  centre?: Vec2
  radius?: number
  ccw?: boolean
  samples?: Vec2[]
  source: Step
}

function chainsOf(entities: SketchEntity[]): Step[][] {
  const open = entities.filter((e) => entityEnds(e))
  const closedOnes = entities.filter((e) => !entityEnds(e))
  const used = new Set<string>()
  const chains: Step[][] = closedOnes.map((entity) => [{ entity, forward: true }])
  const byPoint = new Map<string, SketchEntity[]>()
  for (const e of open) {
    for (const p of entityEnds(e)!) byPoint.set(p, [...(byPoint.get(p) ?? []), e])
  }
  for (const seed of open) {
    if (used.has(seed.id)) continue
    used.add(seed.id)
    const chain: Step[] = [{ entity: seed, forward: true }]
    const grow = (atEnd: boolean) => {
      for (;;) {
        const tip = atEnd ? chain[chain.length - 1] : chain[0]
        const ends = entityEnds(tip.entity)!
        const point = atEnd === tip.forward ? ends[1] : ends[0]
        const next = (byPoint.get(point) ?? []).find((e) => !used.has(e.id))
        if (!next) return
        used.add(next.id)
        const [first] = entityEnds(next)!
        const step = { entity: next, forward: atEnd ? first === point : first !== point }
        if (atEnd) chain.push(step)
        else chain.unshift(step)
      }
    }
    grow(true)
    grow(false)
    chains.push(chain)
  }
  return chains
}

function isClosedChain(chain: Step[]): boolean {
  if (chain.length === 1) return !entityEnds(chain[0].entity)
  const first = entityEnds(chain[0].entity)!
  const last = entityEnds(chain[chain.length - 1].entity)!
  const start = chain[0].forward ? first[0] : first[1]
  const end = chain[chain.length - 1].forward ? last[1] : last[0]
  return start === end
}

function chainArea(chain: Step[], pts: PointLookup): number {
  const polygon: Vec2[] = []
  for (const step of chain) {
    const curve = curveOf(step.entity, pts)
    if (!curve) continue
    const samples = sampleCurve(curve, 1e-3).p
    polygon.push(...(step.forward ? samples : [...samples].reverse()))
  }
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    area += p[0] * q[1] - q[0] * p[1]
  }
  return area / 2
}

function offsetStep(step: Step, distance: number, pts: PointLookup): Offsetted | null {
  const e = step.entity
  const sign = step.forward ? 1 : -1
  if (e.kind === 'line') {
    const a = pts.get(step.forward ? e.p1 : e.p2)!
    const b = pts.get(step.forward ? e.p2 : e.p1)!
    const u = v2.norm(v2.sub(b, a))
    const n: Vec2 = [-u[1], u[0]]
    const shift = v2.scale(n, distance)
    return { kind: 'line', start: v2.add(a, shift), end: v2.add(b, shift), source: step }
  }
  if (e.kind === 'arc') {
    const g = arcGeometry(e, pts)
    const travelCcw = g.sweep > 0 === step.forward
    const radius = g.radius + (travelCcw ? -distance : distance)
    if (radius <= 1e-9) return null
    const startAngle = step.forward ? g.start : g.start + g.sweep
    const endAngle = step.forward ? g.start + g.sweep : g.start
    return {
      kind: 'arc',
      centre: g.centre,
      radius,
      ccw: travelCcw,
      start: [
        g.centre[0] + radius * Math.cos(startAngle),
        g.centre[1] + radius * Math.sin(startAngle),
      ],
      end: [g.centre[0] + radius * Math.cos(endAngle), g.centre[1] + radius * Math.sin(endAngle)],
      source: step,
    }
  }
  if (e.kind === 'circle') {
    const radius = Math.abs(e.r) - distance
    if (radius <= 1e-9) return null
    const centre = pts.get(e.c)!
    return { kind: 'circle', centre, radius, start: centre, end: centre, source: step }
  }
  if (e.kind === 'spline' || e.kind === 'ellipse' || e.kind === 'ellipticalArc') {
    const curve = curveOf(e, pts)
    if (!curve) return null
    const count = 24
    const samples: Vec2[] = []
    for (let i = 0; i <= count; i++) {
      const s = step.forward ? i / count : 1 - i / count
      const d = curve.d1(s)
      const t = v2.norm(v2.scale(d, sign))
      samples.push(v2.add(curve.at(s), v2.scale([-t[1], t[0]], distance)))
    }
    return {
      kind: 'spline',
      samples,
      start: samples[0],
      end: samples[samples.length - 1],
      source: step,
    }
  }
  return null
}

function lineLineMeet(a: Offsetted, b: Offsetted): Vec2 | null {
  const r = v2.sub(a.end, a.start)
  const s = v2.sub(b.end, b.start)
  const den = v2.cross(r, s)
  if (Math.abs(den) < 1e-12 * Math.max(1, v2.dot(r, r))) return null
  const t = v2.cross(v2.sub(b.start, a.start), s) / den
  return v2.add(a.start, v2.scale(r, t))
}

function lineCircleMeet(line: Offsetted, circle: Offsetted, near: Vec2): Vec2 | null {
  const d = v2.sub(line.end, line.start)
  const m = v2.sub(line.start, circle.centre!)
  const qa = v2.dot(d, d)
  const qb = 2 * v2.dot(m, d)
  const qc = v2.dot(m, m) - circle.radius! * circle.radius!
  const disc = qb * qb - 4 * qa * qc
  if (disc < 0 || qa < 1e-18) return null
  const root = Math.sqrt(disc)
  const hits = [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].map((t) =>
    v2.add(line.start, v2.scale(d, t)),
  )
  return hits.sort((p, q) => v2.dist(p, near) - v2.dist(q, near))[0]
}

function circleCircleMeet(a: Offsetted, b: Offsetted, near: Vec2): Vec2 | null {
  const d = v2.dist(a.centre!, b.centre!)
  if (d < 1e-12) return null
  const ra = a.radius!
  const rb = b.radius!
  if (d > ra + rb + 1e-9 || d < Math.abs(ra - rb) - 1e-9) return null
  const x = (d * d - rb * rb + ra * ra) / (2 * d)
  const h = Math.sqrt(Math.max(0, ra * ra - x * x))
  const u = v2.scale(v2.sub(b.centre!, a.centre!), 1 / d)
  const mid = v2.add(a.centre!, v2.scale(u, x))
  const n: Vec2 = [-u[1], u[0]]
  const hits = [v2.add(mid, v2.scale(n, h)), v2.sub(mid, v2.scale(n, h))]
  return hits.sort((p, q) => v2.dist(p, near) - v2.dist(q, near))[0]
}

function meet(a: Offsetted, b: Offsetted): Vec2 {
  const near = v2.mid(a.end, b.start)
  if (v2.dist(a.end, b.start) < 1e-9) return near
  let hit: Vec2 | null = null
  if (a.kind === 'line' && b.kind === 'line') hit = lineLineMeet(a, b)
  else if (a.kind === 'line' && b.kind === 'arc') hit = lineCircleMeet(a, b, near)
  else if (a.kind === 'arc' && b.kind === 'line') hit = lineCircleMeet(b, a, near)
  else if (a.kind === 'arc' && b.kind === 'arc') hit = circleCircleMeet(a, b, near)
  if (!hit || v2.dist(hit, near) > 10 * (v2.dist(a.end, b.start) + 1e-6) + 1e3) return near
  return hit
}

export function offsetChains(
  sketch: Sketch2D,
  entityIds: readonly string[],
  distance: number,
  ids: Ids,
): ModifyResult {
  if (Math.abs(distance) < 1e-9) return { ok: false, message: 'Offset by more than zero.' }
  const chosen = sketch.entities.filter(
    (e) => entityIds.includes(e.id) && e.kind !== 'point' && e.kind !== 'text',
  )
  if (!chosen.length) return { ok: false, message: 'Select the curves to offset first.' }
  const pts = pointLookup(sketch)
  const add = (c: NewConstraint) => sketch.constraints.push({ ...c, id: ids('c') } as Constraint)
  let made = 0
  for (const chain of chainsOf(chosen)) {
    const closed = isClosedChain(chain)
    const left = closed ? (chainArea(chain, pts) < 0 ? distance : -distance) : distance
    const pieces = chain.map((step) => offsetStep(step, left, pts))
    if (pieces.some((piece) => !piece)) {
      return { ok: false, message: 'That offset is bigger than one of the curves can take.' }
    }
    const offsets = pieces as Offsetted[]
    const joints: Vec2[] = []
    for (let i = 0; i + 1 < offsets.length; i++) joints.push(meet(offsets[i], offsets[i + 1]))
    if (closed && offsets.length > 1) joints.push(meet(offsets[offsets.length - 1], offsets[0]))
    const pointIds = new Map<string, string>()
    const pointFor = (key: string, p: Vec2) => {
      const existing = pointIds.get(key)
      if (existing) return existing
      const id = ids('p')
      sketch.points.push({ id, x: p[0], y: p[1] })
      pointIds.set(key, id)
      return id
    }
    offsets.forEach((piece, i) => {
      const startKey =
        i === 0 ? (closed && offsets.length > 1 ? `j${offsets.length - 1}` : 's') : `j${i - 1}`
      const endKey =
        i === offsets.length - 1 ? (closed && offsets.length > 1 ? `j${i}` : 'e') : `j${i}`
      const startPoint =
        i === 0
          ? closed && offsets.length > 1
            ? joints[joints.length - 1]
            : piece.start
          : joints[i - 1]
      const endPoint =
        i === offsets.length - 1
          ? closed && offsets.length > 1
            ? joints[i]
            : piece.end
          : joints[i]
      const source = piece.source.entity
      if (source.kind === 'ellipse' && piece.samples) {
        const samples = piece.samples
        const half = Math.floor(samples.length / 2)
        const start = pointFor('ellipse-start', samples[0])
        const middle = pointFor('ellipse-middle', samples[half])
        const inner = (from: number, to: number) =>
          samples.slice(from, to).map((p) => {
            const pid = ids('p')
            sketch.points.push({ id: pid, x: p[0], y: p[1] })
            return pid
          })
        sketch.entities.push(
          {
            id: ids('e'),
            kind: 'spline',
            mode: 'fit',
            points: [start, ...inner(1, half), middle],
            construction: source.construction,
          },
          {
            id: ids('e'),
            kind: 'spline',
            mode: 'fit',
            points: [middle, ...inner(half + 1, samples.length - 1), start],
            construction: source.construction,
          },
        )
        made++
        return
      }
      if (piece.kind === 'circle') {
        const id = ids('e')
        sketch.entities.push({
          id,
          kind: 'circle',
          c: (source as { c: string }).c,
          r: piece.radius!,
          construction: source.construction,
        })
        add({ kind: 'concentric', a: source.id, b: id })
        made++
        return
      }
      const p1 = pointFor(startKey, startPoint)
      const p2 = pointFor(endKey, endPoint)
      const id = ids('e')
      if (piece.kind === 'line') {
        sketch.entities.push({ id, kind: 'line', p1, p2, construction: source.construction })
        add({ kind: 'parallel', a: source.id, b: id })
        add({ kind: 'pointLineDistance', p: p1, e: source.id, value: Math.abs(distance) })
      } else if (piece.kind === 'arc') {
        const centre = (source as { c: string }).c
        sketch.entities.push({
          id,
          kind: 'arc',
          c: centre,
          p1,
          p2,
          ccw: piece.ccw!,
          construction: source.construction,
        })
      } else {
        const inner = piece.samples!.slice(1, -1).map((p) => {
          const pid = ids('p')
          sketch.points.push({ id: pid, x: p[0], y: p[1] })
          return pid
        })
        sketch.entities.push({
          id,
          kind: 'spline',
          mode: 'fit',
          points: [p1, ...inner, p2],
          construction: source.construction,
        })
      }
      made++
    })
  }
  if (!made) return { ok: false, message: 'Nothing there could be offset.' }
  return { ok: true }
}
