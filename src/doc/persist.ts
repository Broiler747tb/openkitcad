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
import { getPart, refreshUserParts, upsertUserPart } from '../catalogue'
import { loadUserParts } from '../catalogue/userParts'
import { androidDownload } from '../platform/android'

const AUTOSAVE_KEY = 'openkitcad.autosave.v2'
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

function normalise(doc: OkcDocument): OkcDocument {
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

export function scheduleAutosave(doc: OkcDocument): void {
  clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => saveAutosaveNow(doc), 600)
}

export function saveAutosaveNow(doc: OkcDocument): void {
  clearTimeout(autosaveTimer)
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), doc }))
  } catch {
    return
  }
}

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
  const out: OkcDocument = { ...doc }
  if (used.length) out.customParts = used
  else delete out.customParts
  return JSON.stringify(out, null, 2)
}

let lastAdoption: { added: string[]; skipped: string[] } = { added: [], skipped: [] }

/** What the last opened file or link brought with it, for the app to report. */
export function lastAdoptedParts(): { added: string[]; skipped: string[] } {
  return lastAdoption
}

export function adoptCustomParts(doc: OkcDocument): { added: string[]; skipped: string[] } {
  const added: string[] = []
  const skipped: string[] = []
  // Read fresh either side of every write. The catalogue caches user parts -
  // they are looked up inside the rebuild loop - and deciding whether a part is
  // already known from a cache filled before the last write is how you get a
  // part reported as already present and then not be there.
  refreshUserParts()
  for (const part of doc.customParts ?? []) {
    if (getPart(part.id)) {
      skipped.push(part.name)
      continue
    }
    upsertUserPart(part)
    refreshUserParts()
    added.push(part.name)
  }
  lastAdoption = { added, skipped }
  return lastAdoption
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
  const full: OkcDocument = used.length ? { ...doc, customParts: used } : doc
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
  return deserialise(text)
}

/** Roughly how long a share link would be, so the UI can warn before copying. */
export function shareLinkLength(doc: OkcDocument): number {
  try {
    return makeShareLink(doc).length
  } catch {
    return Infinity
  }
}
