import { boundaryVertices, vertexNeighbours } from './topology'
import { cloneMesh, type TriMesh } from './types'

export interface SmoothOptions {
  iterations?: number
  strength?: number
  preserveBoundary?: boolean
}

export function smoothMesh(mesh: TriMesh, options: SmoothOptions = {}): TriMesh {
  const result = cloneMesh(mesh)
  const lambda = Math.min(0.9, Math.max(0, options.strength ?? 0.5))
  const iterations = Math.max(0, Math.round(options.iterations ?? 3))
  if (!lambda || !iterations) return result
  const mu = 1 / (0.1 - 1 / lambda)
  const neighbours = vertexNeighbours(result)
  const fixed = options.preserveBoundary === false ? null : boundaryVertices(result)
  const p = result.positions
  const count = p.length / 3
  const delta = new Float64Array(p.length)
  const pass = (factor: number) => {
    for (let v = 0; v < count; v++) {
      const ring = neighbours[v]
      if (!ring.length || fixed?.[v]) {
        delta[v * 3] = delta[v * 3 + 1] = delta[v * 3 + 2] = 0
        continue
      }
      let x = 0
      let y = 0
      let z = 0
      for (const w of ring) {
        x += p[w * 3]
        y += p[w * 3 + 1]
        z += p[w * 3 + 2]
      }
      delta[v * 3] = factor * (x / ring.length - p[v * 3])
      delta[v * 3 + 1] = factor * (y / ring.length - p[v * 3 + 1])
      delta[v * 3 + 2] = factor * (z / ring.length - p[v * 3 + 2])
    }
    for (let i = 0; i < p.length; i++) p[i] += delta[i]
  }
  for (let i = 0; i < iterations; i++) {
    pass(lambda)
    pass(mu)
  }
  return result
}
