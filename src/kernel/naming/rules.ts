import type { Vec3 } from '../../core/math'
import { canonicalAxis } from './axis'
import { ElementMap, type Retirement } from './elementMap'
import { finishLabel, type Label } from './hash'
import { adjacencyOf, indexTopology, shapesOf } from './topology'
import {
  compareStringLists,
  compareStrings,
  ELEMENT_KINDS,
  perKind,
  type ElementKind,
  type Geometry,
  type History,
  type PerKind,
  type ShapeOps,
  type Topology,
} from './types'

export interface ParentRef<S> {
  kind: ElementKind
  shape: S
}

export interface Seed<S> {
  shape: S
  name: string
  full?: string
  kind?: ElementKind
  parent?: ParentRef<S>
}

export interface NamingInput<S> {
  featureId: string
  ops: ShapeOps<S>
  result: Topology<S>
  geometry: Geometry<S>
  inputs?: readonly ElementMap<S>[]
  history?: History<S>
  seeds?: readonly Seed<S>[]
}

const MODIFIED = 0
const GENERATED = 1
const CENTROID_TOLERANCE = 1e-6
const SEPARATOR = '\u0000'

interface Contribution<S> {
  rank: number
  key: string
  label: Label
  aliases: Label[]
  parent?: ParentRef<S>
}

interface Candidate<S> {
  label: Label
  aliases: Label[]
  split: boolean
  parentKey: string
  parent?: ParentRef<S>
}

interface ParentRecord {
  label: Label
  aliases: Label[]
  children: number[]
}

interface Location {
  kind: ElementKind
  index: number
}

function uniqueLabels(labels: readonly Label[]): Label[] {
  const byName = new Map<string, Label>()
  for (const label of labels) if (!byName.has(label.name)) byName.set(label.name, label)
  return [...byName.values()].sort((a, b) => compareStrings(a.name, b.name))
}

function joinLabels(
  labels: readonly Label[],
  separator: string,
  table: Map<string, string>,
  prefix = '',
): Label {
  return finishLabel(
    prefix + labels.map((label) => label.name).join(separator),
    prefix + labels.map((label) => label.full).join(separator),
    table,
  )
}

function compareNumbers(a: number, b: number): number {
  return Math.abs(a - b) <= CENTROID_TOLERANCE ? 0 : a < b ? -1 : 1
}

function compareCentroids(a: Vec3, b: Vec3, axis: Vec3 | null): number {
  if (axis) {
    const along = compareNumbers(
      a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2],
      b[0] * axis[0] + b[1] * axis[1] + b[2] * axis[2],
    )
    if (along !== 0) return along
  }
  return compareNumbers(a[0], b[0]) || compareNumbers(a[1], b[1]) || compareNumbers(a[2], b[2])
}

export function generatedLabel(
  featureId: string,
  parent: Label,
  table: Map<string, string>,
): Label {
  return finishLabel(`${featureId}:gen:${parent.name}`, `${featureId}:gen:${parent.full}`, table)
}

export function buildElementMap<S>(input: NamingInput<S>): ElementMap<S> {
  const { featureId, ops, result, geometry, history } = input
  const inputs = input.inputs ?? []
  const table = new Map<string, string>()
  for (const map of inputs) {
    for (const [name, full] of map.fullNames()) if (!table.has(name)) table.set(name, full)
  }
  const index = indexTopology(ops, result)
  const adjacency = adjacencyOf(result)
  const counts = perKind((kind) => shapesOf(result, kind).length)
  const slots: PerKind<Contribution<S>[][]> = perKind((kind) =>
    Array.from({ length: counts[kind] }, () => []),
  )

  const locate = (shape: S, kind?: ElementKind): Location | undefined => {
    for (const candidate of kind ? [kind] : ELEMENT_KINDS) {
      const found = index[candidate].get(shape)
      if (found !== undefined) return { kind: candidate, index: found }
    }
    return undefined
  }

  const contribute = (at: Location, contribution: Contribution<S>) => {
    const list = slots[at.kind][at.index]
    if (!list.some((existing) => existing.key === contribution.key)) list.push(contribution)
  }

  inputs.forEach((map, m) => {
    for (const kind of ELEMENT_KINDS) {
      for (const element of map.elements(kind)) {
        const label: Label = { name: element.name, full: map.fullName(element.name) }
        const aliases = element.aliases.map((alias) => ({ name: alias, full: map.fullName(alias) }))
        const parent: ParentRef<S> = { kind, shape: element.shape }
        const modified: Contribution<S> = {
          rank: MODIFIED,
          key: `m${m}${SEPARATOR}${element.name}`,
          label,
          aliases,
          parent,
        }
        let generated: Contribution<S> | undefined
        const generatedContribution = (): Contribution<S> => {
          if (!generated) {
            const name = generatedLabel(featureId, label, table)
            generated = {
              rank: GENERATED,
              key: `g${m}${SEPARATOR}${name.name}`,
              label: name,
              aliases: [],
              parent,
            }
          }
          return generated
        }
        const kept = index[kind].get(element.shape)
        if (kept !== undefined) contribute({ kind, index: kept }, modified)
        if (!history) continue
        if (!history.isDeleted(element.shape)) {
          for (const shape of history.modified(element.shape)) {
            const at = locate(shape, kind)
            if (!at || at.index === kept) continue
            contribute(at, kept === undefined ? modified : generatedContribution())
          }
        }
        for (const shape of history.generated(element.shape)) {
          const at = locate(shape)
          if (!at || (at.kind === kind && at.index === kept)) continue
          contribute(at, generatedContribution())
        }
      }
    }
  })

  for (const seed of input.seeds ?? []) {
    const at = locate(seed.shape, seed.kind)
    if (!at) continue
    const label = finishLabel(seed.name, seed.full ?? seed.name, table)
    contribute(at, {
      rank: MODIFIED,
      key: `s${SEPARATOR}${label.name}`,
      label,
      aliases: [],
      parent: seed.parent,
    })
  }

  const effective = perKind((kind) =>
    slots[kind].map((list) => {
      if (list.length === 0) return list
      const best = Math.min(...list.map((contribution) => contribution.rank))
      return list
        .filter((contribution) => contribution.rank === best)
        .sort((a, b) => compareStrings(a.key, b.key))
    }),
  )

  const parents = perKind(() => new Map<string, ParentRecord>())
  for (const kind of ELEMENT_KINDS) {
    effective[kind].forEach((list, child) => {
      for (const contribution of list) {
        const record = parents[kind].get(contribution.key)
        if (record) record.children.push(child)
        else {
          parents[kind].set(contribution.key, {
            label: contribution.label,
            aliases: contribution.aliases,
            children: [child],
          })
        }
      }
    })
  }

  const candidates = perKind((kind) =>
    effective[kind].map((list): Candidate<S> | null => {
      if (list.length === 0) return null
      const fanOut = (contribution: Contribution<S>) =>
        parents[kind].get(contribution.key)?.children.length ?? 0
      const labels = uniqueLabels(list.map((contribution) => contribution.label))
      const first = list[0]
      if (labels.length === 1) {
        const split = list.some((contribution) => fanOut(contribution) > 1)
        return {
          label: labels[0],
          aliases: split ? [] : list.flatMap((contribution) => contribution.aliases),
          split,
          parentKey: first.key,
          parent: first.parent,
        }
      }
      return {
        label: joinLabels(labels, '|', table),
        aliases: list
          .filter((contribution) => fanOut(contribution) === 1)
          .flatMap((contribution) => [contribution.label, ...contribution.aliases]),
        split: false,
        parentKey: first.key,
        parent: first.parent,
      }
    }),
  )

  const finals: PerKind<Label[]> = perKind((kind) => new Array<Label>(counts[kind]))
  const finalAliases: PerKind<Label[][]> = perKind((kind) =>
    Array.from({ length: counts[kind] }, () => []),
  )
  const chosen: PerKind<Candidate<S>[]> = perKind(() => [])

  const candidateName = (kind: ElementKind, i: number) => candidates[kind][i]?.label.name

  const neighbourKey = (kind: ElementKind, i: number): string[] => {
    const keys = new Set<string>()
    const add = (prefix: string, name: string | undefined) => {
      if (name !== undefined) keys.add(prefix + name)
    }
    if (kind === 'face') {
      for (const j of adjacency.faceFaces[i]) add('f:', candidateName('face', j))
      for (const j of adjacency.faceEdges[i]) add('e:', candidateName('edge', j))
    } else if (kind === 'edge') {
      for (const j of adjacency.edgeFaces[i]) add('f:', finals.face[j].name)
      for (const j of adjacency.edgeVertices[i]) add('v:', candidateName('vertex', j))
    } else {
      for (const j of adjacency.vertexEdges[i]) add('e:', finals.edge[j].name)
    }
    return [...keys].sort(compareStrings)
  }

  const orderMembers = (kind: ElementKind, members: readonly number[]): number[] => {
    const shapes = shapesOf(result, kind)
    const anchor = members
      .map((member) => chosen[kind][member])
      .filter((candidate) => candidate.parent)
      .sort((a, b) => compareStrings(a.parentKey, b.parentKey))[0]
    let axis: Vec3 | null | undefined
    const axisOf = (): Vec3 | null => {
      if (axis === undefined) {
        axis = anchor?.parent
          ? canonicalAxis(geometry.principalAxis(anchor.parent.kind, anchor.parent.shape))
          : null
      }
      return axis
    }
    const keys = new Map(members.map((member) => [member, neighbourKey(kind, member)]))
    const centroids = new Map<number, Vec3>()
    const centroidOf = (member: number): Vec3 => {
      let centroid = centroids.get(member)
      if (!centroid) {
        centroid = geometry.centroid(kind, shapes[member])
        centroids.set(member, centroid)
      }
      return centroid
    }
    return [...members].sort(
      (a, b) =>
        compareStringLists(keys.get(a)!, keys.get(b)!) ||
        compareCentroids(centroidOf(a), centroidOf(b), axisOf()) ||
        a - b,
    )
  }

  const fallback = (kind: ElementKind, i: number): Candidate<S> => {
    const head = `${featureId}:${kind}`
    const around =
      kind === 'face'
        ? []
        : kind === 'edge'
          ? adjacency.edgeFaces[i].map((j) => finals.face[j])
          : adjacency.vertexEdges[i].map((j) => finals.edge[j])
    const labels = uniqueLabels(around)
    const label = labels.length
      ? joinLabels(labels, '&', table, `${head}:`)
      : finishLabel(head, head, table)
    return { label, aliases: [], split: false, parentKey: '' }
  }

  const groupByName = (labels: readonly Label[]): Map<string, number[]> => {
    const groups = new Map<string, number[]>()
    labels.forEach((label, i) => {
      const group = groups.get(label.name)
      if (group) group.push(i)
      else groups.set(label.name, [i])
    })
    return groups
  }

  for (const kind of ELEMENT_KINDS) {
    for (let i = 0; i < counts[kind]; i++)
      chosen[kind].push(candidates[kind][i] ?? fallback(kind, i))
    for (const members of groupByName(chosen[kind].map((candidate) => candidate.label)).values()) {
      const split = members.length > 1 || members.some((member) => chosen[kind][member].split)
      if (!split) {
        finals[kind][members[0]] = chosen[kind][members[0]].label
        finalAliases[kind][members[0]] = chosen[kind][members[0]].aliases
        continue
      }
      orderMembers(kind, members).forEach((member, k) => {
        const base = chosen[kind][member].label
        finals[kind][member] = finishLabel(`${base.name}#${k + 1}`, `${base.full}#${k + 1}`, table)
      })
    }
    let unique = false
    for (let round = 0; round < 8 && !unique; round++) {
      const clashes = [...groupByName(finals[kind]).values()].filter((group) => group.length > 1)
      unique = clashes.length === 0
      for (const members of clashes) {
        orderMembers(kind, members).forEach((member, k) => {
          const base = finals[kind][member]
          finals[kind][member] = finishLabel(
            `${base.name}#${k + 1}`,
            `${base.full}#${k + 1}`,
            table,
          )
          finalAliases[kind][member] = []
        })
      }
    }
    if (!unique) throw new Error(`Could not give every ${kind} of ${featureId} a unique name`)
  }

  const retired = perKind(() => new Map<string, Retirement>())
  for (const map of inputs) {
    for (const kind of ELEMENT_KINDS) {
      for (const [name, retirement] of map.retired(kind)) {
        if (!retired[kind].has(name)) retired[kind].set(name, retirement)
      }
    }
  }
  for (const kind of ELEMENT_KINDS) {
    for (const record of parents[kind].values()) {
      if (record.children.length < 2) continue
      const children = record.children.map((child) => finals[kind][child].name).sort(compareStrings)
      for (const label of [record.label, ...record.aliases]) {
        retired[kind].set(label.name, { reason: 'split', featureId, full: label.full, children })
      }
    }
  }
  inputs.forEach((map, m) => {
    for (const kind of ELEMENT_KINDS) {
      for (const element of map.elements(kind)) {
        if (parents[kind].has(`m${m}${SEPARATOR}${element.name}`)) continue
        for (const name of [element.name, ...element.aliases]) {
          retired[kind].set(name, { reason: 'deleted', featureId, full: map.fullName(name) })
        }
      }
    }
  })

  return new ElementMap({
    featureId,
    ops,
    topology: result,
    names: perKind((kind) => finals[kind].map((label) => label.name)),
    aliases: perKind((kind) =>
      finalAliases[kind].map((labels) => labels.map((label) => label.name)),
    ),
    retired,
    fullNames: table,
  })
}
