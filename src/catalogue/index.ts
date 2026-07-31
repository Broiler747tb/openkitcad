/**
 * Catalogue loader.
 *
 * Parts live as one JSON file each under `parts/`, so adding one is a single
 * self-contained pull request that needs no build knowledge. Vite inlines them
 * at build time, which keeps the app a static site with no catalogue server.
 */
import type { CataloguePart, PartCategory } from './types'
import { CATEGORY_LABEL } from './types'

const modules = import.meta.glob<{ default: CataloguePart }>('./parts/*.json', {
  eager: true,
})

export const CATALOGUE: CataloguePart[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name))

const byId = new Map(CATALOGUE.map((p) => [p.id, p]))

export function getPart(id: string): CataloguePart | undefined {
  return byId.get(id)
}

/** Simple substring search over name, summary and tags. */
export function searchParts(query: string): CataloguePart[] {
  const q = query.trim().toLowerCase()
  if (!q) return CATALOGUE
  const terms = q.split(/\s+/)
  return CATALOGUE.filter((p) => {
    const hay = [p.name, p.summary, p.manufacturer ?? '', ...(p.tags ?? [])]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

export function groupedCatalogue(
  parts: CataloguePart[] = CATALOGUE,
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
