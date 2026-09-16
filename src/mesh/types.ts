export type Vec3 = [number, number, number]

export interface MeshGroup {
  name: string
  start: number
  count: number
}

export interface TriMesh {
  positions: Float64Array
  triangles: Uint32Array
  groups?: MeshGroup[]
}

export interface NamedMesh {
  name: string
  mesh: TriMesh
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface MeshPlane {
  origin: Vec3
  normal: Vec3
}

export type MeshUnit = 'um' | 'mm' | 'cm' | 'm' | 'in' | 'ft'

export const MILLIMETRES_PER_UNIT: Record<MeshUnit, number> = {
  um: 0.001,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
}

export class MeshError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeshError'
  }
}

export function createMesh(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  groups?: MeshGroup[],
): TriMesh {
  const mesh: TriMesh = {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  }
  if (groups?.length) mesh.groups = groups.map((group) => ({ ...group }))
  return mesh
}

export function emptyMesh(): TriMesh {
  return { positions: new Float64Array(0), triangles: new Uint32Array(0) }
}

export function vertexCount(mesh: TriMesh): number {
  return mesh.positions.length / 3
}

export function triangleCount(mesh: TriMesh): number {
  return mesh.triangles.length / 3
}

export function cloneMesh(mesh: TriMesh): TriMesh {
  return createMesh(mesh.positions, mesh.triangles, mesh.groups)
}

export function compactMesh(mesh: TriMesh): TriMesh {
  const count = vertexCount(mesh)
  const remap = new Int32Array(count).fill(-1)
  for (let i = 0; i < mesh.triangles.length; i++) remap[mesh.triangles[i]] = 0
  let next = 0
  for (let v = 0; v < count; v++) if (remap[v] === 0) remap[v] = next++
  const positions = new Float64Array(next * 3)
  for (let v = 0; v < count; v++) {
    const target = remap[v]
    if (target < 0) continue
    positions[target * 3] = mesh.positions[v * 3]
    positions[target * 3 + 1] = mesh.positions[v * 3 + 1]
    positions[target * 3 + 2] = mesh.positions[v * 3 + 2]
  }
  const triangles = new Uint32Array(mesh.triangles.length)
  for (let i = 0; i < triangles.length; i++) triangles[i] = remap[mesh.triangles[i]]
  const result: TriMesh = { positions, triangles }
  if (mesh.groups?.length) result.groups = mesh.groups.map((group) => ({ ...group }))
  return result
}

export function subMesh(mesh: TriMesh, triangleIds: ArrayLike<number>): TriMesh {
  const triangles = new Uint32Array(triangleIds.length * 3)
  for (let i = 0; i < triangleIds.length; i++) {
    const t = triangleIds[i]
    triangles[i * 3] = mesh.triangles[t * 3]
    triangles[i * 3 + 1] = mesh.triangles[t * 3 + 1]
    triangles[i * 3 + 2] = mesh.triangles[t * 3 + 2]
  }
  return compactMesh({ positions: mesh.positions, triangles })
}

export function mergeMeshes(meshes: TriMesh[]): TriMesh {
  let positionLength = 0
  let triangleLength = 0
  for (const mesh of meshes) {
    positionLength += mesh.positions.length
    triangleLength += mesh.triangles.length
  }
  const positions = new Float64Array(positionLength)
  const triangles = new Uint32Array(triangleLength)
  const groups: MeshGroup[] = []
  let positionOffset = 0
  let triangleOffset = 0
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset)
    const base = positionOffset / 3
    for (let i = 0; i < mesh.triangles.length; i++) {
      triangles[triangleOffset + i] = mesh.triangles[i] + base
    }
    for (const group of mesh.groups ?? []) {
      groups.push({ name: group.name, start: group.start + triangleOffset / 3, count: group.count })
    }
    positionOffset += mesh.positions.length
    triangleOffset += mesh.triangles.length
  }
  const result: TriMesh = { positions, triangles }
  if (groups.length) result.groups = groups
  return result
}

export function transformMesh(mesh: TriMesh, matrix: ArrayLike<number>): TriMesh {
  const m = matrix
  const p = mesh.positions
  const positions = new Float64Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]
    const y = p[i + 1]
    const z = p[i + 2]
    positions[i] = m[0] * x + m[4] * y + m[8] * z + m[12]
    positions[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    positions[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  const determinant =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  const triangles = Uint32Array.from(mesh.triangles)
  if (determinant < 0) {
    for (let t = 0; t < triangles.length; t += 3) {
      const swap = triangles[t + 1]
      triangles[t + 1] = triangles[t + 2]
      triangles[t + 2] = swap
    }
  }
  const result: TriMesh = { positions, triangles }
  if (mesh.groups?.length) result.groups = mesh.groups.map((group) => ({ ...group }))
  return result
}

export function scaleMesh(mesh: TriMesh, factor: number): TriMesh {
  return transformMesh(mesh, [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1])
}

export function meshBounds(mesh: TriMesh): Bounds {
  const p = mesh.positions
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = p[i + k]
      if (value < min[k]) min[k] = value
      if (value > max[k]) max[k] = value
    }
  }
  return { min, max }
}

export function boundsDiagonal(bounds: Bounds): number {
  return Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  )
}

export function meshGroupNames(mesh: TriMesh): string[] {
  const names: string[] = []
  for (const group of mesh.groups ?? []) if (!names.includes(group.name)) names.push(group.name)
  return names
}

export function splitByGroup(mesh: TriMesh): NamedMesh[] {
  if (!mesh.groups?.length)
    return [{ name: 'Mesh', mesh: compactMesh({ ...mesh, groups: undefined }) }]
  return meshGroupNames(mesh).map((name) => {
    const ids: number[] = []
    for (const group of mesh.groups!) {
      if (group.name !== name) continue
      for (let t = group.start; t < group.start + group.count; t++) ids.push(t)
    }
    return { name, mesh: subMesh(mesh, ids) }
  })
}
