import { v2, type Vec2 } from '../core/math'
import {
  closestPoint,
  curveOf,
  entityEnds,
  intersectEntities,
  isCurveEntity,
  pointLookup,
  sampleCurve,
  sketchBounds,
  type Curve,
  type PointLookup,
} from './curves'
import type { Sketch2D, SketchEntity } from './types'

export interface RegionPiece {
  entityId: string
  from: number
  to: number
  label: string
  token: string
  causes: [string, string]
}

export interface RegionRing {
  pieces: RegionPiece[]
  polygon: Vec2[]
  area: number
}

export interface Region {
  key: string
  outer: RegionRing
  holes: RegionRing[]
  area: number
  inside: Vec2
  solid: boolean
}

export interface RegionResult {
  regions: Region[]
  dangling: string[]
}

export interface ProfileLoop {
  outer: RegionRing
  holes: RegionRing[]
}

export type ProfileSelection =
  | { ok: true; loops: ProfileLoop[]; regions: Region[] }
  | { ok: false; missing: string[]; empty: boolean; dangling: string[] }

interface Split {
  s: number
  causes: Set<string>
}

interface Piece {
  entity: SketchEntity
  curve: Curve
  a: number
  b: number
  startLabel: string
  endLabel: string
  closedLoop: boolean
  start: number
  end: number
}

interface HalfEdge {
  piece: number
  forward: boolean
  from: number
  to: number
  angle: number
}

const MAX_ENTITIES = 4000

function signedArea(polygon: readonly Vec2[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    area += p[0] * q[1] - q[0] * p[1]
  }
  return area / 2
}

const GAUSS_NODES = [
  -0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664,
]
const GAUSS_WEIGHTS = [
  0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647,
  0.23692688505618908,
]

function pieceArea(curve: Curve, from: number, to: number): number {
  const slices = 24
  let total = 0
  for (let k = 0; k < slices; k++) {
    const a = from + ((to - from) * k) / slices
    const b = from + ((to - from) * (k + 1)) / slices
    const half = (b - a) / 2
    const middle = (a + b) / 2
    for (let i = 0; i < GAUSS_NODES.length; i++) {
      const s = middle + half * GAUSS_NODES[i]
      const p = curve.at(s)
      const d = curve.d1(s)
      total += GAUSS_WEIGHTS[i] * half * (p[0] * d[1] - p[1] * d[0])
    }
  }
  return total / 2
}

function contains(polygon: readonly Vec2[], point: Vec2): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > point[1] !== yj > point[1]) {
      const x = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
      if (point[0] < x) inside = !inside
    }
  }
  return inside
}

function interiorPoint(outer: readonly Vec2[], holes: ReadonlyArray<readonly Vec2[]>): Vec2 {
  const rings = [outer, ...holes]
  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of outer) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  let best: { point: Vec2; width: number } | null = null
  for (const fraction of [0.5, 0.37, 0.63, 0.21, 0.79, 0.11, 0.89]) {
    const y = minY + (maxY - minY) * fraction
    const xs: number[] = []
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
      }
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1] - xs[k]
      if (!best || width > best.width) best = { point: [(xs[k] + xs[k + 1]) / 2, y], width }
    }
    if (best && best.width > (maxY - minY) * 0.05) break
  }
  return best?.point ?? outer[0] ?? [0, 0]
}

function orderLabel(causes: Set<string>): string {
  return [...causes].sort().join('+')
}

export function sketchRegions(sketch: Sketch2D): RegionResult {
  const pts: PointLookup = pointLookup(sketch)
  const curves = sketch.entities
    .filter((e) => !e.construction && isCurveEntity(e))
    .slice(0, MAX_ENTITIES)
    .flatMap((entity) => {
      const curve = curveOf(entity, pts)
      return curve ? [{ entity, curve }] : []
    })
  if (!curves.length) return { regions: [], dangling: [] }
  const bounds = sketchBounds(
    sketch,
    curves.map((c) => c.entity.id),
  )
  const scale = bounds
    ? Math.max(Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]), 1e-6)
    : 1
  const weld = Math.max(scale * 1e-7, 1e-9)
  const sampleTolerance = Math.max(scale * 2e-4, 1e-6)

  const splits = curves.map(({ entity, curve }) => {
    const list: Split[] = []
    const add = (s: number, cause: string) => {
      const at = curve.at(s)
      const existing = list.find((split) => v2.dist(curve.at(split.s), at) <= weld * 10)
      if (existing) existing.causes.add(cause)
      else list.push({ s, causes: new Set([cause]) })
    }
    if (!curve.closed) {
      const ends = entityEnds(entity)
      add(0, ends ? `p:${ends[0]}` : 'start')
      add(1, ends ? `p:${ends[1]}` : 'end')
    }
    return { add, list }
  })

  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const crossings = intersectEntities(curves[i].entity, curves[j].entity, pts)
      const counts = new Map<string, number>()
      for (const crossing of crossings) {
        const bump = (key: string) => {
          const n = (counts.get(key) ?? 0) + 1
          counts.set(key, n)
          return n
        }
        const na = bump(`a${curves[j].entity.id}`)
        const nb = bump(`b${curves[i].entity.id}`)
        splits[i].add(crossing.sa, na > 1 ? `${curves[j].entity.id}@${na}` : curves[j].entity.id)
        splits[j].add(crossing.sb, nb > 1 ? `${curves[i].entity.id}@${nb}` : curves[i].entity.id)
      }
    }
  }

  for (let i = 0; i < curves.length; i++) {
    for (const other of curves) {
      if (other.entity.id === curves[i].entity.id) continue
      const ends = entityEnds(other.entity)
      if (!ends) continue
      for (const pointId of ends) {
        const p = pts.get(pointId)
        if (!p) continue
        const hit = closestPoint(curves[i].entity, pts, p)
        if (hit.distance <= weld * 10) splits[i].add(hit.s, `p:${pointId}`)
      }
    }
  }

  const pieces: Piece[] = []
  curves.forEach(({ entity, curve }, index) => {
    const list = [...splits[index].list].sort((p, q) => p.s - q.s)
    if (curve.closed) {
      const wrapped = list.map((split) => ({ ...split, s: ((split.s % 1) + 1) % 1 }))
      wrapped.sort((p, q) => p.s - q.s)
      if (!wrapped.length) {
        pieces.push({
          entity,
          curve,
          a: 0,
          b: 1,
          startLabel: '',
          endLabel: '',
          closedLoop: true,
          start: -1,
          end: -1,
        })
        return
      }
      for (let k = 0; k < wrapped.length; k++) {
        const from = wrapped[k]
        const next = wrapped[(k + 1) % wrapped.length]
        const b = k + 1 < wrapped.length ? next.s : next.s + 1
        if (b - from.s < 1e-12) continue
        pieces.push({
          entity,
          curve,
          a: from.s,
          b,
          startLabel: orderLabel(from.causes),
          endLabel: orderLabel(next.causes),
          closedLoop: false,
          start: -1,
          end: -1,
        })
      }
      return
    }
    for (let k = 0; k + 1 < list.length; k++) {
      if (v2.dist(curve.at(list[k].s), curve.at(list[k + 1].s)) <= weld * 10) continue
      pieces.push({
        entity,
        curve,
        a: list[k].s,
        b: list[k + 1].s,
        startLabel: orderLabel(list[k].causes),
        endLabel: orderLabel(list[k + 1].causes),
        closedLoop: false,
        start: -1,
        end: -1,
      })
    }
  })

  const nodes: Vec2[] = []
  const grid = new Map<string, number[]>()
  const cell = weld * 20
  const nodeAt = (p: Vec2): number => {
    const gx = Math.floor(p[0] / cell)
    const gy = Math.floor(p[1] / cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const index of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (v2.dist(nodes[index], p) <= weld * 10) return index
        }
      }
    }
    nodes.push(p)
    const key = `${gx},${gy}`
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1])
    return nodes.length - 1
  }
  for (const piece of pieces) {
    if (piece.closedLoop) continue
    piece.start = nodeAt(piece.curve.at(piece.a))
    piece.end = nodeAt(piece.curve.at(piece.b))
  }

  const alive = pieces.map(
    (piece) => piece.closedLoop || piece.start !== piece.end || piece.b - piece.a > 1e-9,
  )
  const degree = new Map<number, number>()
  const bump = (node: number, by: number) => degree.set(node, (degree.get(node) ?? 0) + by)
  pieces.forEach((piece, index) => {
    if (!alive[index] || piece.closedLoop) return
    bump(piece.start, 1)
    bump(piece.end, 1)
  })
  let pruned = true
  while (pruned) {
    pruned = false
    pieces.forEach((piece, index) => {
      if (!alive[index] || piece.closedLoop) return
      if (piece.start === piece.end) return
      if ((degree.get(piece.start) ?? 0) <= 1 || (degree.get(piece.end) ?? 0) <= 1) {
        alive[index] = false
        bump(piece.start, -1)
        bump(piece.end, -1)
        pruned = true
      }
    })
  }
  const dangling = [
    ...new Set(pieces.filter((_, index) => !alive[index]).map((piece) => piece.entity.id)),
  ].filter((id) => pieces.every((piece, index) => piece.entity.id !== id || !alive[index]))

  const sampled = pieces.map(
    (piece) => sampleCurve(piece.curve, sampleTolerance, piece.a, piece.b).p,
  )
  const ringOf = (steps: Array<{ piece: number; forward: boolean }>): RegionRing => {
    const polygon: Vec2[] = []
    const ringPieces: RegionPiece[] = []
    let area = 0
    for (const step of steps) {
      const piece = pieces[step.piece]
      area += step.forward
        ? pieceArea(piece.curve, piece.a, piece.b)
        : -pieceArea(piece.curve, piece.a, piece.b)
      const points = step.forward ? sampled[step.piece] : [...sampled[step.piece]].reverse()
      polygon.push(...points.slice(0, -1))
      const whole = piece.closedLoop || (!piece.curve.closed && piece.a === 0 && piece.b === 1)
      const token = `${piece.entity.id}[${piece.startLabel}|${piece.endLabel}]`
      ringPieces.push({
        entityId: piece.entity.id,
        from: step.forward ? piece.a : piece.b,
        to: step.forward ? piece.b : piece.a,
        label: `${token}${step.forward ? '+' : '-'}`,
        token: whole ? piece.entity.id : token,
        causes: [piece.startLabel, piece.endLabel],
      })
    }
    return { pieces: ringPieces, polygon, area }
  }

  const halfEdges: HalfEdge[] = []
  const outgoing = new Map<number, number[]>()
  pieces.forEach((piece, index) => {
    if (!alive[index] || piece.closedLoop) return
    const length = Math.max(
      v2.dist(sampled[index][0], sampled[index][sampled[index].length - 1]),
      weld * 100,
    )
    const probe = (forward: boolean) => {
      const origin = piece.curve.at(forward ? piece.a : piece.b)
      const span = piece.b - piece.a
      let delta = span * 1e-3
      for (let tries = 0; tries < 20; tries++) {
        const s = forward ? piece.a + delta : piece.b - delta
        const offset = v2.sub(piece.curve.at(s), origin)
        if (v2.len(offset) > length * 1e-6) return Math.atan2(offset[1], offset[0])
        delta *= 4
      }
      const d = piece.curve.d1(forward ? piece.a : piece.b)
      return forward ? Math.atan2(d[1], d[0]) : Math.atan2(-d[1], -d[0])
    }
    for (const forward of [true, false]) {
      const from = forward ? piece.start : piece.end
      const to = forward ? piece.end : piece.start
      halfEdges.push({ piece: index, forward, from, to, angle: probe(forward) })
      outgoing.set(from, [...(outgoing.get(from) ?? []), halfEdges.length - 1])
    }
  })
  for (const list of outgoing.values()) list.sort((p, q) => halfEdges[p].angle - halfEdges[q].angle)
  const twin = (h: number) => (halfEdges[h].forward ? h + 1 : h - 1)
  const next = (h: number): number => {
    const t = twin(h)
    const around = outgoing.get(halfEdges[h].to)!
    const k = around.indexOf(t)
    return around[(k - 1 + around.length) % around.length]
  }

  const faces: RegionRing[] = []
  const ownHoles: RegionRing[][] = []
  const boundaries: Array<{ ring: RegionRing; component: number }> = []
  const componentOf = new Map<number, number>()
  const parent = new Map<number, number>()
  const find = (n: number): number => {
    let root = n
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!
    return root
  }
  for (const h of halfEdges) {
    const a = find(h.from)
    const b = find(h.to)
    if (a !== b) parent.set(a, b)
  }
  for (const node of outgoing.keys()) componentOf.set(node, find(node))

  const visited = new Uint8Array(halfEdges.length)
  const faceComponents: number[] = []
  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue
    const cycle: number[] = []
    let h = start
    for (let guard = 0; guard <= halfEdges.length && !visited[h]; guard++) {
      visited[h] = 1
      cycle.push(h)
      h = next(h)
    }
    const counts = new Map<number, number>()
    for (const edge of cycle)
      counts.set(halfEdges[edge].piece, (counts.get(halfEdges[edge].piece) ?? 0) + 1)
    const rings: Array<Array<{ piece: number; forward: boolean }>> = [[]]
    for (const edge of cycle) {
      if ((counts.get(halfEdges[edge].piece) ?? 0) > 1) {
        if (rings[rings.length - 1].length) rings.push([])
        continue
      }
      rings[rings.length - 1].push({
        piece: halfEdges[edge].piece,
        forward: halfEdges[edge].forward,
      })
    }
    if (rings.length > 1 && rings[rings.length - 1].length && rings[0].length) {
      const last = rings.pop()!
      rings[0] = [...last, ...rings[0]]
    }
    const component = componentOf.get(halfEdges[start].from) ?? -1
    const kept = rings.filter((ring) => ring.length)
    const built = kept.map(ringOf).filter((ring) => Math.abs(ring.area) > weld * weld * 1e3)
    const positive = built.filter((ring) => ring.area > 0)
    const negative = built.filter((ring) => ring.area < 0)
    if (positive.length === 1) {
      faces.push(positive[0])
      ownHoles.push(negative)
      faceComponents.push(component)
      continue
    }
    for (const ring of positive) {
      faces.push(ring)
      ownHoles.push([])
      faceComponents.push(component)
    }
    for (const ring of negative) boundaries.push({ ring, component })
  }

  pieces.forEach((piece, index) => {
    if (!alive[index] || !piece.closedLoop) return
    const component = -1000 - index
    const forward = ringOf([{ piece: index, forward: true }])
    const backward = ringOf([{ piece: index, forward: false }])
    const [inner, outer] = forward.area > 0 ? [forward, backward] : [backward, forward]
    faces.push(inner)
    ownHoles.push([])
    faceComponents.push(component)
    boundaries.push({ ring: outer, component })
  })

  const holes: RegionRing[][] = faces.map((_, index) => [...ownHoles[index]])
  for (const boundary of boundaries) {
    const probe = boundary.ring.polygon[0]
    let best = -1
    faces.forEach((face, index) => {
      if (faceComponents[index] === boundary.component) return
      if (!contains(face.polygon, probe)) return
      if (best < 0 || face.area < faces[best].area) best = index
    })
    if (best >= 0) holes[best].push(boundary.ring)
  }

  const regions = faces.map((outer, index): Region => {
    const inner = holes[index]
    const inside = interiorPoint(
      outer.polygon,
      inner.map((ring) => ring.polygon),
    )
    const labels = [outer, ...inner].flatMap((ring) => ring.pieces.map((piece) => piece.label))
    return {
      key: [...labels].sort().join(','),
      outer,
      holes: inner,
      area: outer.area - inner.reduce((sum, ring) => sum + Math.abs(ring.area), 0),
      inside,
      solid: true,
    }
  })
  for (const region of regions) {
    let depth = 0
    for (const other of regions) {
      if (other === region) continue
      if (other.holes.some((hole) => contains(hole.polygon, region.inside))) depth++
    }
    region.solid = depth % 2 === 0
  }
  return { regions: regions.sort((p, q) => q.area - p.area), dangling }
}

function angleOf(curve: Curve, from: number, to: number): number {
  const origin = curve.at(from)
  const span = to - from
  const reach = Math.max(v2.dist(origin, curve.at(to)), 1e-9)
  let delta = 1e-3
  for (let tries = 0; tries < 8; tries++) {
    const offset = v2.sub(curve.at(from + span * delta), origin)
    if (v2.len(offset) > reach * 1e-7) return Math.atan2(offset[1], offset[0])
    delta *= 4
  }
  const d = v2.scale(curve.d1(from), Math.sign(span) || 1)
  return Math.atan2(d[1], d[0])
}

function normalizeTurn(angle: number): number {
  const tau = Math.PI * 2
  return ((angle % tau) + tau) % tau
}

export function mergeRegions(sketch: Sketch2D, chosen: readonly Region[]): ProfileLoop[] {
  if (chosen.length === 1) return [{ outer: chosen[0].outer, holes: chosen[0].holes }]
  const pts = pointLookup(sketch)
  const byId = new Map(sketch.entities.map((e) => [e.id, e]))
  const curves = new Map<string, Curve>()
  const curveFor = (id: string): Curve => {
    let curve = curves.get(id)
    if (!curve) {
      curve = curveOf(byId.get(id)!, pts)!
      curves.set(id, curve)
    }
    return curve
  }
  const all = chosen.flatMap((region) => [region.outer, ...region.holes]).flatMap((r) => r.pieces)
  const labels = new Set(all.map((piece) => piece.label))
  const flip = (label: string) => label.slice(0, -1) + (label.endsWith('+') ? '-' : '+')
  const kept = [...new Map(all.map((piece) => [piece.label, piece])).values()].filter(
    (piece) => !labels.has(flip(piece.label)),
  )
  if (!kept.length) return []
  const bounds = sketchBounds(sketch, [...new Set(kept.map((piece) => piece.entityId))])
  const scale = bounds
    ? Math.max(Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]), 1e-6)
    : 1
  const weld = Math.max(scale * 1e-6, 1e-9)
  const nodes: Vec2[] = []
  const nodeAt = (p: Vec2) => {
    const found = nodes.findIndex((node) => v2.dist(node, p) <= weld)
    if (found >= 0) return found
    nodes.push(p)
    return nodes.length - 1
  }
  const edges = kept.map((piece) => {
    const curve = curveFor(piece.entityId)
    return {
      piece,
      curve,
      start: nodeAt(curve.at(piece.from)),
      end: nodeAt(curve.at(piece.to)),
      leave: angleOf(curve, piece.from, piece.to),
      arrive: angleOf(curve, piece.to, piece.from),
    }
  })
  const leaving = new Map<number, number[]>()
  edges.forEach((edge, index) =>
    leaving.set(edge.start, [...(leaving.get(edge.start) ?? []), index]),
  )
  const used = new Uint8Array(edges.length)
  const sampleTolerance = Math.max(scale * 2e-4, 1e-6)
  const rings: RegionRing[] = []
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue
    const steps: number[] = []
    let at = seed
    for (let guard = 0; guard <= edges.length && !used[at]; guard++) {
      used[at] = 1
      steps.push(at)
      const edge = edges[at]
      const options = (leaving.get(edge.end) ?? []).filter(
        (index) => !used[index] || index === seed,
      )
      if (!options.length) break
      const turn = (index: number) => {
        const offset = normalizeTurn(edge.arrive - edges[index].leave)
        return offset <= 1e-12 ? Math.PI * 2 : offset
      }
      at = options.reduce((best, index) => (turn(index) < turn(best) ? index : best))
      if (at === seed) break
    }
    const polygon: Vec2[] = []
    let area = 0
    for (const index of steps) {
      const { piece, curve } = edges[index]
      area += pieceArea(curve, piece.from, piece.to)
      polygon.push(...sampleCurve(curve, sampleTolerance, piece.from, piece.to).p.slice(0, -1))
    }
    rings.push({ pieces: steps.map((index) => edges[index].piece), polygon, area })
  }
  const outers = rings.filter((ring) => ring.area > 0).sort((p, q) => p.area - q.area)
  const loops: ProfileLoop[] = outers.map((outer) => ({ outer, holes: [] }))
  for (const hole of rings.filter((ring) => ring.area < 0)) {
    const first = hole.pieces[0]
    const probe = curveFor(first.entityId).at((first.from + first.to) / 2)
    const owner = loops.find((loop) => contains(loop.outer.polygon, probe))
    owner?.holes.push(hole)
  }
  return loops
}

function joinPieces(sketch: Sketch2D, ring: RegionRing): RegionRing {
  const closed = new Set(
    sketch.entities.filter((e) => e.kind === 'circle' || e.kind === 'ellipse').map((e) => e.id),
  )
  const pieces = [...ring.pieces]
  const touching = (a: RegionPiece, b: RegionPiece) => {
    if (a.entityId !== b.entityId) return false
    if (Math.sign(a.to - a.from) !== Math.sign(b.to - b.from)) return false
    const gap = a.to - b.from
    return closed.has(a.entityId)
      ? Math.abs((((gap % 1) + 1.5) % 1) - 0.5) < 1e-9
      : Math.abs(gap) < 1e-12
  }
  let joined = true
  while (joined && pieces.length > 1) {
    joined = false
    for (let i = 0; i < pieces.length; i++) {
      const j = (i + 1) % pieces.length
      const a = pieces[i]
      const b = pieces[j]
      if (!touching(a, b)) continue
      const from = a.from
      const to = a.to + (b.to - b.from)
      const forward = to > from
      const causes: [string, string] = forward
        ? [a.causes[0], b.causes[1]]
        : [b.causes[0], a.causes[1]]
      const low = Math.min(from, to)
      const high = Math.max(from, to)
      const whole = closed.has(a.entityId) ? high - low >= 1 - 1e-9 : low === 0 && high === 1
      const token = `${a.entityId}[${causes[0]}|${causes[1]}]`
      const merged: RegionPiece = {
        entityId: a.entityId,
        from,
        to,
        label: `${token}${forward ? '+' : '-'}`,
        token: whole ? a.entityId : token,
        causes,
      }
      if (j === 0) {
        pieces.splice(i, 1)
        pieces[0] = merged
      } else {
        pieces.splice(i, 2, merged)
      }
      joined = true
      break
    }
  }
  return pieces.length === ring.pieces.length ? ring : { ...ring, pieces }
}

function joinLoops(sketch: Sketch2D, loops: ProfileLoop[]): ProfileLoop[] {
  return loops.map((loop) => ({
    outer: joinPieces(sketch, loop.outer),
    holes: loop.holes.map((hole) => joinPieces(sketch, hole)),
  }))
}

export function selectProfiles(sketch: Sketch2D, keys?: readonly string[]): ProfileSelection {
  const result = sketchRegions(sketch)
  if (!keys) {
    const solid = result.regions.filter((region) => region.solid)
    if (!solid.length) return { ok: false, missing: [], empty: true, dangling: result.dangling }
    return { ok: true, loops: joinLoops(sketch, mergeRegions(sketch, solid)), regions: solid }
  }
  const byKey = new Map(result.regions.map((region) => [region.key, region]))
  const missing = keys.filter((key) => !byKey.has(key))
  if (missing.length || !keys.length) {
    return { ok: false, missing, empty: !keys.length, dangling: result.dangling }
  }
  const chosen = [...new Set(keys)].map((key) => byKey.get(key)!)
  return { ok: true, loops: joinLoops(sketch, mergeRegions(sketch, chosen)), regions: chosen }
}

const regionCache = new WeakMap<Sketch2D, RegionResult>()

export function cachedRegions(sketch: Sketch2D): RegionResult {
  let result = regionCache.get(sketch)
  if (!result) {
    result = sketchRegions(sketch)
    regionCache.set(sketch, result)
  }
  return result
}

export function regionAt(result: RegionResult, point: Vec2): Region | null {
  let best: Region | null = null
  for (const region of result.regions) {
    if (!contains(region.outer.polygon, point)) continue
    if (region.holes.some((hole) => contains(hole.polygon, point))) continue
    if (!best || region.area < best.area) best = region
  }
  return best
}
