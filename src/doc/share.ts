import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate'
import { serialise, isCurrentDesign } from './persist'
import { emptyDocument, type OkcDocument } from './types'
import { meshDataIds } from './meshData'
import { partProblems } from '../catalogue'
import { decodeCompactDocument, encodeCompactDocument, shareChecksum } from './shareCodec'

export const PUBLIC_APP_URL = 'https://broiler747tb.github.io/openkitcad/'
export const MAX_SHARE_LINK_LENGTH = 8_000
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

export function isSharedView(hash = location.hash): boolean {
  const params = new URLSearchParams(hash.slice(1))
  return params.has('m') || params.get('view') === '1'
}

export function createShareLink(doc: OkcDocument, base = PUBLIC_APP_URL): string {
  const snapshot = JSON.parse(serialise(doc)) as OkcDocument
  if (meshDataIds(snapshot).some((id) => !snapshot.meshData?.[id])) {
    throw new Error('Some imported mesh data is missing. Reopen the saved design before sharing.')
  }
  const bytes = strToU8(JSON.stringify(snapshot))
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error('This model is too large for a link. Send the .okc file instead.')
  const binaryDoc = encodeCompactDocument(snapshot)
  const compact = new Uint8Array(binaryDoc.length + 5)
  compact[0] = 1
  compact.set(binaryDoc, 1)
  const json = new Uint8Array(bytes.length + 5)
  json.set(bytes, 1)
  for (const payload of [compact, json]) {
    new DataView(payload.buffer).setUint32(
      payload.length - 4,
      shareChecksum(payload.subarray(0, -4)),
      true,
    )
  }
  const compactPacked = deflateSync(compact, { level: 9 })
  const jsonPacked = deflateSync(json, { level: 9 })
  const packed = compactPacked.length <= jsonPacked.length ? compactPacked : jsonPacked
  let binary = ''
  for (let i = 0; i < packed.length; i += 0x8000) {
    binary += String.fromCharCode(...packed.subarray(i, i + 0x8000))
  }
  const data = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const url = new URL(base)
  url.search = ''
  url.hash = `m=1.${data}`
  if (url.href.length > MAX_SHARE_LINK_LENGTH)
    throw new Error('This model is too large for a reliable link. Send the .okc file instead.')
  return url.href
}

export function readSharedSnapshot(hash = location.hash): OkcDocument {
  const params = new URLSearchParams(hash.slice(1))
  const compact = params.get('m')
  if (compact !== null && !compact.startsWith('1.'))
    throw new Error('This link needs a newer version of OpenKitCAD.')
  const data = compact !== null ? compact.slice(2) : params.get('d')
  if (!data || !/^[A-Za-z0-9_-]+$/.test(data) || hash.length > MAX_SHARE_LINK_LENGTH) {
    throw new Error('This link is incomplete or too long. Ask for the .okc file instead.')
  }
  let parsed: unknown
  try {
    const binary = atob(
      data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4),
    )
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const chunks: Uint8Array[] = []
    let size = 0
    const inflate = new Inflate((chunk) => {
      size += chunk.length
      if (size > MAX_DOCUMENT_BYTES) throw new Error('Too large')
      chunks.push(chunk)
    })
    for (let i = 0; i < bytes.length; i += 128) {
      inflate.push(bytes.subarray(i, i + 128), i + 128 >= bytes.length)
    }
    const output = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    if (compact === null) parsed = JSON.parse(strFromU8(output))
    else {
      if (output.length < 5) throw new Error('Truncated payload')
      const payload = output.subarray(0, -4)
      if (shareChecksum(payload) !== new DataView(output.buffer).getUint32(output.length - 4, true))
        throw new Error('Damaged payload')
      if (payload[0] === 0) parsed = JSON.parse(strFromU8(payload.subarray(1)))
      else if (payload[0] === 1) parsed = decodeCompactDocument(payload.subarray(1))
      else throw new Error('Unknown encoding')
    }
  } catch {
    throw new Error(
      'This link is damaged or the model is too large. Ask for the .okc file instead.',
    )
  }
  if (
    !isCurrentDesign(parsed) ||
    typeof parsed.name !== 'string' ||
    !Array.isArray(parsed.components) ||
    !Array.isArray(parsed.timeline) ||
    typeof parsed.rootComponentId !== 'string'
  ) {
    throw new Error('This link does not contain a supported OpenKitCAD design.')
  }
  const doc: OkcDocument = { ...emptyDocument(parsed.name), ...parsed }
  if (
    !doc.components.every(
      (c) => c && typeof c.id === 'string' && c.source && Array.isArray(c.bodies),
    ) ||
    !doc.timeline.every((f) => f && typeof f.id === 'string' && typeof f.kind === 'string') ||
    !Array.isArray(doc.occurrences) ||
    !Array.isArray(doc.parameters) ||
    !Array.isArray(doc.bindings) ||
    !Array.isArray(doc.groups)
  ) {
    throw new Error('This link contains an invalid design.')
  }
  if (
    doc.customParts &&
    (!Array.isArray(doc.customParts) || doc.customParts.some((part) => partProblems(part).length))
  ) {
    throw new Error('This link contains an invalid custom part.')
  }
  if (meshDataIds(doc).some((id) => !doc.meshData?.[id]))
    throw new Error('This link is missing imported mesh data.')
  return doc
}
