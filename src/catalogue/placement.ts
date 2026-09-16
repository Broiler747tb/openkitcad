import type { Vec3 } from '../core/math'
import type { Matrix4 } from '../doc/types'
import {
  invertRigidMatrix,
  multiplyMatrices,
  transformDirection,
  transformPoint,
} from '../doc/model'
import { partFootprint, type CataloguePart } from './types'

export type PartBounds = [number, number, number, number, number, number]

export interface PartMount {
  anchor: Vec3
  axis: 'y' | 'z'
  into: boolean
}

export interface PartDrop {
  point: Vec3
  normal?: Vec3
}

export function partBounds(part: CataloguePart): PartBounds {
  const g = part.geometry
  switch (g.kind) {
    case 'board': {
      const { w, h } = partFootprint(part)
      const bumps = g.bumps ?? []
      return [
        0,
        0,
        Math.min(0, ...bumps.map((bump) => bump.z)),
        w,
        h,
        Math.max(g.thickness, ...bumps.map((bump) => bump.z + bump.height)),
      ]
    }
    case 'extrusion':
      return [0, 0, 0, g.length, g.size, g.size]
    case 'screw':
      return [0, 0, 0, g.headDiameter, g.headDiameter, g.length + g.headHeight]
    case 'insert':
      return [0, 0, 0, g.outerDiameter, g.outerDiameter, g.length]
    case 'standoff':
      return [0, 0, 0, g.acrossFlats, g.acrossFlats, g.length]
    case 'motor':
      return [0, 0, 0, g.frame, g.frame, g.bodyLength + g.bossHeight + g.shaftLength]
    case 'bearing':
      return [0, 0, 0, g.outerDiameter, g.outerDiameter, g.width]
    case 'connector':
      return [0, 0, 0, g.bodyWidth, g.bodyDepth + g.protrusion, g.bodyHeight]
  }
}

export function partMount(part: CataloguePart): PartMount {
  const g = part.geometry
  const [x0, y0, z0, x1, y1] = partBounds(part)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  switch (g.kind) {
    case 'connector':
      return { anchor: [g.bodyWidth / 2, g.bodyDepth, g.bodyHeight / 2], axis: 'y', into: false }
    case 'screw':
    case 'insert':
      return { anchor: [cx, cy, g.length], axis: 'z', into: false }
    case 'motor':
      return { anchor: [cx, cy, g.bodyLength], axis: 'z', into: true }
    default:
      return { anchor: [cx, cy, z0], axis: 'z', into: false }
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2])
  return length ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1]
}

function flattened(v: Vec3, normal: Vec3): Vec3 {
  const d = dot(v, normal)
  return unit([v[0] - normal[0] * d, v[1] - normal[1] * d, v[2] - normal[2] * d])
}

export function axisOf(v: Vec3): number {
  const n = unit(v)
  const index = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0)
  return Math.abs(n[index]) > 1 - 1e-6 ? index : -1
}

function snappedNormal(v: Vec3): Vec3 {
  const axis = axisOf(v)
  if (axis < 0) return unit(v)
  const out: Vec3 = [0, 0, 0]
  out[axis] = Math.sign(v[axis])
  return out
}

function frameMatrix(ex: Vec3, ey: Vec3, ez: Vec3, point: Vec3, anchor: Vec3): Matrix4 {
  const t = [0, 1, 2].map(
    (i) => point[i] - (ex[i] * anchor[0] + ey[i] * anchor[1] + ez[i] * anchor[2]),
  )
  return [
    ex[0],
    ex[1],
    ex[2],
    0,
    ey[0],
    ey[1],
    ey[2],
    0,
    ez[0],
    ez[1],
    ez[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ]
}

export function surfaceMatrix(part: CataloguePart, point: Vec3, normal: Vec3): Matrix4 {
  const mount = partMount(part)
  const n = snappedNormal(normal)
  const out: Vec3 = mount.into ? [-n[0], -n[1], -n[2]] : n
  const level = Math.abs(out[2]) > 0.9
  if (mount.axis === 'z') {
    const ez = out
    if (level) {
      const ex = flattened([1, 0, 0], ez)
      return frameMatrix(ex, cross(ez, ex), ez, point, mount.anchor)
    }
    const ey = flattened([0, 0, 1], ez)
    return frameMatrix(cross(ey, ez), ey, ez, point, mount.anchor)
  }
  const ey = out
  const ez = level ? unit(cross([1, 0, 0], ey)) : flattened([0, 0, 1], ey)
  return frameMatrix(cross(ey, ez), ey, ez, point, mount.anchor)
}

export function groundMatrix(part: CataloguePart, point: Vec3): Matrix4 {
  const [x0, y0, z0, x1, y1] = partBounds(part)
  return frameMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], point, [(x0 + x1) / 2, (y0 + y1) / 2, z0])
}

function tidy(value: number, decimals: number): number {
  const scale = 10 ** decimals
  const rounded = Math.round(value * scale) / scale
  return Object.is(rounded, -0) ? 0 : rounded
}

export function dropPlacement(
  part: CataloguePart,
  drop: PartDrop,
  parent: Matrix4,
  step = 1,
): Matrix4 {
  const inverse = invertRigidMatrix(parent)
  const point = transformPoint(inverse, drop.point)
  const normal = transformDirection(inverse, drop.normal ?? [0, 0, 1])
  const axis = axisOf(normal)
  const snapped: Vec3 =
    step > 0 && axis >= 0
      ? ([0, 1, 2].map((i) => (i === axis ? point[i] : Math.round(point[i] / step) * step)) as Vec3)
      : point
  const local = drop.normal
    ? surfaceMatrix(part, snapped, normal)
    : multiplyMatrices(inverse, groundMatrix(part, transformPoint(parent, snapped)))
  return local.map((value, index) => tidy(value, index >= 12 && index <= 14 ? 6 : 12)) as Matrix4
}
