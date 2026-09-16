import type { TriMesh } from './types'

const floatScratch = new Float64Array(1)
const wordScratch = new Uint32Array(floatScratch.buffer)

function hashFloat(seed: number, value: number): number {
  floatScratch[0] = value
  let h = Math.imul(seed ^ wordScratch[0], 0x85ebca6b)
  h = Math.imul(h ^ wordScratch[1], 0xc2b2ae35)
  return h ^ (h >>> 13)
}

function cellKey(x: number, y: number, z: number): number {
  return Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
}

export function weldExact(positions: ArrayLike<number>, triangles?: ArrayLike<number>): TriMesh {
  const count = Math.floor(positions.length / 3)
  const buckets = new Map<number, number[]>()
  const out: number[] = []
  const remap = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] + 0
    const y = positions[i * 3 + 1] + 0
    const z = positions[i * 3 + 2] + 0
    const key = hashFloat(hashFloat(hashFloat(0x9e3779b9, x), y), z)
    let bucket = buckets.get(key)
    let found = -1
    if (bucket) {
      for (const j of bucket) {
        if (out[j * 3] === x && out[j * 3 + 1] === y && out[j * 3 + 2] === z) {
          found = j
          break
        }
      }
    } else {
      bucket = []
      buckets.set(key, bucket)
    }
    if (found < 0) {
      found = out.length / 3
      out.push(x, y, z)
      bucket.push(found)
    }
    remap[i] = found
  }
  const indexed = triangles ? Uint32Array.from(triangles, (v) => remap[v]) : remap
  return { positions: Float64Array.from(out), triangles: indexed }
}

export function weldVertices(mesh: TriMesh, tolerance: number): { mesh: TriMesh; merged: number } {
  const count = mesh.positions.length / 3
  if (!(tolerance > 0)) {
    const welded = weldExact(mesh.positions, mesh.triangles)
    if (mesh.groups?.length) welded.groups = mesh.groups.map((group) => ({ ...group }))
    return { mesh: welded, merged: count - welded.positions.length / 3 }
  }
  const p = mesh.positions
  const inverse = 1 / tolerance
  const limit = tolerance * tolerance
  const cells = new Map<number, number[]>()
  const out: number[] = []
  const remap = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const x = p[i * 3]
    const y = p[i * 3 + 1]
    const z = p[i * 3 + 2]
    const cx = Math.floor(x * inverse)
    const cy = Math.floor(y * inverse)
    const cz = Math.floor(z * inverse)
    let found = -1
    let best = limit
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = cells.get(cellKey(cx + dx, cy + dy, cz + dz))
          if (!bucket) continue
          for (const j of bucket) {
            const ex = out[j * 3] - x
            const ey = out[j * 3 + 1] - y
            const ez = out[j * 3 + 2] - z
            const d2 = ex * ex + ey * ey + ez * ez
            if (found < 0 ? d2 <= best : d2 < best) {
              best = d2
              found = j
            }
          }
        }
      }
    }
    if (found < 0) {
      found = out.length / 3
      out.push(x, y, z)
      const key = cellKey(cx, cy, cz)
      const bucket = cells.get(key)
      if (bucket) bucket.push(found)
      else cells.set(key, [found])
    }
    remap[i] = found
  }
  const welded: TriMesh = {
    positions: Float64Array.from(out),
    triangles: Uint32Array.from(mesh.triangles, (v) => remap[v]),
  }
  if (mesh.groups?.length) welded.groups = mesh.groups.map((group) => ({ ...group }))
  return { mesh: welded, merged: count - out.length / 3 }
}
