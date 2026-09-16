import familyData from './families.json'
import { CATEGORY_LABEL, type CataloguePart, type PartCategory } from './types'

export interface PartFamily {
  id: string
  name: string
  category: PartCategory
  summary: string
}

export const FAMILIES: ReadonlyMap<string, PartFamily> = new Map(
  Object.entries(familyData as Record<string, Omit<PartFamily, 'id'>>).map(([id, family]) => [
    id,
    { id, ...family },
  ]),
)

export type CatalogueEntry =
  | { kind: 'part'; id: string; name: string; popularity: number; part: CataloguePart }
  | {
      kind: 'family'
      id: string
      name: string
      popularity: number
      family: PartFamily
      parts: CataloguePart[]
    }

export interface PartFilters {
  categories?: readonly PartCategory[]
  mountingHoles?: boolean
  official?: boolean
}

export const CATEGORY_ORDER: readonly PartCategory[] = [
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
  'control',
]

export function byPopularity(
  a: { popularity?: number; name: string },
  b: { popularity?: number; name: string },
): number {
  return (b.popularity ?? 0) - (a.popularity ?? 0) || a.name.localeCompare(b.name)
}

export function catalogueEntries(parts: readonly CataloguePart[]): CatalogueEntry[] {
  const families = new Map<string, CataloguePart[]>()
  const entries: CatalogueEntry[] = []
  for (const part of parts) {
    const family = part.family ? FAMILIES.get(part.family) : undefined
    if (!family) {
      entries.push({
        kind: 'part',
        id: part.id,
        name: part.name,
        popularity: part.popularity ?? 0,
        part,
      })
      continue
    }
    const members = families.get(family.id)
    if (members) members.push(part)
    else families.set(family.id, [part])
  }
  for (const [id, members] of families) {
    const family = FAMILIES.get(id)!
    const sorted = [...members].sort(byPopularity)
    if (sorted.length === 1) {
      const part = sorted[0]
      entries.push({
        kind: 'part',
        id: part.id,
        name: part.name,
        popularity: part.popularity ?? 0,
        part,
      })
      continue
    }
    entries.push({
      kind: 'family',
      id,
      name: family.name,
      popularity: Math.max(...sorted.map((part) => part.popularity ?? 0)),
      family,
      parts: sorted,
    })
  }
  return entries.sort(byPopularity)
}

export function matchesFilters(part: CataloguePart, filters: PartFilters): boolean {
  if (filters.categories?.length && !filters.categories.includes(part.category)) return false
  if (filters.mountingHoles && !part.mountingHoles?.length) return false
  if (filters.official && part.confidence === 'approximate') return false
  return true
}

export function groupedEntries(
  parts: readonly CataloguePart[],
): Array<{ category: PartCategory; label: string; entries: CatalogueEntry[]; count: number }> {
  return CATEGORY_ORDER.flatMap((category) => {
    const members = parts.filter((part) => part.category === category)
    if (!members.length) return []
    return [
      {
        category,
        label: CATEGORY_LABEL[category],
        entries: catalogueEntries(members),
        count: members.length,
      },
    ]
  })
}

const SYNONYMS: Record<string, string[]> = {
  rpi: ['raspberry'],
  raspi: ['raspberry'],
  raspberrypi: ['raspberry'],
  typec: ['usbc'],
  screen: ['display', 'screen'],
  monitor: ['display'],
  lcd: ['lcd', 'display'],
  tft: ['tft', 'display'],
  oled: ['oled'],
  knob: ['potentiometer', 'encoder'],
  pot: ['potentiometer'],
  battery: ['battery', '18650', 'cell', 'holder'],
  regulator: ['buck', 'boost', 'converter'],
  stepdown: ['buck'],
  stepup: ['boost'],
  switch: ['switch', 'rocker', 'toggle'],
  button: ['switch', 'button'],
  distance: ['distance', 'ultrasonic', 'rangefinder', 'lidar', 'tof'],
  temperature: ['temperature', 'dht22', 'bme280'],
  humidity: ['humidity', 'dht22', 'bme280'],
  motor: ['motor', 'stepper', 'servo'],
  screw: ['screw', 'bolt'],
  bolt: ['screw', 'bolt'],
  nut: ['nut', 'insert'],
  socket: ['socket', 'jack', 'port', 'receptacle'],
  plug: ['plug', 'jack', 'connector'],
  power: ['power', 'barrel', 'dc'],
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.]+/g, '')
}

function queryTokens(query: string): string[] {
  return normalise(query)
    .split(' ')
    .filter(Boolean)
    .flatMap((token) => {
      const sized = token.match(/^(m\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/)
      return sized ? [sized[1], sized[2]] : [token]
    })
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1)
      }
    }
  }
  return table[a.length][b.length]
}

interface Field {
  tokens: string[]
  compact: string
  weight: number
}

function field(text: string, weight: number): Field {
  return { tokens: normalise(text).split(' ').filter(Boolean), compact: compact(text), weight }
}

function termScore(term: string, target: Field): number {
  if (target.tokens.includes(term)) return 4
  if (term.length >= 2 && target.tokens.some((token) => token.startsWith(term))) return 3
  if (term.length >= 3 && target.compact.includes(term)) return 2
  if (term.length >= 4) {
    const allowed = term.length >= 8 ? 2 : 1
    const close = target.tokens.some(
      (token) =>
        Math.abs(token.length - term.length) <= allowed && editDistance(term, token) <= allowed,
    )
    if (close) return 1
  }
  return 0
}

function fieldsOf(part: CataloguePart): Field[] {
  const family = part.family ? FAMILIES.get(part.family) : undefined
  return [
    field(part.name, 3),
    field(family?.name ?? '', 3),
    field(part.variant ?? '', 2),
    field((part.tags ?? []).join(' '), 2),
    field(part.id, 2),
    field(part.manufacturer ?? '', 1.5),
    field(CATEGORY_LABEL[part.category], 1),
    field(part.summary, 1),
  ]
}

function bestScore(term: string, fields: readonly Field[]): number {
  const candidates = [term, ...(SYNONYMS[term] ?? [])]
  if (term.length > 3 && term.endsWith('s')) candidates.push(term.slice(0, -1))
  let best = 0
  for (const candidate of candidates) {
    for (const target of fields) {
      const score = termScore(candidate, target) * target.weight
      if (score > best) best = score
    }
  }
  return best
}

export function partScore(part: CataloguePart, query: string): number {
  const terms = queryTokens(query)
  if (!terms.length) return 0
  const fields = fieldsOf(part)
  let total = 0
  for (const term of terms) {
    const score = bestScore(term, fields)
    if (!score) return 0
    total += score
  }
  return total
}

export function searchEntries(
  parts: readonly CataloguePart[],
  query: string,
  filters: PartFilters = {},
): CatalogueEntry[] {
  const filtered = parts.filter((part) => matchesFilters(part, filters))
  if (!query.trim()) return catalogueEntries(filtered)
  const scores = new Map<string, number>()
  const hits = filtered.filter((part) => {
    const score = partScore(part, query)
    if (score > 0) scores.set(part.id, score)
    return score > 0
  })
  const scoreOf = (entry: CatalogueEntry) =>
    entry.kind === 'part'
      ? (scores.get(entry.part.id) ?? 0)
      : Math.max(...entry.parts.map((part) => scores.get(part.id) ?? 0))
  return catalogueEntries(hits).sort((a, b) => scoreOf(b) - scoreOf(a) || byPopularity(a, b))
}
