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

const AUTOSAVE_KEY = 'openkitcad.autosave.v1'
const FILE_EXTENSION = '.okc'

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

let autosaveTimer: number | undefined

/** Debounced autosave. Cheap enough to run on every edit. */
export function scheduleAutosave(doc: OkcDocument): void {
  clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({ savedAt: new Date().toISOString(), doc }),
      )
    } catch {
      // A full or disabled storage must never break editing.
    }
  }, 600)
}

export function loadAutosave(): { doc: OkcDocument; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.doc?.version) return null
    return { doc: migrate(parsed.doc), savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Forward-compatibility hook: older documents get upgraded here. */
function migrate(doc: OkcDocument): OkcDocument {
  return { ...emptyDocument(doc.name), ...doc, version: 1 }
}

/**
 * Custom parts travel with the file that uses them.
 *
 * Without this, a design sent to somebody else opens with a hole where their
 * board should be - the placement names a part that only exists in the sender's
 * browser. Only the parts actually placed are attached: the rest of somebody's
 * private catalogue is not theirs to hand over with a bracket.
 */
function partsUsedBy(doc: OkcDocument): CataloguePart[] {
  const wanted = new Set(doc.placements.map((p) => p.partId))
  // Read storage directly rather than the catalogue's cached copy. Saving is
  // rare enough that the cache buys nothing, and going straight to the source
  // means a save cannot be caught out by a cache filled at some other moment.
  return loadUserParts().filter((p) => wanted.has(p.id))
}

export function serialise(doc: OkcDocument): string {
  const used = partsUsedBy(doc)
  const out: OkcDocument = { ...doc }
  if (used.length) out.customParts = used
  else delete out.customParts
  return JSON.stringify(out, null, 2)
}

/**
 * Take on the custom parts an opened file brought with it.
 *
 * Only ones whose id is not already known are kept. A file must not be able to
 * redefine a Raspberry Pi: someone else's measurements silently replacing the
 * catalogue's would be a quiet way to ruin a panel, and the person opening the
 * file would have no reason to suspect it.
 *
 * Returns what happened, so the app can say so rather than changing somebody's
 * catalogue behind their back.
 */
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

export function deserialise(text: string): OkcDocument {
  const parsed = JSON.parse(text)
  if (!parsed?.version) throw new Error('That does not look like an OpenKitCAD file.')
  const doc = migrate(parsed)
  adoptCustomParts(doc)
  return doc
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^\w\-. ]+/g, '_').trim() || 'design'
}

/** Trigger a browser download. The universal fallback. */
export function downloadBlob(blob: Blob, filename: string): void {
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

/** Open a document from disk. Returns null when the user cancels. */
export async function openDocument(): Promise<OkcDocument | null> {
  if (typeof (window as any).showOpenFilePicker === 'function' && window.self === window.top) {
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
      return deserialise(await file.text())
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${FILE_EXTENSION},application/json`
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(deserialise(await file.text()))
      } catch {
        resolve(null)
      }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

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
  try {
    const doc = migrate(JSON.parse(strFromU8(inflateSync(fromBase64Url(match[1])))))
    adoptCustomParts(doc)
    return doc
  } catch {
    return null
  }
}

/** Roughly how long a share link would be, so the UI can warn before copying. */
export function shareLinkLength(doc: OkcDocument): number {
  try {
    return makeShareLink(doc).length
  } catch {
    return Infinity
  }
}
