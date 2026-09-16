import { pointInPolygon2D, projectLoops, signedArea2D, triangulateLoops } from './polygon'
import { buildEdgeTable, chainLoops, triangleTraverses } from './topology'
import {
  boundsDiagonal,
  compactMesh,
  createMesh,
  meshBounds,
  MeshError,
  type MeshPlane,
  type TriMesh,
  type Vec3,
} from './types'
import { dot, length, normalize, triangleCross } from './vec'

export interface PlaneCutOptions {
  cap?: boolean
  tolerance?: number
}

export interface PlaneCutResult {
  above: TriMesh
  below: TriMesh
  capLoops: number
  unmatchedLoops: number
}

interface Cap {
  triangles: number[]
  loops: number
  unmatched: number
}

function capTriangles(
  positions: number[],
  triangles: number[],
  onPlane: number[],
  capNormal: Vec3,
): Cap {
  const temp: TriMesh = {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  }
  const table = buildEdgeTable(temp)
  const edges: number[] = []
  for (let e = 0; e < table.a.length; e++) {
    if (table.triangles[e].length !== 1) continue
    const a = table.a[e]
    const b = table.b[e]
    if (!onPlane[a] || !onPlane[b]) continue
    if (triangleTraverses(temp.triangles, table.triangles[e][0], a, b)) edges.push(b, a)
    else edges.push(a, b)
  }
  const loops = chainLoops(edges, positions, capNormal)
  if (!loops.length) return { triangles: [], loops: 0, unmatched: 0 }
  const projected = projectLoops(positions, loops, capNormal)
  const spans = loops.map((_, k): [number, number] => [
    k === 0 ? 0 : projected.holeStarts[k - 1],
    k < loops.length - 1 ? projected.holeStarts[k] : projected.ids.length,
  ])
  const areas = spans.map(([start, end]) => signedArea2D(projected.coords, start, end))
  const outers = loops.map((_, k) => k).filter((k) => areas[k] > 0)
  const holes = loops.map((_, k) => k).filter((k) => areas[k] < 0)
  const assigned = new Map<number, number[]>(outers.map((k) => [k, []]))
  let unmatched = 0
  for (const hole of holes) {
    const [start] = spans[hole]
    const x = projected.coords[start * 2]
    const y = projected.coords[start * 2 + 1]
    let best = -1
    for (const outer of outers) {
      if (!pointInPolygon2D(projected.coords, x, y, spans[outer][0], spans[outer][1])) continue
      if (best < 0 || areas[outer] < areas[best]) best = outer
    }
    if (best < 0) unmatched++
    else assigned.get(best)!.push(hole)
  }
  const out: number[] = []
  for (const outer of outers) {
    const rings = [loops[outer], ...assigned.get(outer)!.map((hole) => loops[hole])]
    for (const id of triangulateLoops(positions, rings, capNormal)) out.push(id)
  }
  return { triangles: out, loops: outers.length, unmatched }
}

export function planeCut(
  mesh: TriMesh,
  plane: MeshPlane,
  options: PlaneCutOptions = {},
): PlaneCutResult {
  const normal = normalize(plane.normal)
  if (length(normal) === 0) throw new MeshError('A plane cut needs a plane with a direction.')
  const source = mesh.positions
  const vertexTotal = source.length / 3
  const tolerance = options.tolerance ?? Math.max(boundsDiagonal(meshBounds(mesh)) * 1e-9, 1e-12)
  const positions: number[] = Array.from(source)
  const onPlane: number[] = new Array(vertexTotal).fill(0)
  const sides = new Int8Array(vertexTotal)
  const distances = new Float64Array(vertexTotal)
  for (let v = 0; v < vertexTotal; v++) {
    const d =
      (source[v * 3] - plane.origin[0]) * normal[0] +
      (source[v * 3 + 1] - plane.origin[1]) * normal[1] +
      (source[v * 3 + 2] - plane.origin[2]) * normal[2]
    distances[v] = d
    sides[v] = Math.abs(d) <= tolerance ? 0 : d > 0 ? 1 : -1
    onPlane[v] = sides[v] === 0 ? 1 : 0
  }
  const cache = new Map<number, number>()
  const cut = (a: number, b: number) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = lo * vertexTotal + hi
    const found = cache.get(key)
    if (found !== undefined) return found
    const t = distances[lo] / (distances[lo] - distances[hi])
    const id = positions.length / 3
    positions.push(
      source[lo * 3] + (source[hi * 3] - source[lo * 3]) * t,
      source[lo * 3 + 1] + (source[hi * 3 + 1] - source[lo * 3 + 1]) * t,
      source[lo * 3 + 2] + (source[hi * 3 + 2] - source[lo * 3 + 2]) * t,
    )
    onPlane[id] = 1
    cache.set(key, id)
    return id
  }
  const above: number[] = []
  const below: number[] = []
  const emit = (side: number, a: number, b: number, c: number) =>
    (side > 0 ? above : below).push(a, b, c)
  const t = mesh.triangles
  for (let i = 0; i < t.length; i += 3) {
    const v = [t[i], t[i + 1], t[i + 2]]
    const s = [sides[v[0]], sides[v[1]], sides[v[2]]]
    if (s[0] >= 0 && s[1] >= 0 && s[2] >= 0) {
      if (s[0] === 0 && s[1] === 0 && s[2] === 0) {
        const n = triangleCross(source, v[0], v[1], v[2])
        emit(dot(n, normal) > 0 ? -1 : 1, v[0], v[1], v[2])
      } else {
        emit(1, v[0], v[1], v[2])
      }
      continue
    }
    if (s[0] <= 0 && s[1] <= 0 && s[2] <= 0) {
      emit(-1, v[0], v[1], v[2])
      continue
    }
    const zero = s.indexOf(0)
    if (zero >= 0) {
      const v0 = v[zero]
      const v1 = v[(zero + 1) % 3]
      const v2 = v[(zero + 2) % 3]
      const m = cut(v1, v2)
      emit(sides[v1], v0, v1, m)
      emit(sides[v2], v0, m, v2)
    } else {
      const lone = s[0] === s[1] ? 2 : s[0] === s[2] ? 1 : 0
      const v0 = v[lone]
      const v1 = v[(lone + 1) % 3]
      const v2 = v[(lone + 2) % 3]
      const m01 = cut(v0, v1)
      const m20 = cut(v2, v0)
      emit(sides[v0], v0, m01, m20)
      emit(sides[v1], m01, v1, v2)
      emit(sides[v1], m01, v2, m20)
    }
  }
  let capLoops = 0
  let unmatchedLoops = 0
  if (options.cap) {
    const capAbove = capTriangles(positions, above, onPlane, [-normal[0], -normal[1], -normal[2]])
    const capBelow = capTriangles(positions, below, onPlane, normal)
    for (const id of capAbove.triangles) above.push(id)
    for (const id of capBelow.triangles) below.push(id)
    capLoops = capAbove.loops + capBelow.loops
    unmatchedLoops = capAbove.unmatched + capBelow.unmatched
  }
  return {
    above: compactMesh(createMesh(positions, above)),
    below: compactMesh(createMesh(positions, below)),
    capLoops,
    unmatchedLoops,
  }
}
