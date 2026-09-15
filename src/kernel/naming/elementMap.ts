import { ShapeIndex } from './shapeIndex'
import { shapesOf, topologyShapes } from './topology'
import {
  compareStrings,
  perKind,
  type ElementKind,
  type PerKind,
  type ShapeOps,
  type Topology,
} from './types'

export interface NamedElement<S> {
  readonly kind: ElementKind
  readonly index: number
  readonly shape: S
  readonly name: string
  readonly aliases: readonly string[]
}

export type Retirement =
  | { reason: 'deleted'; featureId: string; full: string }
  | { reason: 'split'; featureId: string; full: string; children: readonly string[] }

export interface ElementMapInit<S> {
  featureId: string
  ops: ShapeOps<S>
  topology: Topology<S>
  names: PerKind<readonly string[]>
  aliases?: Partial<PerKind<readonly (readonly string[])[]>>
  retired?: Partial<PerKind<ReadonlyMap<string, Retirement>>>
  fullNames?: ReadonlyMap<string, string>
}

export class ElementMap<S> {
  readonly featureId: string
  readonly topology: Topology<S>
  readonly ops: ShapeOps<S>
  private readonly lists: PerKind<NamedElement<S>[]>
  private readonly byName: PerKind<Map<string, NamedElement<S>>>
  private readonly byAlias: PerKind<Map<string, NamedElement<S>[]>>
  private readonly byShape: PerKind<ShapeIndex<S, NamedElement<S>>>
  private readonly retiredNames: PerKind<Map<string, Retirement>>
  private readonly full: Map<string, string>

  constructor(init: ElementMapInit<S>) {
    this.featureId = init.featureId
    this.topology = init.topology
    this.ops = init.ops
    this.full = new Map(init.fullNames ?? [])
    this.byName = perKind(() => new Map())
    this.byAlias = perKind(() => new Map())
    this.byShape = perKind(() => new ShapeIndex<S, NamedElement<S>>(init.ops))
    this.lists = perKind((kind) => {
      const shapes = shapesOf(init.topology, kind)
      const names = init.names[kind]
      if (names.length !== shapes.length) {
        throw new Error(`${names.length} ${kind} names for ${shapes.length} ${kind}s`)
      }
      return shapes.map((shape, index) => {
        const name = names[index]
        const aliases = [...new Set(init.aliases?.[kind]?.[index] ?? [])]
          .filter((alias) => alias !== name)
          .sort(compareStrings)
        const element: NamedElement<S> = { kind, index, shape, name, aliases }
        if (this.byName[kind].has(name)) throw new Error(`Two ${kind}s are both named ${name}`)
        this.byName[kind].set(name, element)
        if (!this.byShape[kind].set(shape, element)) {
          throw new Error(`The same ${kind} appears twice in one element map`)
        }
        for (const alias of aliases) {
          const holders = this.byAlias[kind].get(alias)
          if (holders) holders.push(element)
          else this.byAlias[kind].set(alias, [element])
        }
        return element
      })
    })
    this.retiredNames = perKind((kind) => {
      const retired = new Map<string, Retirement>()
      for (const [name, retirement] of init.retired?.[kind] ?? []) {
        if (!this.byName[kind].has(name) && !this.byAlias[kind].has(name)) {
          retired.set(name, retirement)
        }
      }
      return retired
    })
  }

  elements(kind: ElementKind): readonly NamedElement<S>[] {
    return this.lists[kind]
  }

  names(kind: ElementKind): string[] {
    return this.lists[kind].map((element) => element.name)
  }

  get(kind: ElementKind, name: string): NamedElement<S> | undefined {
    return this.byName[kind].get(name)
  }

  aliased(kind: ElementKind, name: string): readonly NamedElement<S>[] {
    return this.byAlias[kind].get(name) ?? []
  }

  elementOf(kind: ElementKind, shape: S): NamedElement<S> | undefined {
    return this.byShape[kind].get(shape)
  }

  nameOf(kind: ElementKind, shape: S): string | undefined {
    return this.byShape[kind].get(shape)?.name
  }

  retirement(kind: ElementKind, name: string): Retirement | undefined {
    return this.retiredNames[kind].get(name)
  }

  retired(kind: ElementKind): ReadonlyMap<string, Retirement> {
    return this.retiredNames[kind]
  }

  fullName(name: string): string {
    return this.full.get(name) ?? name
  }

  fullNames(): ReadonlyMap<string, string> {
    return this.full
  }

  dispose(): void {
    if (!this.ops.dispose) return
    for (const shape of topologyShapes(this.topology)) this.ops.dispose(shape)
  }
}
