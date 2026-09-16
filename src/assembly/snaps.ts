import type { Vec3 } from '../core/math'
import type { JointKeypoint, Matrix4 } from '../doc/types'
import type { BodyMesh } from '../kernel/types'
import { cross, dot } from './frames'

export interface SnapFrame {
  frame: Matrix4
  keypoint: JointKeypoint
}

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (v: Vec3): Vec3 => {
  const l = length(v)
  return l > 1e-12 ? scale(v, 1 / l) : [0, 0, 1]
}

export function frameAt(origin: Vec3, normal: Vec3, hint?: Vec3): Matrix4 {
  const z = unit(normal)
  const candidates: Vec3[] = [...(hint ? [hint] : []), [1, 0, 0], [0, 1, 0], [0, 0, 1]]
  let x: Vec3 = [1, 0, 0]
  for (const candidate of candidates) {
    const projected = sub(candidate, scale(z, dot(candidate, z)))
    if (length(projected) > 0.3) {
      x = unit(projected)
      break
    }
  }
  const y = cross(z, x)
  return [
    x[0],
    x[1],
    x[2],
    0,
    y[0],
    y[1],
    y[2],
    0,
    z[0],
    z[1],
    z[2],
    0,
    origin[0],
    origin[1],
    origin[2],
    1,
  ]
}

function vertex(data: Float32Array, index: number): Vec3 {
  return [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]]
}

function meshCentre(mesh: BodyMesh): Vec3 {
  const [x0, y0, z0, x1, y1, z1] = mesh.bounds
  return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
}

function outward(mesh: BodyMesh, at: Vec3, direction: Vec3, normal?: Vec3): Vec3 {
  const axis = unit(direction)
  if (normal && Math.abs(dot(unit(normal), axis)) > 0.5) {
    return dot(normal, axis) < 0 ? scale(axis, -1) : axis
  }
  const away = dot(sub(at, meshCentre(mesh)), axis)
  if (Math.abs(away) > 1e-9) return away < 0 ? scale(axis, -1) : axis
  return canonical(axis)
}

function canonical(direction: Vec3): Vec3 {
  const axis = unit(direction)
  const largest = axis.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(axis[best]) ? index : best),
    0,
  )
  return axis[largest] < 0 ? scale(axis, -1) : axis
}

interface Facet {
  area: number
  centre: Vec3
  normal: Vec3
}

function facetsOf(
  mesh: BodyMesh,
  name: string,
  id?: number,
): { facets: Facet[]; points: Vec3[] } | null {
  const group = mesh.mesh.faceGroups.find((candidate) =>
    name ? candidate.name === name : candidate.faceId === id,
  )
  if (!group || group.count < 3) return null
  const { vertices, triangles } = mesh.mesh
  const facets: Facet[] = []
  const points: Vec3[] = []
  for (let k = group.start; k + 2 < group.start + group.count; k += 3) {
    const a = vertex(vertices, triangles[k])
    const b = vertex(vertices, triangles[k + 1])
    const c = vertex(vertices, triangles[k + 2])
    points.push(a, b, c)
    const n = cross(sub(b, a), sub(c, a))
    const doubled = length(n)
    if (doubled < 1e-15) continue
    facets.push({
      area: doubled,
      centre: scale(add(add(a, b), c), 1 / 3),
      normal: scale(n, 1 / doubled),
    })
  }
  return facets.length ? { facets, points } : null
}

function cylinderSnap(
  mesh: BodyMesh,
  facets: Facet[],
  points: Vec3[],
  near?: Vec3,
): SnapFrame | null {
  const largest = facets.reduce((best, facet) => (facet.area > best.area ? facet : best))
  let best = 0
  let axis: Vec3 = [0, 0, 1]
  for (const facet of facets) {
    const turned = cross(largest.normal, facet.normal)
    const size = length(turned)
    if (size > best) {
      best = size
      axis = turned
    }
  }
  if (best < 0.02) return null
  axis = unit(axis)
  if (facets.some((facet) => Math.abs(dot(facet.normal, axis)) > 0.05)) return null
  const seed: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const across = unit(sub(seed, scale(axis, dot(seed, axis))))
  const v = cross(axis, across)
  let a11 = 0
  let a12 = 0
  let a22 = 0
  let b1 = 0
  let b2 = 0
  for (const facet of facets) {
    const nx = dot(facet.normal, across)
    const ny = dot(facet.normal, v)
    const size = Math.hypot(nx, ny)
    if (size < 1e-9) continue
    const [px, py] = [nx / size, ny / size]
    const cx = dot(facet.centre, across)
    const cy = dot(facet.centre, v)
    const m11 = 1 - px * px
    const m12 = -px * py
    const m22 = 1 - py * py
    a11 += facet.area * m11
    a12 += facet.area * m12
    a22 += facet.area * m22
    b1 += facet.area * (m11 * cx + m12 * cy)
    b2 += facet.area * (m12 * cx + m22 * cy)
  }
  const determinant = a11 * a22 - a12 * a12
  const total = facets.reduce((sum, facet) => sum + facet.area, 0)
  if (Math.abs(determinant) < 1e-6 * total * total) return null
  const x = (b1 * a22 - b2 * a12) / determinant
  const y = (a11 * b2 - a12 * b1) / determinant
  let low = Infinity
  let high = -Infinity
  for (const point of points) {
    const height = dot(point, axis)
    low = Math.min(low, height)
    high = Math.max(high, height)
  }
  const at = (height: number): Vec3 => add(add(scale(across, x), scale(v, y)), scale(axis, height))
  const span = high - low
  const height = near ? dot(near, axis) : (low + high) / 2
  if (near && span > 1e-9 && height - low < span / 4) {
    const end = at(low)
    return { frame: frameAt(end, outward(mesh, end, axis)), keypoint: 'centre' }
  }
  if (near && span > 1e-9 && high - height < span / 4) {
    const end = at(high)
    return { frame: frameAt(end, outward(mesh, end, axis)), keypoint: 'centre' }
  }
  const middle = at((low + high) / 2)
  return { frame: frameAt(middle, canonical(axis)), keypoint: 'middle' }
}

export function faceSnap(mesh: BodyMesh, name: string, near?: Vec3, id?: number): SnapFrame | null {
  const found = facetsOf(mesh, name, id)
  if (!found) return null
  const { facets, points } = found
  let area = 0
  let centre: Vec3 = [0, 0, 0]
  let normal: Vec3 = [0, 0, 0]
  for (const facet of facets) {
    area += facet.area
    centre = add(centre, scale(facet.centre, facet.area))
    normal = add(normal, scale(facet.normal, facet.area))
  }
  centre = scale(centre, 1 / area)
  const mean = unit(normal)
  const planar = facets.every((facet) => dot(facet.normal, mean) > 0.9998)
  if (!planar) {
    const cylinder = cylinderSnap(mesh, facets, points, near)
    if (cylinder) return cylinder
  }
  return { frame: frameAt(centre, normal), keypoint: 'centre' }
}

function edgePoints(mesh: BodyMesh, name: string, id?: number): Vec3[] {
  const group = mesh.edges.edgeGroups.find((candidate) =>
    name ? candidate.name === name : candidate.edgeId === id,
  )
  if (!group) return []
  const points: Vec3[] = []
  for (let i = group.start; i < group.start + group.count; i++) {
    const p = vertex(mesh.edges.lines, i)
    const last = points[points.length - 1]
    if (!last || length(sub(p, last)) > 1e-9) points.push(p)
  }
  return points
}

export function edgeSnap(
  mesh: BodyMesh,
  name: string,
  near?: Vec3,
  normal?: Vec3,
  id?: number,
): SnapFrame | null {
  const points = edgePoints(mesh, name, id)
  if (points.length < 2) return null
  const first = points[0]
  const last = points[points.length - 1]
  const span = points.reduce((most, p) => Math.max(most, length(sub(p, first))), 0)
  if (points.length >= 4) {
    const a = first
    const b = points[Math.floor(points.length / 3)]
    const c = points[Math.floor((2 * points.length) / 3)]
    const ab = sub(b, a)
    const ac = sub(c, a)
    const n = cross(ab, ac)
    const nn = dot(n, n)
    if (nn > 1e-12 * span ** 4) {
      const centre = add(
        a,
        scale(
          add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))),
          1 / (2 * nn),
        ),
      )
      const radius = length(sub(a, centre))
      const round = points.every(
        (p) => Math.abs(length(sub(p, centre)) - radius) <= Math.max(1e-4, radius * 1e-3),
      )
      if (round) {
        return {
          frame: frameAt(centre, outward(mesh, centre, n, normal), sub(a, centre)),
          keypoint: 'centre',
        }
      }
    }
  }
  let total = 0
  const lengths = points.slice(1).map((p, i) => {
    const l = length(sub(p, points[i]))
    total += l
    return l
  })
  let walked = 0
  let middle = first
  let direction = unit(sub(last, first))
  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= total / 2) {
      const t = lengths[i] > 0 ? (total / 2 - walked) / lengths[i] : 0
      middle = add(points[i], scale(sub(points[i + 1], points[i]), t))
      direction = unit(sub(points[i + 1], points[i]))
      break
    }
    walked += lengths[i]
  }
  if (near && length(sub(near, first)) < length(sub(near, middle)) * 0.5) {
    return { frame: frameAt(first, direction), keypoint: 'point' }
  }
  if (near && length(sub(near, last)) < length(sub(near, middle)) * 0.5) {
    return { frame: frameAt(last, direction), keypoint: 'point' }
  }
  return { frame: frameAt(middle, direction), keypoint: 'middle' }
}

export function snapFromMesh(
  mesh: BodyMesh,
  kind: 'face' | 'edge' | 'vertex',
  name: string,
  near?: Vec3,
  normal?: Vec3,
  id?: number,
): SnapFrame | null {
  if (kind === 'face') return faceSnap(mesh, name, near, id)
  if (kind === 'edge') return edgeSnap(mesh, name, near, normal, id)
  if (!near) return null
  return {
    frame: frameAt(near, normal ? outward(mesh, near, normal, normal) : [0, 0, 1]),
    keypoint: 'point',
  }
}
