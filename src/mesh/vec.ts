import type { Vec3 } from './types'

export function vertexAt(positions: ArrayLike<number>, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function triangleCross(positions: ArrayLike<number>, a: number, b: number, c: number): Vec3 {
  const ax = positions[a * 3]
  const ay = positions[a * 3 + 1]
  const az = positions[a * 3 + 2]
  const ux = positions[b * 3] - ax
  const uy = positions[b * 3 + 1] - ay
  const uz = positions[b * 3 + 2] - az
  const vx = positions[c * 3] - ax
  const vy = positions[c * 3 + 1] - ay
  const vz = positions[c * 3 + 2] - az
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

export function triangleArea(
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): number {
  return length(triangleCross(positions, a, b, c)) / 2
}

export function triangleNormal(
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): Vec3 {
  return normalize(triangleCross(positions, a, b, c))
}

export function planeBasis(normal: Vec3): [Vec3, Vec3] {
  const n = normalize(normal)
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = normalize(cross(helper, n))
  const v = cross(n, u)
  return [u, v]
}
