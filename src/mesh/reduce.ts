import { EditMesh, crossOf } from './edit'
import { MinHeap } from './heap'
import { cloneMesh, triangleCount, type TriMesh, type Vec3 } from './types'

export interface ReduceOptions {
  targetTriangles?: number
  proportion?: number
  maxError?: number
}

export interface ReduceResult {
  mesh: TriMesh
  removedTriangles: number
  maxError: number
}

const BOUNDARY_WEIGHT = 1000

function addPlane(q: Float64Array, v: number, n: Vec3, d: number, weight: number) {
  const [a, b, c] = n
  const o = v * 10
  q[o] += weight * a * a
  q[o + 1] += weight * a * b
  q[o + 2] += weight * a * c
  q[o + 3] += weight * a * d
  q[o + 4] += weight * b * b
  q[o + 5] += weight * b * c
  q[o + 6] += weight * b * d
  q[o + 7] += weight * c * c
  q[o + 8] += weight * c * d
  q[o + 9] += weight * d * d
}

function errorAt(q: ArrayLike<number>, [x, y, z]: Vec3): number {
  return (
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9]
  )
}

function solve(q: ArrayLike<number>): Vec3 | null {
  const [a, b, c, , e, f, , h] = [q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]]
  const det = a * (e * h - f * f) - b * (b * h - f * c) + c * (b * f - e * c)
  if (!(Math.abs(det) > 1e-8 * Math.abs(a * e * h))) return null
  const r0 = -q[3]
  const r1 = -q[6]
  const r2 = -q[8]
  return [
    (r0 * (e * h - f * f) - b * (r1 * h - f * r2) + c * (r1 * f - e * r2)) / det,
    (a * (r1 * h - f * r2) - r0 * (b * h - f * c) + c * (b * r2 - r1 * c)) / det,
    (a * (e * r2 - r1 * f) - b * (b * r2 - r1 * c) + r0 * (b * f - e * c)) / det,
  ]
}

export function reduceMesh(mesh: TriMesh, options: ReduceOptions = {}): ReduceResult {
  const start = triangleCount(mesh)
  const target = Math.max(
    4,
    Math.floor(
      options.targetTriangles ?? start * Math.min(1, Math.max(0, options.proportion ?? 0.5)),
    ),
  )
  if (target >= start) return { mesh: cloneMesh(mesh), removedTriangles: 0, maxError: 0 }
  const em = EditMesh.from(mesh)
  const n = em.vertexCount
  const quadrics = new Float64Array(n * 10)
  const areas = new Float64Array(n)
  for (const t of em.liveTriangleIds()) {
    const [a, b, c] = em.triangle(t)
    const pa = em.point(a)
    const normal = crossOf(pa, em.point(b), em.point(c))
    const doubled = Math.hypot(normal[0], normal[1], normal[2])
    if (doubled < 1e-15) continue
    const unit: Vec3 = [normal[0] / doubled, normal[1] / doubled, normal[2] / doubled]
    const d = -(unit[0] * pa[0] + unit[1] * pa[1] + unit[2] * pa[2])
    for (const v of [a, b, c]) {
      addPlane(quadrics, v, unit, d, doubled / 2)
      areas[v] += doubled / 2
    }
  }
  for (const t of em.liveTriangleIds()) {
    const corners = em.triangle(t)
    const [pa, pb, pc] = corners.map((v) => em.point(v))
    const normal = crossOf(pa, pb, pc)
    for (let k = 0; k < 3; k++) {
      const u = corners[k]
      const v = corners[(k + 1) % 3]
      if (em.edgeTriangles(u, v).length !== 1) continue
      const pu = em.point(u)
      const pv = em.point(v)
      const edge: Vec3 = [pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]]
      const side: Vec3 = [
        edge[1] * normal[2] - edge[2] * normal[1],
        edge[2] * normal[0] - edge[0] * normal[2],
        edge[0] * normal[1] - edge[1] * normal[0],
      ]
      const size = Math.hypot(side[0], side[1], side[2])
      if (size < 1e-15) continue
      const unit: Vec3 = [side[0] / size, side[1] / size, side[2] / size]
      const d = -(unit[0] * pu[0] + unit[1] * pu[1] + unit[2] * pu[2])
      const weight = BOUNDARY_WEIGHT * (edge[0] ** 2 + edge[1] ** 2 + edge[2] ** 2)
      addPlane(quadrics, u, unit, d, weight)
      addPlane(quadrics, v, unit, d, weight)
    }
  }
  const version = new Uint32Array(n)
  const heap = new MinHeap<[number, number, number, number, Vec3, number]>()
  const combined = new Float64Array(10)
  const consider = (u: number, v: number) => {
    for (let i = 0; i < 10; i++) combined[i] = quadrics[u * 10 + i] + quadrics[v * 10 + i]
    const pu = em.point(u)
    const pv = em.point(v)
    const middle: Vec3 = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2]
    let best: Vec3 = middle
    let cost = errorAt(combined, middle)
    const reach = 2 * Math.hypot(pu[0] - pv[0], pu[1] - pv[1], pu[2] - pv[2])
    const candidates = [pu, pv, solve(combined)]
    for (const candidate of candidates) {
      if (!candidate) continue
      const away = Math.hypot(
        candidate[0] - middle[0],
        candidate[1] - middle[1],
        candidate[2] - middle[2],
      )
      if (away > reach) continue
      const error = errorAt(combined, candidate)
      if (error < cost) {
        cost = error
        best = candidate
      }
    }
    const deviation = Math.sqrt(Math.max(0, cost) / Math.max(areas[u] + areas[v], 1e-12))
    heap.push(Math.max(0, cost), [u, v, version[u], version[v], best, deviation])
  }
  for (let u = 0; u < n; u++) for (const w of em.ring(u)) if (u < w) consider(u, w)
  let maxError = 0
  while (em.liveTriangles > target && heap.size) {
    const [u, v, vu, vv, position, deviation] = heap.pop()!
    if (version[u] !== vu || version[v] !== vv) continue
    if (options.maxError !== undefined && deviation > options.maxError) continue
    if (!em.incident[u].length || !em.incident[v].length) continue
    if (!em.canCollapse(u, v) || em.collapseFoldsOver(u, v, position)) continue
    em.collapse(u, v, position)
    for (let i = 0; i < 10; i++) quadrics[u * 10 + i] += quadrics[v * 10 + i]
    areas[u] += areas[v]
    version[u]++
    version[v]++
    maxError = Math.max(maxError, deviation)
    for (const w of em.ring(u)) consider(u, w)
  }
  return { mesh: em.toMesh(), removedTriangles: start - em.liveTriangles, maxError }
}
