import type { ElementMap, NamedElement } from './elementMap'
import { compareStrings, type ElementKind, type ElementReference } from './types'

export type ResolveError =
  | { code: 'body-missing'; reference: ElementReference; message: string }
  | { code: 'missing'; reference: ElementReference; message: string }
  | {
      code: 'ambiguous'
      reference: ElementReference
      candidates: string[]
      featureId?: string
      message: string
    }
  | { code: 'deleted'; reference: ElementReference; featureId: string; message: string }

export type Resolution<S> =
  { ok: true; element: NamedElement<S>; via: 'name' | 'alias' } | { ok: false; error: ResolveError }

export class NamingError extends Error {
  readonly error: ResolveError

  constructor(error: ResolveError) {
    super(error.message)
    this.name = 'NamingError'
    this.error = error
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function quoted(text: string): string {
  return `"${text}"`
}

export function resolveElement<S>(
  map: ElementMap<S> | undefined,
  reference: ElementReference,
): Resolution<S> {
  const { bodyId, kind, name } = reference
  if (!map) {
    return {
      ok: false,
      error: {
        code: 'body-missing',
        reference,
        message: `Body ${bodyId} does not exist at this point in the timeline.`,
      },
    }
  }
  const own = map.get(kind, name)
  if (own) return { ok: true, element: own, via: 'name' }
  const listed = (names: readonly string[]) =>
    names.map((candidate) => quoted(map.fullName(candidate))).join(', ')
  const holders = map.aliased(kind, name)
  if (holders.length === 1) return { ok: true, element: holders[0], via: 'alias' }
  if (holders.length > 1) {
    const candidates = holders.map((holder) => holder.name).sort(compareStrings)
    return {
      ok: false,
      error: {
        code: 'ambiguous',
        reference,
        candidates,
        message: `The ${kind} ${quoted(map.fullName(name))} on body ${bodyId} is now part of ${plural(candidates.length, kind)}: ${listed(candidates)}.`,
      },
    }
  }
  const retirement = map.retirement(kind, name)
  if (retirement?.reason === 'split') {
    const candidates = [...retirement.children]
    return {
      ok: false,
      error: {
        code: 'ambiguous',
        reference,
        candidates,
        featureId: retirement.featureId,
        message: `Feature ${retirement.featureId} split the ${kind} ${quoted(retirement.full)} on body ${bodyId} into ${plural(candidates.length, 'piece')}: ${listed(candidates)}.`,
      },
    }
  }
  if (retirement?.reason === 'deleted') {
    return {
      ok: false,
      error: {
        code: 'deleted',
        reference,
        featureId: retirement.featureId,
        message: `Feature ${retirement.featureId} removed the ${kind} ${quoted(retirement.full)} from body ${bodyId}.`,
      },
    }
  }
  return {
    ok: false,
    error: {
      code: 'missing',
      reference,
      message: `Body ${bodyId} has no ${kind} named ${quoted(map.fullName(name))}.`,
    },
  }
}

export function resolveElements<S>(
  map: ElementMap<S> | undefined,
  bodyId: string,
  kind: ElementKind,
  names: readonly string[] | 'all',
): NamedElement<S>[] {
  if (names === 'all') {
    if (map) return [...map.elements(kind)]
    const missing = resolveElement(map, { bodyId, kind, name: '' })
    if (!missing.ok) throw new NamingError(missing.error)
    return []
  }
  return names.map((name) => {
    const resolution = resolveElement(map, { bodyId, kind, name })
    if (!resolution.ok) throw new NamingError(resolution.error)
    return resolution.element
  })
}
