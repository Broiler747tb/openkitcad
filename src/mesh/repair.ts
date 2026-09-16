import { defaultLengthTolerance, isDegenerateTriangle, signedVolume } from './analysis'
import { EditMesh } from './edit'
import { fillLoop } from './polygon'
import { boundaryLoops, buildEdgeTable, pointInsideTriangles, triangleTraverses } from './topology'
import {
  boundsDiagonal,
  compactMesh,
  createMesh,
  meshBounds,
  type TriMesh,
  type Vec3,
} from './types'
import { weldVertices } from './weld'

export interface RepairOptions {
  weldTolerance?: number
  removeDegenerates?: boolean
  removeDuplicates?: boolean
  orient?: boolean
  fillHoles?: boolean
  maxHoleEdges?: number
}

export interface RepairReport {
  weldedVertices: number
  removedDuplicateTriangles: number
  fixedDegenerateTriangles: number
  flippedTriangles: number
  invertedShells: number
  filledHoles: number
  unfilledHoles: number
  consistentlyOriented: boolean
  watertight: boolean
}

export function removeDegenerateTriangles(
  mesh: TriMesh,
  tolerance = defaultLengthTolerance(mesh),
): { mesh: TriMesh; fixed: number } {
  const em = EditMesh.from(mesh)
  let fixed = 0
  for (let pass = 0; pass < 16; pass++) {
    let changed = false
    const slots = em.alive.length
    for (let t = 0; t < slots; t++) {
      if (!em.alive[t]) continue
      const [a, b, c] = em.triangle(t)
      if (!isDegenerateTriangle(em.positions, a, b, c, tolerance)) continue
      changed = true
      fixed++
      if (a === b || b === c || a === c) {
        em.removeTriangle(t)
        continue
      }
      const edges = [
        [a, b],
        [b, c],
        [c, a],
      ]
        .map(([u, v]) => {
          const pu = em.point(u)
          const pv = em.point(v)
          return { u, v, length: Math.hypot(pu[0] - pv[0], pu[1] - pv[1], pu[2] - pv[2]) }
        })
        .sort((x, y) => x.length - y.length)
      const shortest = edges[0]
      const longest = edges[2]
      if (shortest.length <= tolerance) {
        if (em.canCollapse(shortest.u, shortest.v)) {
          em.collapse(shortest.u, shortest.v, em.point(shortest.u))
        } else {
          em.removeTriangle(t)
        }
      } else if (!em.flip(longest.u, longest.v)) {
        em.removeTriangle(t)
      }
    }
    if (!changed) break
  }
  return { mesh: em.toMesh(), fixed }
}

function orientationParity(a: number, b: number, c: number): number {
  if (a < b && a < c) return b < c ? 0 : 1
  if (b < a && b < c) return c < a ? 0 : 1
  return a < b ? 0 : 1
}

export function removeDuplicateTriangles(mesh: TriMesh): { mesh: TriMesh; removed: number } {
  const t = mesh.triangles
  const count = t.length / 3
  const groups = new Map<string, number[]>()
  for (let tri = 0; tri < count; tri++) {
    const sorted = [t[tri * 3], t[tri * 3 + 1], t[tri * 3 + 2]].sort((x, y) => x - y)
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`
    const list = groups.get(key)
    if (list) list.push(tri)
    else groups.set(key, [tri])
  }
  const keep = new Uint8Array(count).fill(1)
  let removed = 0
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const even: number[] = []
    const odd: number[] = []
    for (const tri of list) {
      if (orientationParity(t[tri * 3], t[tri * 3 + 1], t[tri * 3 + 2]) === 0) even.push(tri)
      else odd.push(tri)
    }
    for (const tri of list) keep[tri] = 0
    if (even.length > odd.length) keep[even[0]] = 1
    else if (odd.length > even.length) keep[odd[0]] = 1
    removed += list.length - (even.length === odd.length ? 0 : 1)
  }
  if (!removed) return { mesh, removed }
  const triangles: number[] = []
  for (let tri = 0; tri < count; tri++) {
    if (keep[tri]) triangles.push(t[tri * 3], t[tri * 3 + 1], t[tri * 3 + 2])
  }
  return { mesh: createMesh(mesh.positions, triangles), removed }
}

export interface OrientResult {
  mesh: TriMesh
  flipped: number
  invertedShells: number
  consistent: boolean
  shells: number
}

export function orientMesh(mesh: TriMesh): OrientResult {
  const table = buildEdgeTable(mesh)
  const t = Uint32Array.from(mesh.triangles)
  const count = t.length / 3
  const shellOf = new Int32Array(count).fill(-1)
  const shells: number[][] = []
  let flipped = 0
  let consistent = true
  const flip = (tri: number) => {
    const swap = t[tri * 3 + 1]
    t[tri * 3 + 1] = t[tri * 3 + 2]
    t[tri * 3 + 2] = swap
  }
  for (let seed = 0; seed < count; seed++) {
    if (shellOf[seed] >= 0) continue
    const id = shells.length
    const members = [seed]
    shellOf[seed] = id
    const queue = [seed]
    while (queue.length) {
      const tri = queue.pop()!
      for (let k = 0; k < 3; k++) {
        const edge = table.triangleEdges[tri * 3 + k]
        if (edge < 0) continue
        const users = table.triangles[edge]
        if (users.length !== 2) continue
        const other = users[0] === tri ? users[1] : users[0]
        if (other === tri) continue
        const u = table.a[edge]
        const v = table.b[edge]
        const same = triangleTraverses(t, tri, u, v) === triangleTraverses(t, other, u, v)
        if (shellOf[other] < 0) {
          shellOf[other] = id
          if (same) {
            flip(other)
            flipped++
          }
          members.push(other)
          queue.push(other)
        } else if (same) {
          consistent = false
        }
      }
    }
    shells.push(members)
  }
  const oriented: TriMesh = { positions: mesh.positions, triangles: t }
  const closed = shells.map((members) =>
    members.every((tri) => {
      for (let k = 0; k < 3; k++) {
        const edge = table.triangleEdges[tri * 3 + k]
        if (edge < 0 || table.triangles[edge].length !== 2) return false
      }
      return true
    }),
  )
  const volumes = shells.map((members, s) => {
    if (closed[s]) return signedVolume(oriented, members)
    const origin: Vec3 = [0, 0, 0]
    for (const tri of members) {
      for (let k = 0; k < 3; k++) {
        const v = t[tri * 3 + k] * 3
        origin[0] += mesh.positions[v] / (members.length * 3)
        origin[1] += mesh.positions[v + 1] / (members.length * 3)
        origin[2] += mesh.positions[v + 2] / (members.length * 3)
      }
    }
    return signedVolume(oriented, members, origin)
  })
  const depth = new Int32Array(shells.length)
  const closedIds = shells.map((_, s) => s).filter((s) => closed[s])
  if (closedIds.length > 1 && closedIds.length <= 256) {
    for (const s of closedIds) {
      const v = t[shells[s][0] * 3] * 3
      const sample: Vec3 = [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]
      for (const other of closedIds) {
        if (other !== s && pointInsideTriangles(mesh.positions, t, sample, shells[other]))
          depth[s]++
      }
    }
  }
  let invertedShells = 0
  shells.forEach((members, s) => {
    const wantPositive = depth[s] % 2 === 0
    if (volumes[s] === 0 || volumes[s] > 0 === wantPositive) return
    for (const tri of members) flip(tri)
    invertedShells++
  })
  const result: TriMesh = { positions: Float64Array.from(mesh.positions), triangles: t }
  if (mesh.groups?.length) result.groups = mesh.groups.map((group) => ({ ...group }))
  return { mesh: result, flipped, invertedShells, consistent, shells: shells.length }
}

export function fillHoles(
  mesh: TriMesh,
  options: { maxEdges?: number } = {},
): { mesh: TriMesh; filled: number; unfilled: number } {
  const maxEdges = options.maxEdges ?? Infinity
  const loops = boundaryLoops(mesh)
  if (!loops.length) return { mesh, filled: 0, unfilled: 0 }
  const positions = Array.from(mesh.positions)
  const triangles = Array.from(mesh.triangles)
  let filled = 0
  let unfilled = 0
  for (const loop of loops) {
    if (loop.length > maxEdges) {
      unfilled++
      continue
    }
    const patch = fillLoop(positions, loop.slice().reverse())
    if (!patch.length) {
      unfilled++
      continue
    }
    for (const id of patch) triangles.push(id)
    filled++
  }
  return { mesh: createMesh(positions, triangles, mesh.groups), filled, unfilled }
}

export function repairMesh(
  mesh: TriMesh,
  options: RepairOptions = {},
): { mesh: TriMesh; report: RepairReport } {
  const diagonal = boundsDiagonal(meshBounds(mesh))
  const weldTolerance = options.weldTolerance ?? diagonal * 1e-6
  const welded = weldVertices(
    { positions: mesh.positions, triangles: mesh.triangles },
    weldTolerance,
  )
  let current = welded.mesh
  let fixedDegenerateTriangles = 0
  let removedDuplicateTriangles = 0
  if (options.removeDegenerates !== false) {
    const result = removeDegenerateTriangles(
      current,
      Math.max(weldTolerance, defaultLengthTolerance(current)),
    )
    current = result.mesh
    fixedDegenerateTriangles = result.fixed
  }
  if (options.removeDuplicates !== false) {
    const result = removeDuplicateTriangles(current)
    current = result.mesh
    removedDuplicateTriangles = result.removed
  }
  let flippedTriangles = 0
  let invertedShells = 0
  let consistent = true
  if (options.orient !== false) {
    const result = orientMesh(current)
    current = result.mesh
    flippedTriangles = result.flipped
    invertedShells = result.invertedShells
    consistent = result.consistent
  }
  let filledHoles = 0
  let unfilledHoles = 0
  if (options.fillHoles !== false) {
    const result = fillHoles(current, { maxEdges: options.maxHoleEdges ?? 1000 })
    current = result.mesh
    filledHoles = result.filled
    unfilledHoles = result.unfilled
    if (filledHoles && options.orient !== false) {
      const again = orientMesh(current)
      current = again.mesh
      invertedShells += again.invertedShells
      consistent = again.consistent
    }
  }
  current = compactMesh(current)
  const table = buildEdgeTable(current)
  let watertight = current.triangles.length > 0
  let orientedEdges = true
  for (let e = 0; e < table.a.length; e++) {
    if (table.triangles[e].length !== 2) watertight = false
    else if (table.forward[e] !== 1) orientedEdges = false
  }
  return {
    mesh: current,
    report: {
      weldedVertices: welded.merged,
      removedDuplicateTriangles,
      fixedDegenerateTriangles,
      flippedTriangles,
      invertedShells,
      filledHoles,
      unfilledHoles,
      consistentlyOriented: consistent && orientedEdges,
      watertight: watertight && orientedEdges,
    },
  }
}
