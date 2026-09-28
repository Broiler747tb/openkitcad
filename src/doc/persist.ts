/**
 * Saving, loading and sharing.
 *
 * Local-first by design: there is no server anywhere in this file. Work
 * autosaves into the browser so a closed tab loses nothing, "Save" writes a
 * real file to the user's disk, and sharing packs the whole document into the
 * URL itself so a link needs no hosting and stores nothing about anyone.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { emptyDocument, type OkcDocument } from './types'
import type { CataloguePart } from '../catalogue/types'
import {
  CATALOGUE,
  getPart,
  partProblems,
  refreshUserParts,
  STORAGE_FULL,
  uniquePartId,
  upsertUserPart,
  userParts,
} from '../catalogue'
import { loadUserParts } from '../catalogue/userParts'
import { androidDownload } from '../platform/android'
import {
  absorbMeshData,
  meshDataIds,
  missingMeshData,
  referencedMeshData,
  unkeptMeshData,
} from './meshData'
import { forgetMeshesExcept, recallMeshes } from './meshVault'
import { canonicalJson } from '../core/canonical'

const AUTOSAVE_KEY = 'openkitcad.autosave.v2'
const SET_ASIDE_KEY = 'openkitcad.autosave.v2.unopened'
const OLD_AUTOSAVE_KEY = 'openkitcad.autosave.v1'
const FILE_EXTENSION = '.okc'

export const OLD_DESIGN_MESSAGE =
  "This design was made with OpenKitCAD 0.6 or earlier and can't be opened by this version."

export function isCurrentDesign(value: unknown): value is OkcDocument {
  const candidate = value as { format?: unknown; version?: unknown } | null
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    candidate.format === 'openkitcad' &&
    candidate.version === 2
  )
}

function withMeshData(doc: OkcDocument): OkcDocument {
  const meshData = referencedMeshData(doc)
  const out: OkcDocument = { ...doc }
  if (Object.keys(meshData).length) out.meshData = meshData
  else delete out.meshData
  return out
}

function normalise(doc: OkcDocument): OkcDocument {
  absorbMeshData(doc.meshData)
  const { meshData: _meshData, ...rest } = doc
  doc = rest
  const base = emptyDocument(doc.name ?? 'Untitled')
  return {
    ...base,
    ...doc,
    units: doc.units ?? base.units,
    parameters: doc.parameters ?? [],
    bindings: doc.bindings ?? [],
    occurrences: doc.occurrences ?? [],
    timeline: doc.timeline ?? [],
    marker: doc.marker ?? null,
    groups: doc.groups ?? [],
  }
}

export function discardOldAutosave(): void {
  try {
    localStorage.removeItem(OLD_AUTOSAVE_KEY)
  } catch {
    return
  }
}

let autosaveTimer: number | undefined

export function scheduleAutosave(doc: OkcDocument, report?: (saved: boolean) => void): void {
  clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    const saved = saveAutosaveNow(doc)
    report?.(saved)
  }, 600)
}

function writeAutosave(doc: OkcDocument): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), doc }))
    return true
  } catch {
    return false
  }
}

export function saveAutosaveNow(doc: OkcDocument): boolean {
  clearTimeout(autosaveTimer)
  const unkept = unkeptMeshData(doc)
  const { meshData: _meshData, ...bare } = doc
  if (Object.keys(unkept).length && writeAutosave({ ...bare, meshData: unkept })) return true
  return writeAutosave(bare)
}

export const AUTOSAVE_FULL = `Autosave failed: ${STORAGE_FULL}. Save the design to a file to keep it.`

export function loadAutosave(): { doc: OkcDocument; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isCurrentDesign(parsed?.doc)) return null
    return { doc: normalise(parsed.doc), savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export async function restoreAutosave(): Promise<{ doc: OkcDocument; savedAt: string } | null> {
  const saved = loadAutosave()
  if (!saved) return null
  absorbMeshData(await recallMeshes(missingMeshData(saved.doc)))
  return saved
}

function setAsideMeshIds(): string[] {
  try {
    const raw = localStorage.getItem(SET_ASIDE_KEY)
    const timeline = raw ? JSON.parse(raw)?.doc?.timeline : null
    if (!Array.isArray(timeline)) return []
    return timeline.flatMap((feature) =>
      feature?.kind === 'meshInsert' && typeof feature.dataId === 'string' ? [feature.dataId] : [],
    )
  } catch {
    return []
  }
}

export function tidyMeshStore(doc: OkcDocument): Promise<number> {
  return forgetMeshesExcept(new Set([...meshDataIds(doc), ...setAsideMeshIds()]))
}

export function setAsideAutosave(): void {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (raw) localStorage.setItem(SET_ASIDE_KEY, raw)
  } catch {
    return
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    return
  }
}

function partsUsedBy(doc: OkcDocument): CataloguePart[] {
  const wanted = new Set(
    doc.components.flatMap((component) =>
      component.source.kind === 'catalogue' ? [component.source.partId] : [],
    ),
  )
  return loadUserParts().filter((p) => wanted.has(p.id))
}

export function serialise(doc: OkcDocument): string {
  const used = partsUsedBy(doc)
  const out: OkcDocument = withMeshData(doc)
  if (used.length) out.customParts = used
  else delete out.customParts
  return JSON.stringify(out, null, 2)
}

export interface Adoption {
  added: string[]
  copied: string[]
  invalid: Array<{ name: string; problem: string }>
  unsaved: string[]
}

const noAdoption = (): Adoption => ({ added: [], copied: [], invalid: [], unsaved: [] })

let lastAdoption: Adoption = noAdoption()

export function lastAdoptedParts(): Adoption {
  return lastAdoption
}

function sameContent(a: CataloguePart, b: CataloguePart): boolean {
  return canonicalJson({ ...a, id: '' }) === canonicalJson({ ...b, id: '' })
}

function partName(part: unknown): string {
  const name = part && typeof part === 'object' ? (part as { name?: unknown }).name : undefined
  return typeof name === 'string' && name.trim() ? name : 'A part'
}

export function adoptCustomParts(doc: OkcDocument): Adoption {
  const adoption = noAdoption()
  const renamed = new Map<string, string>()
  refreshUserParts()
  for (const part of doc.customParts ?? []) {
    const problems = partProblems(part)
    if (problems.length) {
      adoption.invalid.push({ name: partName(part), problem: problems[0] })
      continue
    }
    const existing = getPart(part.id)
    if (existing && sameContent(existing, part)) continue
    const twin = existing ? userParts().find((mine) => sameContent(mine, part)) : undefined
    if (twin) {
      renamed.set(part.id, twin.id)
      continue
    }
    const taken = new Set([...CATALOGUE, ...userParts()].map((known) => known.id))
    const id = existing ? uniquePartId(part.id, taken) : part.id
    upsertUserPart(id === part.id ? part : { ...part, id })
    refreshUserParts()
    if (!userParts().some((mine) => mine.id === id)) {
      adoption.unsaved.push(part.name)
      continue
    }
    if (id === part.id) {
      adoption.added.push(part.name)
      continue
    }
    renamed.set(part.id, id)
    adoption.copied.push(part.name)
  }
  for (const component of doc.components) {
    const source = component.source
    if (source.kind !== 'catalogue' || !renamed.has(source.partId)) continue
    component.source = { ...source, partId: renamed.get(source.partId)! }
  }
  if (doc.customParts && renamed.size) {
    doc.customParts = doc.customParts.map((part) =>
      renamed.has(part.id) ? { ...part, id: renamed.get(part.id)! } : part,
    )
  }
  lastAdoption = adoption
  return adoption
}

export function adoptionNote(adoption: Adoption = lastAdoption): string | null {
  const notes = [
    ...adoption.copied.map(
      (name) =>
        `This design's "${name}" differs from the one in your parts, so it was added as a copy.`,
    ),
    ...adoption.invalid.map(({ name, problem }) => `"${name}" was left out: ${problem}`),
    ...adoption.unsaved.map((name) => `"${name}" could not be saved: ${STORAGE_FULL}.`),
  ]
  return notes.length ? notes.join(' ') : null
}

export function parseDesign(text: string): OkcDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(OLD_DESIGN_MESSAGE)
  }
  if (!isCurrentDesign(parsed)) throw new Error(OLD_DESIGN_MESSAGE)
  return normalise(parsed)
}

export function deserialise(text: string): OkcDocument {
  const doc = parseDesign(text)
  adoptCustomParts(doc)
  return doc
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^\w\-. ]+/g, '_').trim() || 'design'
}

/** Trigger a browser download. The universal fallback. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (androidDownload(blob, filename)) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const canUseFilePicker = () =>
  typeof (window as any).showSaveFilePicker === 'function' &&
  // The picker throws in cross-origin iframes; a download always works.
  window.self === window.top

/**
 * Save the document. Uses the File System Access API where available so the
 * user gets a real Save dialog and a real path, and falls back to a download.
 */
export async function saveDocument(doc: OkcDocument): Promise<'saved' | 'cancelled'> {
  const filename = sanitiseFilename(doc.name) + FILE_EXTENSION
  const text = serialise(doc)

  if (canUseFilePicker()) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'OpenKitCAD design',
            accept: { 'application/json': [FILE_EXTENSION] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return 'saved'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      // Anything else: fall through to the download path.
    }
  }

  downloadBlob(new Blob([text], { type: 'application/json' }), filename)
  return 'saved'
}

export async function openDocument(): Promise<OkcDocument | null> {
  if (typeof (window as any).showOpenFilePicker === 'function' && window.self === window.top) {
    let text: string | null = null
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'OpenKitCAD design',
            accept: { 'application/json': [FILE_EXTENSION] },
          },
        ],
      })
      const file = await handle.getFile()
      text = await file.text()
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
    if (text !== null) return deserialise(text)
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${FILE_EXTENSION},application/json`
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(deserialise(await file.text()))
      } catch (e) {
        reject(e)
      }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Pack the whole document into a URL fragment. The fragment never leaves the
 * browser - it is not sent to any server, including whatever is hosting the
 * app - so a share link is private to whoever holds it.
 */
export function makeShareLink(doc: OkcDocument): string {
  // A share link is the whole design or it is nothing: a link that opens with
  // somebody's board missing is worse than no link.
  const used = partsUsedBy(doc)
  const packedDoc = withMeshData(doc)
  const full: OkcDocument = used.length ? { ...packedDoc, customParts: used } : packedDoc
  const packed = deflateSync(strToU8(JSON.stringify(full)), { level: 9 })
  const base = `${location.origin}${location.pathname}`
  return `${base}#d=${toBase64Url(packed)}`
}

export function readShareLink(hash: string = location.hash): OkcDocument | null {
  const match = /[#&]d=([A-Za-z0-9\-_]+)/.exec(hash)
  if (!match) return null
  let text: string
  try {
    text = strFromU8(inflateSync(fromBase64Url(match[1])))
  } catch {
    throw new Error(OLD_DESIGN_MESSAGE)
  }
  return parseDesign(text)
}

/** Roughly how long a share link would be, so the UI can warn before copying. */
export function shareLinkLength(doc: OkcDocument): number {
  try {
    return makeShareLink(doc).length
  } catch {
    return Infinity
  }
}
