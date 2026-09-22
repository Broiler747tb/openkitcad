import { TriangleLocator } from './closest'
import { boundsDiagonal, meshBounds, type TriMesh, type Vec3 } from './types'

export interface WallReading {
  thickness: number
  from: Vec3
  to: Vec3
  samples: number
}

export function thinnestWall(mesh: TriMesh, maxSamples = 20000): WallReading | null {
  const p = mesh.positions
  const t = mesh.triangles
  const count = t.length / 3
  if (!count) return null
  const locator = new TriangleLocator(mesh)
  const floor = Math.max(1e-6, boundsDiagonal(meshBounds(mesh)) * 1e-7)
  const stride = Math.max(1, Math.ceil(count / maxSamples))
  const normal = (tri: number): Vec3 | null => {
    const a = t[tri * 3] * 3
    const b = t[tri * 3 + 1] * 3
    const c = t[tri * 3 + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const wx = p[c] - p[a]
    const wy = p[c + 1] - p[a + 1]
    const wz = p[c + 2] - p[a + 2]
    const nx = uy * wz - uz * wy
    const ny = uz * wx - ux * wz
    const nz = ux * wy - uy * wx
    const length = Math.hypot(nx, ny, nz)
    return length > 1e-12 ? [nx / length, ny / length, nz / length] : null
  }
  let best: WallReading | null = null
  let samples = 0
  for (let tri = 0; tri < count; tri += stride) {
    const n = normal(tri)
    if (!n) continue
    const a = t[tri * 3] * 3
    const b = t[tri * 3 + 1] * 3
    const c = t[tri * 3 + 2] * 3
    const from: Vec3 = [
      (p[a] + p[b] + p[c]) / 3,
      (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
      (p[a + 2] + p[b + 2] + p[c + 2]) / 3,
    ]
    const inward: Vec3 = [-n[0], -n[1], -n[2]]
    const hit = locator.raycast(from, inward, Infinity, tri, floor)
    if (!hit) continue
    const exit = normal(hit.triangle)
    if (!exit || exit[0] * inward[0] + exit[1] * inward[1] + exit[2] * inward[2] <= 0) continue
    samples++
    if (!best || hit.distance < best.thickness) {
      best = { thickness: hit.distance, from, to: hit.point, samples: 0 }
    }
  }
  if (!best) return null
  best.samples = samples
  return best
}
