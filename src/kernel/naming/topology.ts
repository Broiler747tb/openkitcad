import { ShapeIndex } from './shapeIndex'
import {
  ELEMENT_KINDS,
  perKind,
  type ElementKind,
  type PerKind,
  type ShapeOps,
  type Topology,
} from './types'

export interface Adjacency {
  faceEdges: number[][]
  edgeVertices: number[][]
  edgeFaces: number[][]
  vertexEdges: number[][]
  faceFaces: number[][]
}

export function shapesOf<S>(topology: Topology<S>, kind: ElementKind): S[] {
  if (kind === 'face') return topology.faces
  if (kind === 'edge') return topology.edges
  return topology.vertices
}

export function adjacencyOf<S>(topology: Topology<S>): Adjacency {
  const edgeFaces = topology.edges.map(() => [] as number[])
  topology.faceEdges.forEach((edges, face) => {
    for (const edge of edges) if (!edgeFaces[edge].includes(face)) edgeFaces[edge].push(face)
  })
  const vertexEdges = topology.vertices.map(() => [] as number[])
  topology.edgeVertices.forEach((vertices, edge) => {
    for (const vertex of vertices) {
      if (!vertexEdges[vertex].includes(edge)) vertexEdges[vertex].push(edge)
    }
  })
  const faceFaces = topology.faces.map((_, face) => {
    const neighbours = new Set<number>()
    for (const edge of topology.faceEdges[face]) {
      for (const other of edgeFaces[edge]) if (other !== face) neighbours.add(other)
    }
    return [...neighbours]
  })
  return {
    faceEdges: topology.faceEdges,
    edgeVertices: topology.edgeVertices,
    edgeFaces,
    vertexEdges,
    faceFaces,
  }
}

export function indexTopology<S>(
  ops: ShapeOps<S>,
  topology: Topology<S>,
): PerKind<ShapeIndex<S, number>> {
  return perKind((kind) => {
    const index = new ShapeIndex<S, number>(ops)
    shapesOf(topology, kind).forEach((shape, i) => {
      if (!index.set(shape, i)) throw new Error(`The same ${kind} appears twice in one topology`)
    })
    return index
  })
}

export function topologyShapes<S>(topology: Topology<S>): S[] {
  return ELEMENT_KINDS.flatMap((kind) => shapesOf(topology, kind))
}
