import { dot, normalize, planeBasis } from './vec'
import type { TriMesh, Vec3 } from './types'

export interface EdgeTable {
  vertexCount: number
  a: number[]
  b: number[]
  triangles: number[][]
  forward: number[]
  triangleEdges: Int32Array
  index: Map<number, number>
}

export function edgeKey(u: number, v: number, vertexCount: number): number {
  return u < v ? u * vertexCount + v : v * vertexCount + u
}

export function buildEdgeTable(mesh: TriMesh): EdgeTable {
  const vertexCount = mesh.positions.length / 3
  const t = mesh.triangles
  const index = new Map<number, number>()
  const a: number[] = []
  const b: number[] = []
  const triangles: number[][] = []
  const forward: number[] = []
  const triangleEdges = new Int32Array(t.length).fill(-1)
  const count = t.length / 3
  for (let tri = 0; tri < count; tri++) {
    for (let k = 0; k < 3; k++) {
      const u = t[tri * 3 + k]
      const v = t[tri * 3 + ((k + 1) % 3)]
      if (u === v) continue
      const key = edgeKey(u, v, vertexCount)
      let edge = index.get(key)
      if (edge === undefined) {
        edge = a.length
        index.set(key, edge)
        a.push(Math.min(u, v))
        b.push(Math.max(u, v))
        triangles.push([])
        forward.push(0)
      }
      triangles[edge].push(tri)
      if (u < v) forward[edge]++
      triangleEdges[tri * 3 + k] = edge
    }
  }
  return { vertexCount, a, b, triangles, forward, triangleEdges, index }
}

export function findEdge(table: EdgeTable, u: number, v: number): number {
  return table.index.get(edgeKey(u, v, table.vertexCount)) ?? -1
}

export function triangleTraverses(
  triangles: ArrayLike<number>,
  t: number,
  from: number,
  to: number,
): boolean {
  const a = triangles[t * 3]
  const b = triangles[t * 3 + 1]
  const c = triangles[t * 3 + 2]
  return (a === from && b === to) || (b === from && c === to) || (c === from && a === to)
}

export function chainLoops(
  edges: ArrayLike<number>,
  positions?: ArrayLike<number>,
  normal?: Vec3,
): number[][] {
  const count = edges.length / 2
  const outgoing = new Map<number, number[]>()
  for (let e = 0; e < count; e++) {
    const from = edges[e * 2]
    const list = outgoing.get(from)
    if (list) list.push(e)
    else outgoing.set(from, [e])
  }
  const used = new Uint8Array(count)
  const basis = positions && normal ? planeBasis(normalize(normal)) : null
  const project = (id: number): [number, number] => {
    const p: Vec3 = [positions![id * 3], positions![id * 3 + 1], positions![id * 3 + 2]]
    return [dot(basis![0], p), dot(basis![1], p)]
  }
  const loops: number[][] = []
  for (let first = 0; first < count; first++) {
    if (used[first]) continue
    used[first] = 1
    const start = edges[first * 2]
    const loop = [start]
    let previous = start
    let current = edges[first * 2 + 1]
    while (current !== start) {
      loop.push(current)
      const candidates = (outgoing.get(current) ?? []).filter((e) => !used[e])
      if (!candidates.length) break
      let pick = candidates[0]
      if (candidates.length > 1 && basis) {
        const here = project(current)
        const back = project(previous)
        const bx = back[0] - here[0]
        const by = back[1] - here[1]
        let best = Infinity
        for (const e of candidates) {
          const to = project(edges[e * 2 + 1])
          const dx = to[0] - here[0]
          const dy = to[1] - here[1]
          let clockwise = -Math.atan2(bx * dy - by * dx, bx * dx + by * dy)
          if (clockwise <= 0) clockwise += Math.PI * 2
          if (clockwise < best) {
            best = clockwise
            pick = e
          }
        }
      }
      used[pick] = 1
      previous = current
      current = edges[pick * 2 + 1]
    }
    if (current === start && loop.length >= 3) loops.push(loop)
  }
  return loops
}

export function boundaryEdges(mesh: TriMesh, table: EdgeTable = buildEdgeTable(mesh)): number[] {
  const out: number[] = []
  for (let e = 0; e < table.a.length; e++) {
    if (table.triangles[e].length !== 1) continue
    const t = table.triangles[e][0]
    if (triangleTraverses(mesh.triangles, t, table.a[e], table.b[e]))
      out.push(table.a[e], table.b[e])
    else out.push(table.b[e], table.a[e])
  }
  return out
}

export function boundaryLoops(mesh: TriMesh, table: EdgeTable = buildEdgeTable(mesh)): number[][] {
  return chainLoops(boundaryEdges(mesh, table))
}

export function triangleComponents(mesh: TriMesh): { count: number; ids: Int32Array } {
  const vertexCount = mesh.positions.length / 3
  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (x: number, y: number) => {
    const rx = find(x)
    const ry = find(y)
    if (rx === ry) return
    if (rx < ry) parent[ry] = rx
    else parent[rx] = ry
  }
  const t = mesh.triangles
  const count = t.length / 3
  for (let tri = 0; tri < count; tri++) {
    union(t[tri * 3], t[tri * 3 + 1])
    union(t[tri * 3], t[tri * 3 + 2])
  }
  const labels = new Map<number, number>()
  const ids = new Int32Array(count)
  for (let tri = 0; tri < count; tri++) {
    const root = find(t[tri * 3])
    let label = labels.get(root)
    if (label === undefined) {
      label = labels.size
      labels.set(root, label)
    }
    ids[tri] = label
  }
  return { count: labels.size, ids }
}

export function vertexNeighbours(mesh: TriMesh): number[][] {
  const vertexCount = mesh.positions.length / 3
  const result: number[][] = Array.from({ length: vertexCount }, () => [])
  const add = (u: number, v: number) => {
    if (u === v) return
    const list = result[u]
    if (!list.includes(v)) list.push(v)
  }
  const t = mesh.triangles
  for (let i = 0; i < t.length; i += 3) {
    add(t[i], t[i + 1])
    add(t[i + 1], t[i])
    add(t[i + 1], t[i + 2])
    add(t[i + 2], t[i + 1])
    add(t[i + 2], t[i])
    add(t[i], t[i + 2])
  }
  return result
}

export function boundaryVertices(
  mesh: TriMesh,
  table: EdgeTable = buildEdgeTable(mesh),
): Uint8Array {
  const flags = new Uint8Array(mesh.positions.length / 3)
  for (let e = 0; e < table.a.length; e++) {
    if (table.triangles[e].length === 2) continue
    flags[table.a[e]] = 1
    flags[table.b[e]] = 1
  }
  return flags
}

const RAY = normalize([0.3141592653589793, 0.2718281828459045, 0.9108940231234567])

export function pointInsideTriangles(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  point: Vec3,
  triangleIds?: ArrayLike<number>,
): boolean {
  const [dx, dy, dz] = RAY
  const [ox, oy, oz] = point
  let hits = 0
  const total = triangleIds ? triangleIds.length : triangles.length / 3
  for (let k = 0; k < total; k++) {
    const t = triangleIds ? triangleIds[k] : k
    const a = triangles[t * 3] * 3
    const b = triangles[t * 3 + 1] * 3
    const c = triangles[t * 3 + 2] * 3
    const ax = positions[a]
    const ay = positions[a + 1]
    const az = positions[a + 2]
    const e1x = positions[b] - ax
    const e1y = positions[b + 1] - ay
    const e1z = positions[b + 2] - az
    const e2x = positions[c] - ax
    const e2y = positions[c + 1] - ay
    const e2z = positions[c + 2] - az
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-300) continue
    const inv = 1 / det
    const tx = ox - ax
    const ty = oy - ay
    const tz = oz - az
    const u = (tx * px + ty * py + tz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = ty * e1z - tz * e1y
    const qy = tz * e1x - tx * e1z
    const qz = tx * e1y - ty * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < 0 || u + v > 1) continue
    const distance = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (distance > 0) hits++
  }
  return hits % 2 === 1
}
