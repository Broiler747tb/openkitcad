import type { CataloguePart, MountingHole } from './types'

/**
 * Parts the user has measured themselves.
 *
 * The catalogue is the point of this app, and it will always be missing the
 * board somebody is holding. Rather than making them wait for a release, a part
 * they build here is usable immediately - saved locally, merged into the
 * catalogue, and generating holes and standoffs like any other. Contributing it
 * back is then a separate, optional step, which is the right order: the tool has
 * to be useful to one person before it is worth their while helping everyone.
 *
 * Stored as the same JSON a contributed part is, so what they download is
 * literally the file that goes in the repo - no export step that could drift
 * from what the app is using.
 */
const KEY = 'openkitcad.userparts.v1'

export function loadUserParts(): CataloguePart[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CataloguePart[]) : []
  } catch {
    // A corrupt entry should cost the user their custom parts, not the whole
    // app: an exception here would happen before anything is on screen.
    return []
  }
}

export function saveUserParts(parts: CataloguePart[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(parts))
  } catch {
    // Quota or private mode. Nothing useful to do, and the part still works for
    // this session.
  }
}

/** Add or replace one, keyed on its id. */
export function upsertUserPart(part: CataloguePart): CataloguePart[] {
  const parts = loadUserParts().filter((p) => p.id !== part.id)
  parts.push(part)
  saveUserParts(parts)
  return parts
}

export function removeUserPart(id: string): CataloguePart[] {
  const parts = loadUserParts().filter((p) => p.id !== id)
  saveUserParts(parts)
  return parts
}

/** Ids are used as filenames in the repo, so keep them to what a file can be. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export interface PartDraft {
  name: string
  category: CataloguePart['category']
  manufacturer: string
  summary: string
  width: number
  depth: number
  thickness: number
  cornerRadius: number
  holes: MountingHole[]
  confidence: CataloguePart['confidence']
  source: string
  datasheet: string
  tags: string
}

export function emptyDraft(): PartDraft {
  return {
    name: '',
    category: 'mcu',
    manufacturer: '',
    summary: '',
    width: 50,
    depth: 25,
    thickness: 1.6,
    cornerRadius: 2,
    holes: [],
    // Nobody contributing their first part has a mechanical drawing open, and
    // "measured" is both the honest default and the one that says what the
    // reader should do about it.
    confidence: 'measured',
    source: '',
    datasheet: '',
    tags: '',
  }
}

/**
 * Turn a draft into the JSON a part file holds.
 *
 * Deliberately the same shape as the files in the repo, down to field order, so
 * that a downloaded part can be dropped straight into `src/catalogue/parts/`
 * with nothing to reconcile.
 */
export function draftToPart(draft: PartDraft): CataloguePart {
  const id = slugify(draft.name) || 'my-part'
  const part: CataloguePart = {
    id,
    name: draft.name.trim() || 'My part',
    category: draft.category,
    summary: draft.summary.trim() || `${draft.width} x ${draft.depth} mm board.`,
    confidence: draft.confidence,
    source:
      draft.source.trim() ||
      'Measured by hand. Check against your own part before cutting anything.',
    geometry: {
      kind: 'board',
      outline: {
        shape: 'rect',
        w: draft.width,
        h: draft.depth,
        ...(draft.cornerRadius > 0 ? { cornerRadius: draft.cornerRadius } : {}),
      },
      thickness: draft.thickness,
    },
  }
  if (draft.manufacturer.trim()) part.manufacturer = draft.manufacturer.trim()
  if (draft.holes.length) part.mountingHoles = draft.holes
  if (draft.datasheet.trim()) {
    part.links = [{ label: 'Datasheet', url: draft.datasheet.trim() }]
  }
  const tags = draft.tags
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (tags.length) part.tags = tags
  return part
}

/**
 * What is wrong with a draft, in the order it matters.
 *
 * Warnings rather than blocks, with one exception: a part with no name has no
 * id, and an id is a filename. Everything else is the user's call - a board
 * with no mounting holes is a perfectly good part, it just cannot generate any.
 */
export function draftProblems(draft: PartDraft): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = []
  const warnings: string[] = []

  if (!draft.name.trim()) blocking.push('Give it a name. The name becomes its filename.')
  if (draft.width <= 0 || draft.depth <= 0) blocking.push('Width and depth have to be more than zero.')
  if (draft.thickness <= 0) blocking.push('Thickness has to be more than zero.')

  if (!draft.holes.length) {
    warnings.push('No mounting holes yet, so this part cannot generate holes or standoffs.')
  }
  for (const hole of draft.holes) {
    if (hole.x < 0 || hole.y < 0 || hole.x > draft.width || hole.y > draft.depth) {
      warnings.push(`Hole at ${hole.x}, ${hole.y} sits outside the board.`)
    }
  }
  if (!draft.summary.trim()) {
    warnings.push('A one-line summary is what people read in the list.')
  }
  if (draft.confidence === 'datasheet' && !draft.source.trim()) {
    warnings.push('Saying these are datasheet figures means saying which datasheet.')
  }
  return { blocking, warnings }
}
