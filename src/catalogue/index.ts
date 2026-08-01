/**
 * Catalogue loader.
 *
 * Parts live as one JSON file each under `parts/`, so adding one is a single
 * self-contained pull request that needs no build knowledge. Vite inlines them
 * at build time, which keeps the app a static site with no catalogue server.
 */
import type { CataloguePart, PartCategory } from './types'
import { CATEGORY_LABEL } from './types'
import { loadUserParts } from './userParts'

const modules = import.meta.glob<{ default: CataloguePart }>('./parts/*.json', {
  eager: true,
})

export const CATALOGUE: CataloguePart[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * Parts the user measured themselves, cached because these are looked up inside
 * loops that run on every rebuild. Cleared whenever one is added or removed.
 */
let userCache: CataloguePart[] | null = null

/**
 * Parts handed in rather than read from storage.
 *
 * The kernel runs in a worker, and a worker has no localStorage - so a part the
 * user measured is invisible to it unless it is sent across with the document.
 * The worker sets these at the start of every evaluation; the main thread
 * leaves them null and reads storage as normal.
 */
let injected: CataloguePart[] | null = null

export function setCustomParts(parts: CataloguePart[]): void {
  injected = parts
  userCache = null
}

export function userParts(): CataloguePart[] {
  if (injected) return injected
  if (!userCache) userCache = loadUserParts()
  return userCache
}

/** Call after adding or removing one, so the next lookup sees it. */
export function refreshUserParts(): void {
  userCache = null
}

/** Whether a part came from the user rather than the repo, for labelling. */
export function isUserPart(id: string): boolean {
  return userParts().some((p) => p.id === id)
}

/**
 * Everything available to place: the shipped catalogue plus anything the user
 * has built. Theirs come first, since a part someone measured this afternoon is
 * the one they are looking for.
 */
export function allParts(): CataloguePart[] {
  const mine = userParts()
  if (!mine.length) return CATALOGUE
  // A user part with the same id as a shipped one wins: that is how someone
  // fixes a measurement they think is wrong without waiting for a release.
  const overridden = new Set(mine.map((p) => p.id))
  return [...mine, ...CATALOGUE.filter((p) => !overridden.has(p.id))]
}

const byId = new Map(CATALOGUE.map((p) => [p.id, p]))

export function getPart(id: string): CataloguePart | undefined {
  return userParts().find((p) => p.id === id) ?? byId.get(id)
}

/** Simple substring search over name, summary and tags. */
export function searchParts(query: string): CataloguePart[] {
  const q = query.trim().toLowerCase()
  if (!q) return allParts()
  const terms = q.split(/\s+/)
  return allParts().filter((p) => {
    const hay = [p.name, p.summary, p.manufacturer ?? '', ...(p.tags ?? [])]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

export function groupedCatalogue(
  parts: CataloguePart[] = allParts(),
): Array<{ category: PartCategory; label: string; parts: CataloguePart[] }> {
  const groups = new Map<PartCategory, CataloguePart[]>()
  for (const p of parts) {
    const list = groups.get(p.category) ?? []
    list.push(p)
    groups.set(p.category, list)
  }
  // Ordered by how often a tinkerer starts from one. Almost every project
  // begins with a board, and the thing they reach for next is a socket.
  const order: PartCategory[] = [
    'sbc',
    'mcu',
    'connector',
    'display',
    'sensor',
    'power',
    'fastener',
    'extrusion',
    'motor',
    'motion',
  ]
  return order
    .filter((c) => groups.has(c))
    .map((c) => ({ category: c, label: CATEGORY_LABEL[c], parts: groups.get(c)! }))
}

export * from './types'
export * from './userParts'
