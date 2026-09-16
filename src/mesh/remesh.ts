import { TriangleLocator } from './closest'
import { EditMesh, crossOf } from './edit'
import { cloneMesh, triangleCount, type TriMesh, type Vec3 } from './types'

export interface RemeshOptions {
  edgeLength?: number
  iterations?: number
  sharpAngle?: number
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export function meanEdgeLength(mesh: TriMesh): number {
  const p = mesh.positions
  const t = mesh.triangles
  let total = 0
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t[i + k] * 3
      const b = t[i + ((k + 1) % 3)] * 3
      total += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2])
    }
  }
  return t.length ? total / t.length : 0
}

export function remeshMesh(mesh: TriMesh, options: RemeshOptions = {}): TriMesh {
  if (!triangleCount(mesh)) return cloneMesh(mesh)
  const target = options.edgeLength ?? meanEdgeLength(mesh)
  if (!(target > 0)) return cloneMesh(mesh)
  const high = (4 / 3) * target
  const low = (4 / 5) * target
  const iterations = Math.max(1, Math.round(options.iterations ?? 5))
  const cosSharp = Math.cos(((options.sharpAngle ?? 30) * Math.PI) / 180)
  const locator = new TriangleLocator(mesh)
  const em = EditMesh.from(mesh)

  const normalOf = (t: number): Vec3 => {
    const [a, b, c] = em.triangle(t)
    return crossOf(em.point(a), em.point(b), em.point(c))
  }
  const unit = (v: Vec3): Vec3 => {
    const size = Math.hypot(v[0], v[1], v[2])
    return size > 0 ? [v[0] / size, v[1] / size, v[2] / size] : [0, 0, 0]
  }
  const isFeatureEdge = (u: number, v: number) => {
    const shared = em.edgeTriangles(u, v)
    if (shared.length !== 2) return true
    const n0 = unit(normalOf(shared[0]))
    const n1 = unit(normalOf(shared[1]))
    return n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < cosSharp
  }
  const featureEdges = (v: number) => em.ring(v).filter((w) => isFeatureEdge(v, w)).length
  const liveEdges = () => {
    const list: Array<[number, number]> = []
    for (let u = 0; u < em.vertexCount; u++) {
      if (!em.incident[u].length) continue
      for (const w of em.ring(u)) if (u < w) list.push([u, w])
    }
    return list
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let pass = 0; pass < 8; pass++) {
      let split = false
      for (const [u, v] of liveEdges()) {
        if (!em.edgeTriangles(u, v).length) continue
        const pu = em.point(u)
        const pv = em.point(v)
        if (distance(pu, pv) <= high) continue
        em.split(u, v, [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2])
        split = true
      }
      if (!split) break
    }

    for (const [u, v] of liveEdges()) {
      if (!em.incident[u].length || !em.incident[v].length) continue
      if (!em.edgeTriangles(u, v).length) continue
      const pu = em.point(u)
      const pv = em.point(v)
      if (distance(pu, pv) >= low) continue
      const fu = featureEdges(u)
      const fv = featureEdges(v)
      let keep = u
      let drop = v
      let position: Vec3 = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2]
      if (fu || fv) {
        if (fu && fv) {
          if (!isFeatureEdge(u, v)) continue
          const cornerU = fu !== 2
          const cornerV = fv !== 2
          if (cornerU && cornerV) continue
          if (cornerV) {
            keep = v
            drop = u
          }
        } else if (fv) {
          keep = v
          drop = u
        }
        position = em.point(keep)
      }
      const tooLong = [...em.ring(drop), ...em.ring(keep)].some(
        (w) => w !== keep && w !== drop && distance(em.point(w), position) > high,
      )
      if (tooLong) continue
      if (!em.canCollapse(keep, drop) || em.collapseFoldsOver(keep, drop, position, 0.5)) continue
      em.collapse(keep, drop, position)
    }

    for (const [u, v] of liveEdges()) {
      const candidate = em.flipCandidates(u, v)
      if (!candidate || isFeatureEdge(u, v)) continue
      const a = candidate.first[2]
      const b = candidate.second[2]
      const ideal = (x: number) => (em.isBoundaryVertex(x) ? 4 : 6)
      const valence = (x: number) => em.ring(x).length
      const deviation = (x: number, change: number) => Math.abs(valence(x) + change - ideal(x))
      const before = deviation(u, 0) + deviation(v, 0) + deviation(a, 0) + deviation(b, 0)
      const after = deviation(u, -1) + deviation(v, -1) + deviation(a, 1) + deviation(b, 1)
      if (after >= before) continue
      const old = unit(
        candidate.triangles
          .map(normalOf)
          .reduce((sum, n) => [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]], [0, 0, 0] as Vec3),
      )
      if (!em.flip(u, v)) continue
      const folded = em.edgeTriangles(a, b).some((t) => {
        const n = unit(normalOf(t))
        return n[0] * old[0] + n[1] * old[1] + n[2] * old[2] < 0.5
      })
      if (folded) em.flip(a, b)
    }

    const moved: Array<[number, Vec3]> = []
    for (let v = 0; v < em.vertexCount; v++) {
      if (!em.incident[v].length || featureEdges(v)) continue
      const ring = em.ring(v)
      if (ring.length < 3) continue
      const p = em.point(v)
      const centre: Vec3 = [0, 0, 0]
      for (const w of ring) {
        const q = em.point(w)
        centre[0] += q[0] / ring.length
        centre[1] += q[1] / ring.length
        centre[2] += q[2] / ring.length
      }
      const normal = unit(
        em.incident[v]
          .map(normalOf)
          .reduce((sum, n) => [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]], [0, 0, 0] as Vec3),
      )
      const d: Vec3 = [centre[0] - p[0], centre[1] - p[1], centre[2] - p[2]]
      const along = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]
      moved.push([
        v,
        [
          p[0] + 0.8 * (d[0] - along * normal[0]),
          p[1] + 0.8 * (d[1] - along * normal[1]),
          p[2] + 0.8 * (d[2] - along * normal[2]),
        ],
      ])
    }
    const relaxed = new Map(moved)
    for (let v = 0; v < em.vertexCount; v++) {
      if (!em.incident[v].length) continue
      em.setPoint(v, locator.closestPoint(relaxed.get(v) ?? em.point(v)).point)
    }
  }
  return em.toMesh()
}
