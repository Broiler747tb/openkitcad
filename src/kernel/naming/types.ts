import type { Vec3 } from '../../core/math'

export type ElementKind = 'face' | 'edge' | 'vertex'

export const ELEMENT_KINDS: readonly ElementKind[] = ['face', 'edge', 'vertex']

export interface ElementReference {
  bodyId: string
  kind: ElementKind
  name: string
}

export interface ShapeOps<S> {
  hash(shape: S): number
  same(a: S, b: S): boolean
  dispose?(shape: S): void
}

export interface History<S> {
  modified(shape: S): S[]
  generated(shape: S): S[]
  isDeleted(shape: S): boolean
}

export interface SweepHistory<S> extends History<S> {
  first(shape: S): S | null
  last(shape: S): S | null
}

export interface Topology<S> {
  faces: S[]
  edges: S[]
  vertices: S[]
  faceEdges: number[][]
  edgeVertices: number[][]
}

export interface Geometry<S> {
  centroid(kind: ElementKind, shape: S): Vec3
  principalAxis(kind: ElementKind, shape: S): Vec3 | null
}

export type PerKind<T> = Record<ElementKind, T>

export function perKind<T>(make: (kind: ElementKind) => T): PerKind<T> {
  return { face: make('face'), edge: make('edge'), vertex: make('vertex') }
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function compareStringLists(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const order = compareStrings(a[i], b[i])
    if (order !== 0) return order
  }
  return a.length - b.length
}
