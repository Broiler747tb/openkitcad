import { buildEdgeTable } from './topology'
import type { TriMesh } from './types'

export interface MeshDisplay {
  vertices: Float32Array
  triangles: Uint32Array
  normals: Float32Array
  faceGroups: Array<{ start: number; count: number; faceId: number; name: string }>
  lines: Float32Array
  edgeGroups: Array<{ start: number; count: number; edgeId: number; name: string }>
}

export function meshDisplay(mesh: TriMesh, creaseDegrees = 30, edgeDegrees = 40): MeshDisplay {
  const p = mesh.positions
  const t = mesh.triangles
  const triangleTotal = t.length / 3
  const vertexTotal = p.length / 3
  const faceNormals = new Float64Array(triangleTotal * 3)
  const areas = new Float64Array(triangleTotal)
  for (let tri = 0; tri < triangleTotal; tri++) {
    const a = t[tri * 3] * 3
    const b = t[tri * 3 + 1] * 3
    const c = t[tri * 3 + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const size = Math.hypot(nx, ny, nz)
    areas[tri] = size / 2
    if (size > 0) {
      faceNormals[tri * 3] = nx / size
      faceNormals[tri * 3 + 1] = ny / size
      faceNormals[tri * 3 + 2] = nz / size
    }
  }
  const incident: number[][] = Array.from({ length: vertexTotal }, () => [])
  for (let tri = 0; tri < triangleTotal; tri++) {
    for (let k = 0; k < 3; k++) incident[t[tri * 3 + k]].push(tri)
  }
  const crease = Math.cos((creaseDegrees * Math.PI) / 180)
  const vertices: number[] = []
  const normals: number[] = []
  const triangles = new Uint32Array(t.length)
  const corners = new Map<string, number>()
  for (let tri = 0; tri < triangleTotal; tri++) {
    const fx = faceNormals[tri * 3]
    const fy = faceNormals[tri * 3 + 1]
    const fz = faceNormals[tri * 3 + 2]
    for (let k = 0; k < 3; k++) {
      const v = t[tri * 3 + k]
      let nx = 0
      let ny = 0
      let nz = 0
      for (const other of incident[v]) {
        const ox = faceNormals[other * 3]
        const oy = faceNormals[other * 3 + 1]
        const oz = faceNormals[other * 3 + 2]
        if (fx * ox + fy * oy + fz * oz < crease) continue
        nx += ox * areas[other]
        ny += oy * areas[other]
        nz += oz * areas[other]
      }
      const size = Math.hypot(nx, ny, nz) || 1
      nx /= size
      ny /= size
      nz /= size
      const key = `${v}|${Math.round(nx * 1e4)}|${Math.round(ny * 1e4)}|${Math.round(nz * 1e4)}`
      let index = corners.get(key)
      if (index === undefined) {
        index = vertices.length / 3
        corners.set(key, index)
        vertices.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
        normals.push(nx, ny, nz)
      }
      triangles[tri * 3 + k] = index
    }
  }

  const table = buildEdgeTable(mesh)
  const sharp = Math.cos((edgeDegrees * Math.PI) / 180)
  const feature: number[] = []
  for (let e = 0; e < table.a.length; e++) {
    const users = table.triangles[e]
    if (users.length === 2) {
      const [s, r] = users
      const dot =
        faceNormals[s * 3] * faceNormals[r * 3] +
        faceNormals[s * 3 + 1] * faceNormals[r * 3 + 1] +
        faceNormals[s * 3 + 2] * faceNormals[r * 3 + 2]
      if (dot >= sharp) continue
    }
    feature.push(e)
  }
  const byVertex = new Map<number, number[]>()
  for (const e of feature) {
    for (const v of [table.a[e], table.b[e]]) {
      const list = byVertex.get(v)
      if (list) list.push(e)
      else byVertex.set(v, [e])
    }
  }
  const used = new Set<number>()
  const lines: number[] = []
  const edgeGroups: MeshDisplay['edgeGroups'] = []
  const pushSegment = (e: number) => {
    const a = table.a[e] * 3
    const b = table.b[e] * 3
    lines.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2])
  }
  for (const seed of feature) {
    if (used.has(seed)) continue
    const start = lines.length / 3
    const chain = [seed]
    used.add(seed)
    for (const end of [table.a[seed], table.b[seed]]) {
      let vertex = end
      let edge = seed
      while (true) {
        const next = byVertex.get(vertex)
        if (!next || next.length !== 2) break
        const other = next[0] === edge ? next[1] : next[0]
        if (used.has(other)) break
        used.add(other)
        chain.push(other)
        vertex = table.a[other] === vertex ? table.b[other] : table.a[other]
        edge = other
      }
    }
    for (const e of chain) pushSegment(e)
    edgeGroups.push({
      start,
      count: lines.length / 3 - start,
      edgeId: edgeGroups.length + 1,
      name: '',
    })
  }

  const faceGroups = mesh.groups?.length
    ? mesh.groups.map((group, index) => ({
        start: group.start * 3,
        count: group.count * 3,
        faceId: index + 1,
        name: '',
      }))
    : [{ start: 0, count: t.length, faceId: 1, name: '' }]

  return {
    vertices: new Float32Array(vertices),
    triangles,
    normals: new Float32Array(normals),
    faceGroups,
    lines: new Float32Array(lines),
    edgeGroups,
  }
}
