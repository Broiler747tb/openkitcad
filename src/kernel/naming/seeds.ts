import type { ParentRef, Seed } from './rules'
import type { ElementKind, History, SweepHistory } from './types'

export interface TokenedShape<S> {
  shape: S
  token: string
}

export interface ProfileNames<S> {
  shape: S
  faces: readonly S[]
  edges: readonly TokenedShape<S>[]
  vertices: readonly TokenedShape<S>[]
}

export interface RoledShape<S> {
  shape: S
  role: string
}

function seed<S>(
  shape: S | null,
  name: string,
  kind: ElementKind,
  parent?: ParentRef<S>,
): Seed<S>[] {
  return shape === null ? [] : [{ shape, name, kind, parent }]
}

export function sectionSeeds<S>(
  featureId: string,
  profile: ProfileNames<S>,
  history: History<S>,
): Seed<S>[] {
  const seeds: Seed<S>[] = []
  for (const { shape, token } of profile.edges) {
    for (const face of history.generated(shape)) {
      seeds.push(...seed(face, `${featureId}:side:${token}`, 'face', { kind: 'edge', shape }))
    }
  }
  for (const { shape, token } of profile.vertices) {
    for (const edge of history.generated(shape)) {
      seeds.push(...seed(edge, `${featureId}:side:${token}`, 'edge', { kind: 'vertex', shape }))
    }
  }
  return seeds
}

export function sweepSeeds<S>(
  featureId: string,
  profile: ProfileNames<S>,
  history: SweepHistory<S>,
): Seed<S>[] {
  const seeds = sectionSeeds(featureId, profile, history)
  for (const face of profile.faces) {
    const parent: ParentRef<S> = { kind: 'face', shape: face }
    seeds.push(...seed(history.first(face), `${featureId}:start`, 'face', parent))
    seeds.push(...seed(history.last(face), `${featureId}:end`, 'face', parent))
  }
  for (const { shape, token } of profile.edges) {
    const parent: ParentRef<S> = { kind: 'edge', shape }
    seeds.push(...seed(history.first(shape), `${featureId}:start:${token}`, 'edge', parent))
    seeds.push(...seed(history.last(shape), `${featureId}:end:${token}`, 'edge', parent))
  }
  for (const { shape, token } of profile.vertices) {
    seeds.push(...seed(history.first(shape), `${featureId}:start:${token}`, 'vertex'))
    seeds.push(...seed(history.last(shape), `${featureId}:end:${token}`, 'vertex'))
  }
  return seeds
}

export function capSeeds<S>(featureId: string, first: readonly S[], last: readonly S[]): Seed<S>[] {
  return [
    ...first.map((shape) => ({ shape, name: `${featureId}:start`, kind: 'face' as const })),
    ...last.map((shape) => ({ shape, name: `${featureId}:end`, kind: 'face' as const })),
  ]
}

export function roleSeeds<S>(featureId: string, faces: readonly RoledShape<S>[]): Seed<S>[] {
  return faces.map(({ shape, role }) => ({
    shape,
    name: `${featureId}:${role}`,
    kind: 'face' as const,
  }))
}
