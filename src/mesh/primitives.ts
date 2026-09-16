import type { TriMesh, Vec3 } from './types'
import { weldExact } from './weld'

const BOX_FACES: Array<[number, number, number, number]> = [
  [0, 1, 1, 2],
  [0, -1, 2, 1],
  [1, 1, 2, 0],
  [1, -1, 0, 2],
  [2, 1, 0, 1],
  [2, -1, 1, 0],
]

export function boxMesh(
  size: Vec3 = [10, 10, 10],
  origin: Vec3 = [0, 0, 0],
  segments = 1,
): TriMesh {
  const soup: number[] = []
  const steps = Math.max(1, Math.floor(segments))
  for (const [axis, sign, u, v] of BOX_FACES) {
    const corner = (i: number, j: number) => {
      const point = [0, 0, 0]
      point[axis] = origin[axis] + (sign > 0 ? size[axis] : 0)
      point[u] = origin[u] + size[u] * (i / steps)
      point[v] = origin[v] + size[v] * (j / steps)
      return point
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const p00 = corner(i, j)
        const p10 = corner(i + 1, j)
        const p11 = corner(i + 1, j + 1)
        const p01 = corner(i, j + 1)
        soup.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01)
      }
    }
  }
  return weldExact(soup)
}

export function uvSphereMesh(
  radius = 10,
  segments = 32,
  rings = 16,
  centre: Vec3 = [0, 0, 0],
): TriMesh {
  const positions: number[] = [centre[0], centre[1], centre[2] + radius]
  for (let r = 1; r < rings; r++) {
    const theta = (Math.PI * r) / rings
    const z = radius * Math.cos(theta)
    const rho = radius * Math.sin(theta)
    for (let s = 0; s < segments; s++) {
      const phi = (Math.PI * 2 * s) / segments
      positions.push(
        centre[0] + rho * Math.cos(phi),
        centre[1] + rho * Math.sin(phi),
        centre[2] + z,
      )
    }
  }
  positions.push(centre[0], centre[1], centre[2] - radius)
  const south = positions.length / 3 - 1
  const index = (r: number, s: number) => 1 + (r - 1) * segments + (s % segments)
  const triangles: number[] = []
  for (let s = 0; s < segments; s++) triangles.push(0, index(1, s), index(1, s + 1))
  for (let r = 1; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = index(r, s)
      const b = index(r + 1, s)
      const c = index(r + 1, s + 1)
      const d = index(r, s + 1)
      triangles.push(a, b, c, a, c, d)
    }
  }
  for (let s = 0; s < segments; s++)
    triangles.push(south, index(rings - 1, s + 1), index(rings - 1, s))
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) }
}

export function torusMesh(
  majorRadius = 20,
  minorRadius = 5,
  majorSegments = 48,
  minorSegments = 24,
  centre: Vec3 = [0, 0, 0],
): TriMesh {
  const positions: number[] = []
  for (let i = 0; i < majorSegments; i++) {
    const phi = (Math.PI * 2 * i) / majorSegments
    for (let j = 0; j < minorSegments; j++) {
      const theta = (Math.PI * 2 * j) / minorSegments
      const rho = majorRadius + minorRadius * Math.cos(theta)
      positions.push(
        centre[0] + rho * Math.cos(phi),
        centre[1] + rho * Math.sin(phi),
        centre[2] + minorRadius * Math.sin(theta),
      )
    }
  }
  const index = (i: number, j: number) => (i % majorSegments) * minorSegments + (j % minorSegments)
  const triangles: number[] = []
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const a = index(i, j)
      const b = index(i + 1, j)
      const c = index(i + 1, j + 1)
      const d = index(i, j + 1)
      triangles.push(a, b, c, a, c, d)
    }
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) }
}
