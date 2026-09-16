import type { Vec3 } from '../core/math'
import { identityMatrix, multiplyMatrices } from '../doc/model'
import type { Matrix4 } from '../doc/types'
import type { JointAxis } from './types'

export const DEGREES = Math.PI / 180

export function axisIndex(axis: JointAxis): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}

export function axisVector(axis: JointAxis): Vec3 {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function originOf(m: Matrix4): Vec3 {
  return [m[12], m[13], m[14]]
}

export function columnOf(m: Matrix4, index: number): Vec3 {
  return [m[index * 4], m[index * 4 + 1], m[index * 4 + 2]]
}

export function compose(...matrices: Matrix4[]): Matrix4 {
  return matrices.reduce((product, matrix) => multiplyMatrices(product, matrix), identityMatrix())
}

export function rotationAbout(axis: Vec3, radians: number): Matrix4 {
  const [x, y, z] = axis
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const k = 1 - c
  return [
    c + x * x * k,
    y * x * k + z * s,
    z * x * k - y * s,
    0,
    x * y * k - z * s,
    c + y * y * k,
    z * y * k + x * s,
    0,
    x * z * k + y * s,
    y * z * k - x * s,
    c + z * z * k,
    0,
    0,
    0,
    0,
    1,
  ]
}

export function translationAlong(axis: Vec3, distance: number): Matrix4 {
  return [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    axis[0] * distance,
    axis[1] * distance,
    axis[2] * distance,
    1,
  ]
}

export function orthonormalized(m: Matrix4): Matrix4 {
  const x = columnOf(m, 0)
  const lx = Math.hypot(x[0], x[1], x[2]) || 1
  const ux: Vec3 = [x[0] / lx, x[1] / lx, x[2] / lx]
  const y = columnOf(m, 1)
  const d = dot(ux, y)
  const py: Vec3 = [y[0] - d * ux[0], y[1] - d * ux[1], y[2] - d * ux[2]]
  const ly = Math.hypot(py[0], py[1], py[2]) || 1
  const uy: Vec3 = [py[0] / ly, py[1] / ly, py[2] / ly]
  const uz = cross(ux, uy)
  return [...ux, 0, ...uy, 0, ...uz, 0, m[12], m[13], m[14], 1] as Matrix4
}

export function applyWorldDelta(pose: Matrix4, delta: ArrayLike<number>, offset: number): Matrix4 {
  const r: Vec3 = [delta[offset + 3], delta[offset + 4], delta[offset + 5]]
  const angle = Math.hypot(r[0], r[1], r[2])
  const rotation =
    angle > 0 ? rotationAbout([r[0] / angle, r[1] / angle, r[2] / angle], angle) : identityMatrix()
  const turned = multiplyMatrices(rotation, pose)
  turned[12] = pose[12] + delta[offset]
  turned[13] = pose[13] + delta[offset + 1]
  turned[14] = pose[14] + delta[offset + 2]
  return orthonormalized(turned)
}

export function relativeAngle(a: Matrix4, b: Matrix4): number {
  let trace = 0
  const vee: Vec3 = [0, 0, 0]
  const at = (m: Matrix4, row: number, column: number) => m[column * 4 + row]
  const r = (row: number, column: number) =>
    at(a, 0, row) * at(b, 0, column) +
    at(a, 1, row) * at(b, 1, column) +
    at(a, 2, row) * at(b, 2, column)
  trace = r(0, 0) + r(1, 1) + r(2, 2)
  vee[0] = r(2, 1) - r(1, 2)
  vee[1] = r(0, 2) - r(2, 0)
  vee[2] = r(1, 0) - r(0, 1)
  return Math.atan2(0.5 * Math.hypot(vee[0], vee[1], vee[2]), (trace - 1) / 2)
}

export function frameDistance(a: Matrix4, b: Matrix4): { translation: number; angle: number } {
  return {
    translation: Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]),
    angle: relativeAngle(a, b),
  }
}

export function angleAbout(m: Matrix4, axis: JointAxis): number {
  const a = axisVector(axis)
  const perpendicular: JointAxis = axis === 'z' ? 'x' : axis === 'x' ? 'y' : 'z'
  const u = axisVector(perpendicular)
  const turned = columnOf(m, axisIndex(perpendicular))
  return Math.atan2(dot(a, cross(u, turned)), dot(u, turned))
}

export function wrapAngle(radians: number): number {
  const turn = 2 * Math.PI
  let wrapped = radians % turn
  if (wrapped <= -Math.PI) wrapped += turn
  if (wrapped > Math.PI) wrapped -= turn
  return wrapped
}
