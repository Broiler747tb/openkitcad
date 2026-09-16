import { compactMesh, type TriMesh, type Vec3 } from './types'

export class EditMesh {
  positions: number[]
  corners: number[] = []
  alive: number[] = []
  tags: number[] = []
  incident: number[][]
  liveTriangles = 0

  constructor(
    positions: ArrayLike<number>,
    triangles: ArrayLike<number>,
    tags?: ArrayLike<number>,
  ) {
    this.positions = Array.from(positions)
    this.incident = Array.from({ length: this.positions.length / 3 }, () => [])
    for (let i = 0; i < triangles.length; i += 3) {
      this.addTriangle(triangles[i], triangles[i + 1], triangles[i + 2], tags ? tags[i / 3] : 0)
    }
  }

  static from(mesh: TriMesh, tags?: ArrayLike<number>): EditMesh {
    return new EditMesh(mesh.positions, mesh.triangles, tags)
  }

  get vertexCount(): number {
    return this.positions.length / 3
  }

  point(v: number): Vec3 {
    return [this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]]
  }

  setPoint(v: number, p: Vec3) {
    this.positions[v * 3] = p[0]
    this.positions[v * 3 + 1] = p[1]
    this.positions[v * 3 + 2] = p[2]
  }

  addVertex(p: Vec3): number {
    const id = this.positions.length / 3
    this.positions.push(p[0], p[1], p[2])
    this.incident.push([])
    return id
  }

  addTriangle(a: number, b: number, c: number, tag = 0): number {
    const t = this.alive.length
    this.corners.push(a, b, c)
    this.alive.push(1)
    this.tags.push(tag)
    this.incident[a].push(t)
    if (b !== a) this.incident[b].push(t)
    if (c !== a && c !== b) this.incident[c].push(t)
    this.liveTriangles++
    return t
  }

  removeTriangle(t: number) {
    if (!this.alive[t]) return
    this.alive[t] = 0
    this.liveTriangles--
    const [a, b, c] = this.triangle(t)
    for (const v of a === b ? (b === c ? [a] : [a, c]) : c === a || c === b ? [a, b] : [a, b, c]) {
      const list = this.incident[v]
      const index = list.indexOf(t)
      if (index >= 0) list.splice(index, 1)
    }
  }

  triangle(t: number): [number, number, number] {
    return [this.corners[t * 3], this.corners[t * 3 + 1], this.corners[t * 3 + 2]]
  }

  hasVertex(t: number, v: number): boolean {
    return (
      this.corners[t * 3] === v || this.corners[t * 3 + 1] === v || this.corners[t * 3 + 2] === v
    )
  }

  edgeTriangles(u: number, v: number): number[] {
    return this.incident[u].filter((t) => this.hasVertex(t, v))
  }

  opposite(t: number, u: number, v: number): number {
    for (let k = 0; k < 3; k++) {
      const w = this.corners[t * 3 + k]
      if (w !== u && w !== v) return w
    }
    return -1
  }

  oriented(t: number, u: number, v: number): [number, number, number] | null {
    const base = t * 3
    for (let k = 0; k < 3; k++) {
      const a = this.corners[base + k]
      const b = this.corners[base + ((k + 1) % 3)]
      if ((a === u && b === v) || (a === v && b === u))
        return [a, b, this.corners[base + ((k + 2) % 3)]]
    }
    return null
  }

  ring(v: number): number[] {
    const result: number[] = []
    for (const t of this.incident[v]) {
      for (let k = 0; k < 3; k++) {
        const w = this.corners[t * 3 + k]
        if (w !== v && !result.includes(w)) result.push(w)
      }
    }
    return result
  }

  isBoundaryVertex(v: number): boolean {
    for (const w of this.ring(v)) if (this.edgeTriangles(v, w).length !== 2) return true
    return false
  }

  findTriangle(a: number, b: number, c: number, except = -1): number {
    for (const t of this.incident[a]) {
      if (t !== except && this.hasVertex(t, b) && this.hasVertex(t, c)) return t
    }
    return -1
  }

  canCollapse(keep: number, drop: number): boolean {
    if (keep === drop) return false
    const shared = this.edgeTriangles(keep, drop)
    if (shared.length === 0 || shared.length > 2) return false
    const opposite = shared.map((t) => this.opposite(t, keep, drop))
    const dropRing = this.ring(drop)
    for (const w of this.ring(keep)) {
      if (w !== drop && dropRing.includes(w) && !opposite.includes(w)) return false
    }
    if (shared.length === 2 && this.isBoundaryVertex(keep) && this.isBoundaryVertex(drop))
      return false
    for (const t of this.incident[drop]) {
      if (shared.includes(t)) continue
      const [a, b, c] = this.triangle(t).map((w) => (w === drop ? keep : w))
      if (a === b || b === c || a === c) return false
      if (this.findTriangle(a, b, c, t) >= 0) return false
    }
    return true
  }

  collapseFoldsOver(keep: number, drop: number, p: Vec3, minCos = 0.2): boolean {
    const seen = new Set<number>()
    for (const t of [...this.incident[keep], ...this.incident[drop]]) {
      if (seen.has(t)) continue
      seen.add(t)
      if (this.hasVertex(t, keep) && this.hasVertex(t, drop)) continue
      const before = this.triangle(t).map((w) => this.point(w))
      const after = this.triangle(t).map((w) => (w === keep || w === drop ? p : this.point(w)))
      const n0 = crossOf(before[0], before[1], before[2])
      const n1 = crossOf(after[0], after[1], after[2])
      const l0 = Math.hypot(n0[0], n0[1], n0[2])
      const l1 = Math.hypot(n1[0], n1[1], n1[2])
      if (l0 === 0) continue
      if (l1 <= l0 * 1e-9) return true
      if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < minCos * l0 * l1) return true
    }
    return false
  }

  collapse(keep: number, drop: number, p: Vec3) {
    for (const t of this.incident[drop].slice()) {
      if (this.hasVertex(t, keep)) {
        this.removeTriangle(t)
        continue
      }
      for (let k = 0; k < 3; k++)
        if (this.corners[t * 3 + k] === drop) this.corners[t * 3 + k] = keep
      this.incident[keep].push(t)
    }
    this.incident[drop] = []
    this.setPoint(keep, p)
  }

  split(u: number, v: number, p: Vec3): number {
    const m = this.addVertex(p)
    for (const t of this.edgeTriangles(u, v)) {
      const o = this.oriented(t, u, v)!
      const tag = this.tags[t]
      this.removeTriangle(t)
      this.addTriangle(o[0], m, o[2], tag)
      this.addTriangle(m, o[1], o[2], tag)
    }
    return m
  }

  flipCandidates(
    u: number,
    v: number,
  ): {
    first: [number, number, number]
    second: [number, number, number]
    triangles: number[]
  } | null {
    const triangles = this.edgeTriangles(u, v)
    if (triangles.length !== 2) return null
    const first = this.oriented(triangles[0], u, v)
    const second = this.oriented(triangles[1], u, v)
    if (!first || !second) return null
    if (first[0] !== second[1] || first[1] !== second[0]) return null
    if (first[2] === second[2]) return null
    if (this.edgeTriangles(first[2], second[2]).length) return null
    return { first, second, triangles }
  }

  flip(u: number, v: number): boolean {
    const candidate = this.flipCandidates(u, v)
    if (!candidate) return false
    const { first, second, triangles } = candidate
    const tag0 = this.tags[triangles[0]]
    const tag1 = this.tags[triangles[1]]
    this.removeTriangle(triangles[0])
    this.removeTriangle(triangles[1])
    this.addTriangle(first[0], second[2], first[2], tag0)
    this.addTriangle(second[2], first[1], first[2], tag1)
    return true
  }

  liveTriangleIds(): number[] {
    const ids: number[] = []
    for (let t = 0; t < this.alive.length; t++) if (this.alive[t]) ids.push(t)
    return ids
  }

  toMeshWithTags(): { mesh: TriMesh; tags: number[] } {
    const triangles: number[] = []
    const tags: number[] = []
    for (let t = 0; t < this.alive.length; t++) {
      if (!this.alive[t]) continue
      triangles.push(this.corners[t * 3], this.corners[t * 3 + 1], this.corners[t * 3 + 2])
      tags.push(this.tags[t])
    }
    const mesh = compactMesh({
      positions: Float64Array.from(this.positions),
      triangles: Uint32Array.from(triangles),
    })
    return { mesh, tags }
  }

  toMesh(): TriMesh {
    return this.toMeshWithTags().mesh
  }
}

export function crossOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}
