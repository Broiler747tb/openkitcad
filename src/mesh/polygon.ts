import { triangulate2D } from './earcut'
import { length, normalize, planeBasis, triangleArea } from './vec'
import type { Vec3 } from './types'

export function newellNormal(positions: ArrayLike<number>, loop: ArrayLike<number>): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const count = loop.length
  if (count < 3) return [0, 0, 0]
  const ox = positions[loop[0] * 3]
  const oy = positions[loop[0] * 3 + 1]
  const oz = positions[loop[0] * 3 + 2]
  for (let i = 0; i < count; i++) {
    const a = loop[i] * 3
    const b = loop[(i + 1) % count] * 3
    const ax = positions[a] - ox
    const ay = positions[a + 1] - oy
    const az = positions[a + 2] - oz
    const bx = positions[b] - ox
    const by = positions[b + 1] - oy
    const bz = positions[b + 2] - oz
    nx += (ay - by) * (az + bz)
    ny += (az - bz) * (ax + bx)
    nz += (ax - bx) * (ay + by)
  }
  return [nx, ny, nz]
}

export interface ProjectedLoops {
  coords: number[]
  ids: number[]
  holeStarts: number[]
}

export function projectLoops(
  positions: ArrayLike<number>,
  loops: number[][],
  normal: Vec3,
): ProjectedLoops {
  const [u, v] = planeBasis(normal)
  const coords: number[] = []
  const ids: number[] = []
  const holeStarts: number[] = []
  const first = loops[0]?.[0] ?? 0
  const ox = positions[first * 3]
  const oy = positions[first * 3 + 1]
  const oz = positions[first * 3 + 2]
  loops.forEach((loop, k) => {
    if (k > 0) holeStarts.push(ids.length)
    for (const id of loop) {
      const x = positions[id * 3] - ox
      const y = positions[id * 3 + 1] - oy
      const z = positions[id * 3 + 2] - oz
      coords.push(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2])
      ids.push(id)
    }
  })
  return { coords, ids, holeStarts }
}

export function signedArea2D(
  coords: ArrayLike<number>,
  start = 0,
  end = coords.length / 2,
): number {
  let sum = 0
  for (let i = start, j = end - 1; i < end; j = i++) {
    sum += coords[j * 2] * coords[i * 2 + 1] - coords[i * 2] * coords[j * 2 + 1]
  }
  return sum / 2
}

export function pointInPolygon2D(
  coords: ArrayLike<number>,
  x: number,
  y: number,
  start = 0,
  end = coords.length / 2,
): boolean {
  let inside = false
  for (let i = start, j = end - 1; i < end; j = i++) {
    const xi = coords[i * 2]
    const yi = coords[i * 2 + 1]
    const xj = coords[j * 2]
    const yj = coords[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const value = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function between(a: number, b: number, c: number): boolean {
  return b <= Math.max(a, c) && b >= Math.min(a, c)
}

export function isSimplePolygon2D(coords: ArrayLike<number>): boolean {
  const count = coords.length / 2
  if (count < 3) return false
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    if (coords[i * 2] === coords[j * 2] && coords[i * 2 + 1] === coords[j * 2 + 1]) return false
  }
  for (let i = 0; i < count; i++) {
    const ax = coords[i * 2]
    const ay = coords[i * 2 + 1]
    const bx = coords[((i + 1) % count) * 2]
    const by = coords[((i + 1) % count) * 2 + 1]
    for (let k = i + 2; k < count; k++) {
      if (i === 0 && k === count - 1) continue
      const cx = coords[k * 2]
      const cy = coords[k * 2 + 1]
      const dx = coords[((k + 1) % count) * 2]
      const dy = coords[((k + 1) % count) * 2 + 1]
      const o1 = orientation(ax, ay, bx, by, cx, cy)
      const o2 = orientation(ax, ay, bx, by, dx, dy)
      const o3 = orientation(cx, cy, dx, dy, ax, ay)
      const o4 = orientation(cx, cy, dx, dy, bx, by)
      if (o1 !== o2 && o3 !== o4) return false
      if (o1 === 0 && between(ax, cx, bx) && between(ay, cy, by)) return false
      if (o2 === 0 && between(ax, dx, bx) && between(ay, dy, by)) return false
      if (o3 === 0 && between(cx, ax, dx) && between(cy, ay, dy)) return false
      if (o4 === 0 && between(cx, bx, dx) && between(cy, by, dy)) return false
    }
  }
  return true
}

export function triangulateLoops(
  positions: ArrayLike<number>,
  loops: number[][],
  normal?: Vec3,
): number[] {
  if (!loops.length || loops[0].length < 3) return []
  const n = normalize(normal ?? newellNormal(positions, loops[0]))
  if (length(n) === 0) return []
  const { coords, ids, holeStarts } = projectLoops(positions, loops, n)
  const local = triangulate2D(coords, holeStarts)
  const out: number[] = []
  for (let t = 0; t < local.length; t += 3) {
    const a = local[t]
    const b = local[t + 1]
    const c = local[t + 2]
    const area =
      (coords[b * 2] - coords[a * 2]) * (coords[c * 2 + 1] - coords[a * 2 + 1]) -
      (coords[b * 2 + 1] - coords[a * 2 + 1]) * (coords[c * 2] - coords[a * 2])
    if (area >= 0) out.push(ids[a], ids[b], ids[c])
    else out.push(ids[a], ids[c], ids[b])
  }
  return out
}

function triangleCost(
  positions: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  penaltyScale: number,
): number {
  const area = triangleArea(positions, a, b, c)
  const ab = squaredDistance(positions, a, b)
  const bc = squaredDistance(positions, b, c)
  const ca = squaredDistance(positions, c, a)
  const quality = area > 0 ? Math.min((ab + bc + ca) / (4 * Math.sqrt(3) * area), 1e6) : 1e6
  return area + penaltyScale * (quality - 1)
}

function squaredDistance(positions: ArrayLike<number>, a: number, b: number): number {
  const dx = positions[b * 3] - positions[a * 3]
  const dy = positions[b * 3 + 1] - positions[a * 3 + 1]
  const dz = positions[b * 3 + 2] - positions[a * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

export function minimumAreaTriangulation(positions: ArrayLike<number>, loop: number[]): number[] {
  const count = loop.length
  if (count < 3) return []
  let perimeter = 0
  for (let i = 0; i < count; i++) {
    perimeter += Math.sqrt(squaredDistance(positions, loop[i], loop[(i + 1) % count]))
  }
  const penaltyScale = perimeter * perimeter * 1e-4
  const cost = new Float64Array(count * count)
  const choice = new Int32Array(count * count)
  for (let gap = 2; gap < count; gap++) {
    for (let i = 0; i + gap < count; i++) {
      const j = i + gap
      let best = Infinity
      let bestM = i + 1
      for (let m = i + 1; m < j; m++) {
        const value =
          cost[i * count + m] +
          cost[m * count + j] +
          triangleCost(positions, loop[i], loop[m], loop[j], penaltyScale)
        if (value < best) {
          best = value
          bestM = m
        }
      }
      cost[i * count + j] = best
      choice[i * count + j] = bestM
    }
  }
  const out: number[] = []
  const stack: Array<[number, number]> = [[0, count - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    if (j - i < 2) continue
    const m = choice[i * count + j]
    out.push(loop[i], loop[m], loop[j])
    stack.push([i, m], [m, j])
  }
  return out
}

export function fillLoop(positions: number[], loop: number[]): number[] {
  const count = loop.length
  if (count < 3) return []
  if (count === 3) return [loop[0], loop[1], loop[2]]
  let perimeter = 0
  for (let i = 0; i < count; i++) {
    const a = loop[i] * 3
    const b = loop[(i + 1) % count] * 3
    perimeter += Math.hypot(
      positions[b] - positions[a],
      positions[b + 1] - positions[a + 1],
      positions[b + 2] - positions[a + 2],
    )
  }
  const normal = newellNormal(positions, loop)
  if (count <= 4000 && length(normal) > perimeter * perimeter * 1e-9) {
    const { coords } = projectLoops(positions, [loop], normal)
    if (isSimplePolygon2D(coords)) {
      const triangles = triangulateLoops(positions, [loop], normal)
      if (triangles.length === (count - 2) * 3) return triangles
    }
  }
  if (count <= 300) return minimumAreaTriangulation(positions, loop)
  let cx = 0
  let cy = 0
  let cz = 0
  for (const id of loop) {
    cx += positions[id * 3]
    cy += positions[id * 3 + 1]
    cz += positions[id * 3 + 2]
  }
  const centre = positions.length / 3
  positions.push(cx / count, cy / count, cz / count)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(loop[i], loop[(i + 1) % count], centre)
  return out
}
