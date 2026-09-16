import { triangleComponents } from './topology'
import { subMesh, type TriMesh } from './types'

export function reverseNormals(mesh: TriMesh, triangleIds?: Iterable<number>): TriMesh {
  const triangles = Uint32Array.from(mesh.triangles)
  const flip = (t: number) => {
    const swap = triangles[t * 3 + 1]
    triangles[t * 3 + 1] = triangles[t * 3 + 2]
    triangles[t * 3 + 2] = swap
  }
  if (triangleIds) {
    const done = new Set<number>()
    for (const t of triangleIds) {
      if (t < 0 || t * 3 >= triangles.length || done.has(t)) continue
      done.add(t)
      flip(t)
    }
  } else {
    for (let t = 0; t < triangles.length / 3; t++) flip(t)
  }
  const result: TriMesh = { positions: Float64Array.from(mesh.positions), triangles }
  if (mesh.groups?.length) result.groups = mesh.groups.map((group) => ({ ...group }))
  return result
}

export function separateComponents(mesh: TriMesh): TriMesh[] {
  const { count, ids } = triangleComponents(mesh)
  const lists: number[][] = Array.from({ length: count }, () => [])
  ids.forEach((id, t) => lists[id].push(t))
  return lists.map((list) => subMesh(mesh, list))
}
