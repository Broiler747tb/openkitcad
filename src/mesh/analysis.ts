import { boundaryLoops, buildEdgeTable, triangleComponents } from './topology'
import { boundsDiagonal, meshBounds, type Bounds, type TriMesh, type Vec3 } from './types'

export interface MeshAnalysis {
  vertexCount: number
  triangleCount: number
  bounds: Bounds
  area: number
  volume: number
  closed: boolean
  manifold: boolean
  consistentlyOriented: boolean
  watertight: boolean
  outward: boolean
  boundaryEdgeCount: number
  boundaryLoops: number[][]
  nonManifoldEdges: Array<[number, number]>
  nonManifoldVertices: number[]
  inconsistentEdges: Array<[number, number]>
  componentCount: number
  degenerateTriangles: number[]
  duplicateTriangles: number[]
  unusedVertexCount: number
}

export interface AnalysisOptions {
  degenerateTolerance?: number
}

export function defaultLengthTolerance(mesh: TriMesh): number {
  return Math.max(boundsDiagonal(meshBounds(mesh)) * 1e-9, 1e-12)
}

export function isDegenerateTriangle(
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  tolerance: number,
): boolean {
  if (a === b || b === c || a === c) return true
  const ax = positions[a * 3]
  const ay = positions[a * 3 + 1]
  const az = positions[a * 3 + 2]
  const bx = positions[b * 3]
  const by = positions[b * 3 + 1]
  const bz = positions[b * 3 + 2]
  const cx = positions[c * 3]
  const cy = positions[c * 3 + 1]
  const cz = positions[c * 3 + 2]
  const ab = Math.hypot(bx - ax, by - ay, bz - az)
  const bc = Math.hypot(cx - bx, cy - by, cz - bz)
  const ca = Math.hypot(ax - cx, ay - cy, az - cz)
  const longest = Math.max(ab, bc, ca)
  if (longest <= tolerance) return true
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  return area2 / longest <= tolerance
}

export function signedVolume(
  mesh: TriMesh,
  triangleIds?: ArrayLike<number>,
  origin?: Vec3,
): number {
  const p = mesh.positions
  const t = mesh.triangles
  const bounds = origin ? null : meshBounds(mesh)
  const ox = origin ? origin[0] : (bounds!.min[0] + bounds!.max[0]) / 2
  const oy = origin ? origin[1] : (bounds!.min[1] + bounds!.max[1]) / 2
  const oz = origin ? origin[2] : (bounds!.min[2] + bounds!.max[2]) / 2
  let sum = 0
  const total = triangleIds ? triangleIds.length : t.length / 3
  for (let k = 0; k < total; k++) {
    const tri = triangleIds ? triangleIds[k] : k
    const a = t[tri * 3] * 3
    const b = t[tri * 3 + 1] * 3
    const c = t[tri * 3 + 2] * 3
    const ax = p[a] - ox
    const ay = p[a + 1] - oy
    const az = p[a + 2] - oz
    const bx = p[b] - ox
    const by = p[b + 1] - oy
    const bz = p[b + 2] - oz
    const cx = p[c] - ox
    const cy = p[c + 1] - oy
    const cz = p[c + 2] - oz
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return sum / 6
}

export function surfaceArea(mesh: TriMesh): number {
  const p = mesh.positions
  const t = mesh.triangles
  let sum = 0
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3
    const b = t[i + 1] * 3
    const c = t[i + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  }
  return sum / 2
}

function nonManifoldVertexList(mesh: TriMesh): number[] {
  const vertexCount = mesh.positions.length / 3
  const t = mesh.triangles
  const count = t.length / 3
  const offsets = new Uint32Array(vertexCount + 1)
  const valid = (tri: number) =>
    t[tri * 3] !== t[tri * 3 + 1] &&
    t[tri * 3 + 1] !== t[tri * 3 + 2] &&
    t[tri * 3] !== t[tri * 3 + 2]
  for (let tri = 0; tri < count; tri++) {
    if (!valid(tri)) continue
    for (let k = 0; k < 3; k++) offsets[t[tri * 3 + k] + 1]++
  }
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] += offsets[v]
  const fill = offsets.slice(0, vertexCount)
  const incident = new Uint32Array(offsets[vertexCount])
  for (let tri = 0; tri < count; tri++) {
    if (!valid(tri)) continue
    for (let k = 0; k < 3; k++) incident[fill[t[tri * 3 + k]]++] = tri
  }
  const result: number[] = []
  const parent: number[] = []
  const seen = new Map<number, number>()
  for (let v = 0; v < vertexCount; v++) {
    const start = offsets[v]
    const end = offsets[v + 1]
    if (end - start < 2) continue
    parent.length = 0
    seen.clear()
    const find = (x: number) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]]
      return x
    }
    for (let i = start; i < end; i++) {
      const local = i - start
      parent.push(local)
      const tri = incident[i]
      for (let k = 0; k < 3; k++) {
        const w = t[tri * 3 + k]
        if (w === v) continue
        const other = seen.get(w)
        if (other === undefined) seen.set(w, local)
        else {
          const ra = find(local)
          const rb = find(other)
          if (ra !== rb) parent[ra] = rb
        }
      }
    }
    let roots = 0
    for (let local = 0; local < end - start; local++) if (find(local) === local) roots++
    if (roots > 1) result.push(v)
  }
  return result
}

export function analyzeMesh(mesh: TriMesh, options: AnalysisOptions = {}): MeshAnalysis {
  const p = mesh.positions
  const t = mesh.triangles
  const vertexCount = p.length / 3
  const triangleCount = t.length / 3
  const bounds = meshBounds(mesh)
  const tolerance = options.degenerateTolerance ?? defaultLengthTolerance(mesh)
  const table = buildEdgeTable(mesh)
  let boundaryEdgeCount = 0
  const nonManifoldEdges: Array<[number, number]> = []
  const inconsistentEdges: Array<[number, number]> = []
  for (let e = 0; e < table.a.length; e++) {
    const users = table.triangles[e].length
    if (users === 1) boundaryEdgeCount++
    else if (users > 2) nonManifoldEdges.push([table.a[e], table.b[e]])
    else if (table.forward[e] !== 1) inconsistentEdges.push([table.a[e], table.b[e]])
  }
  const degenerateTriangles: number[] = []
  const duplicateTriangles: number[] = []
  const keys = new Set<string>()
  const used = new Uint8Array(vertexCount)
  for (let tri = 0; tri < triangleCount; tri++) {
    const a = t[tri * 3]
    const b = t[tri * 3 + 1]
    const c = t[tri * 3 + 2]
    used[a] = used[b] = used[c] = 1
    if (isDegenerateTriangle(p, a, b, c, tolerance)) degenerateTriangles.push(tri)
    const sorted = [a, b, c].sort((x, y) => x - y)
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`
    if (keys.has(key)) duplicateTriangles.push(tri)
    else keys.add(key)
  }
  let unusedVertexCount = 0
  for (let v = 0; v < vertexCount; v++) if (!used[v]) unusedVertexCount++
  const nonManifoldVertices = nonManifoldVertexList(mesh)
  const volume = signedVolume(mesh)
  const closed = boundaryEdgeCount === 0 && triangleCount > 0
  const consistentlyOriented = inconsistentEdges.length === 0
  return {
    vertexCount,
    triangleCount,
    bounds,
    area: surfaceArea(mesh),
    volume,
    closed,
    manifold: nonManifoldEdges.length === 0 && nonManifoldVertices.length === 0,
    consistentlyOriented,
    watertight: closed && nonManifoldEdges.length === 0 && consistentlyOriented,
    outward: volume > 0,
    boundaryEdgeCount,
    boundaryLoops: boundaryLoops(mesh, table),
    nonManifoldEdges,
    nonManifoldVertices,
    inconsistentEdges,
    componentCount: triangleComponents(mesh).count,
    degenerateTriangles,
    duplicateTriangles,
    unusedVertexCount,
  }
}
