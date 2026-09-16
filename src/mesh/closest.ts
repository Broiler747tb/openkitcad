import { boundsDiagonal, meshBounds, type TriMesh, type Vec3 } from './types'

export interface ClosestPoint {
  point: Vec3
  triangle: number
  distanceSquared: number
}

export function closestPointOnTriangle(
  p: Vec3,
  positions: ArrayLike<number>,
  ia: number,
  ib: number,
  ic: number,
): Vec3 {
  const ax = positions[ia * 3]
  const ay = positions[ia * 3 + 1]
  const az = positions[ia * 3 + 2]
  const bx = positions[ib * 3]
  const by = positions[ib * 3 + 1]
  const bz = positions[ib * 3 + 2]
  const cx = positions[ic * 3]
  const cy = positions[ic * 3 + 1]
  const cz = positions[ic * 3 + 2]
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const apx = p[0] - ax
  const apy = p[1] - ay
  const apz = p[2] - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az]
  const bpx = p[0] - bx
  const bpy = p[1] - by
  const bpz = p[2] - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [ax + abx * v, ay + aby * v, az + abz * v]
  }
  const cpx = p[0] - cx
  const cpy = p[1] - cy
  const cpz = p[2] - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [ax + acx * w, ay + acy * w, az + acz * w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w]
  }
  const denominator = 1 / (va + vb + vc)
  const v = vb * denominator
  const w = vc * denominator
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w]
}

export class TriangleLocator {
  private readonly positions: Float64Array
  private readonly triangles: Uint32Array
  private readonly origin: Vec3
  private readonly cell: number
  private readonly dims: [number, number, number]
  private readonly cells = new Map<number, number[]>()
  private readonly stamp: Uint32Array
  private query = 0

  constructor(mesh: TriMesh, cellSize?: number) {
    this.positions = Float64Array.from(mesh.positions)
    this.triangles = Uint32Array.from(mesh.triangles)
    const bounds = meshBounds(mesh)
    const p = this.positions
    const t = this.triangles
    const count = t.length / 3
    let edgeSum = 0
    for (let i = 0; i < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = t[i + k] * 3
        const b = t[i + ((k + 1) % 3)] * 3
        edgeSum += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2])
      }
    }
    const meanEdge = count ? edgeSum / (count * 3) : 1
    const diagonal = boundsDiagonal(bounds)
    this.cell = cellSize ?? Math.max(meanEdge * 1.5, diagonal / 128, 1e-9)
    this.origin = bounds.min
    this.dims = [0, 1, 2].map((k) =>
      Math.max(1, Math.floor((bounds.max[k] - bounds.min[k]) / this.cell) + 1),
    ) as [number, number, number]
    this.stamp = new Uint32Array(count)
    for (let tri = 0; tri < count; tri++) {
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < 3; k++) {
        const v = t[tri * 3 + k] * 3
        for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], p[v + axis])
          hi[axis] = Math.max(hi[axis], p[v + axis])
        }
      }
      const from = lo.map((value, axis) => this.cellIndex(value, axis))
      const to = hi.map((value, axis) => this.cellIndex(value, axis))
      for (let x = from[0]; x <= to[0]; x++) {
        for (let y = from[1]; y <= to[1]; y++) {
          for (let z = from[2]; z <= to[2]; z++) {
            const key = x + this.dims[0] * (y + this.dims[1] * z)
            const list = this.cells.get(key)
            if (list) list.push(tri)
            else this.cells.set(key, [tri])
          }
        }
      }
    }
  }

  private cellIndex(value: number, axis: number): number {
    const index = Math.floor((value - this.origin[axis]) / this.cell)
    return Math.min(this.dims[axis] - 1, Math.max(0, index))
  }

  closestPoint(point: Vec3): ClosestPoint {
    this.query++
    if (this.query >= 0xffffffff) {
      this.stamp.fill(0)
      this.query = 1
    }
    const centre = [0, 1, 2].map((axis) => this.cellIndex(point[axis], axis))
    let best = Infinity
    let bestTriangle = -1
    let bestPoint: Vec3 = [point[0], point[1], point[2]]
    const visit = (x: number, y: number, z: number) => {
      const list = this.cells.get(x + this.dims[0] * (y + this.dims[1] * z))
      if (!list) return
      for (const tri of list) {
        if (this.stamp[tri] === this.query) continue
        this.stamp[tri] = this.query
        const q = closestPointOnTriangle(
          point,
          this.positions,
          this.triangles[tri * 3],
          this.triangles[tri * 3 + 1],
          this.triangles[tri * 3 + 2],
        )
        const d2 = (q[0] - point[0]) ** 2 + (q[1] - point[1]) ** 2 + (q[2] - point[2]) ** 2
        if (d2 < best) {
          best = d2
          bestTriangle = tri
          bestPoint = q
        }
      }
    }
    const maxRadius = Math.max(...this.dims)
    for (let r = 0; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = centre[0] + dx
        if (x < 0 || x >= this.dims[0]) continue
        for (let dy = -r; dy <= r; dy++) {
          const y = centre[1] + dy
          if (y < 0 || y >= this.dims[1]) continue
          const shell = Math.abs(dx) === r || Math.abs(dy) === r
          const step = shell || r === 0 ? 1 : 2 * r
          for (let dz = -r; dz <= r; dz += step) {
            const z = centre[2] + dz
            if (z < 0 || z >= this.dims[2]) continue
            visit(x, y, z)
          }
        }
      }
      if (bestTriangle >= 0 && Math.sqrt(best) <= r * this.cell) break
    }
    return { point: bestPoint, triangle: bestTriangle, distanceSquared: best }
  }
}
