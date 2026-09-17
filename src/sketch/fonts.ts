import { parse, type Font } from 'opentype.js'
import { signedArea, flattenContour } from './text'
import type { GlyphContour, GlyphSegment, TextOutline } from './types'

export interface FontChoice {
  id: string
  family: string
  style: string
}

interface LocalFontData {
  postscriptName: string
  fullName: string
  family: string
  style: string
  blob(): Promise<Blob>
}

type FontQuery = () => Promise<LocalFontData[]>

const loaders = new Map<string, () => Promise<Font>>()
const loaded = new Map<string, Promise<Font>>()
const added: FontChoice[] = []

function fontQuery(): FontQuery | null {
  const query = (globalThis as { queryLocalFonts?: FontQuery }).queryLocalFonts
  return typeof query === 'function' ? query.bind(globalThis) : null
}

export function computerFontsSupported(): boolean {
  return fontQuery() !== null
}

export async function computerFonts(): Promise<FontChoice[]> {
  const query = fontQuery()
  if (!query) return [...added]
  const faces = await query()
  if (!faces.length) throw new Error('No fonts were shared.')
  const choices = new Map<string, FontChoice>()
  for (const face of faces) {
    if (!face.fullName || choices.has(face.fullName)) continue
    choices.set(face.fullName, { id: face.fullName, family: face.family, style: face.style })
    if (!loaders.has(face.fullName)) {
      loaders.set(face.fullName, async () => {
        const buffer = await (await face.blob()).arrayBuffer()
        return parse(singleFace(buffer, face.postscriptName))
      })
    }
  }
  for (const choice of added) if (!choices.has(choice.id)) choices.set(choice.id, choice)
  return [...choices.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || fontWeight(a.style) - fontWeight(b.style),
  )
}

function fontWeight(style: string): number {
  const order = ['thin', 'extralight', 'light', 'regular', 'medium', 'semibold', 'bold', 'black']
  const key = style.toLowerCase().replace(/[\s-]/g, '')
  const index = order.findIndex((name) => key.startsWith(name))
  return (index < 0 ? 3 : index) * 2 + (key.includes('italic') || key.includes('oblique') ? 1 : 0)
}

export function addedFonts(): FontChoice[] {
  return [...added]
}

export async function addFontFile(file: File): Promise<FontChoice> {
  const font = parse(singleFace(await file.arrayBuffer()))
  const family = englishName(font, 'fontFamily') ?? file.name.replace(/\.[^.]+$/, '')
  const style = englishName(font, 'fontSubfamily') ?? 'Regular'
  const id = englishName(font, 'fullName') ?? `${family} ${style}`
  const choice = { id, family, style }
  loaded.set(id, Promise.resolve(font))
  if (!added.some((existing) => existing.id === id)) added.push(choice)
  return choice
}

export function registerFont(choice: FontChoice, font: Font) {
  loaded.set(choice.id, Promise.resolve(font))
  if (!added.some((existing) => existing.id === choice.id)) added.push(choice)
}

export function fontLoaded(id: string): boolean {
  return loaded.has(id) || loaders.has(id)
}

export function loadFont(id: string): Promise<Font> | null {
  const ready = loaded.get(id)
  if (ready) return ready
  const loader = loaders.get(id)
  if (!loader) return null
  const pending = loader()
  loaded.set(id, pending)
  pending.catch(() => loaded.delete(id))
  return pending
}

function englishName(font: Font, key: string): string | undefined {
  const names = font.names[key]
  return names?.en ?? (names ? Object.values(names)[0] : undefined)
}

function tag(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  )
}

function postscriptNameAt(view: DataView, directory: number): string | null {
  const tables = view.getUint16(directory + 4)
  for (let i = 0; i < tables; i++) {
    const record = directory + 12 + i * 16
    if (tag(view, record) !== 'name') continue
    const table = view.getUint32(record + 8)
    const count = view.getUint16(table + 2)
    const strings = table + view.getUint16(table + 4)
    let fallback: string | null = null
    for (let j = 0; j < count; j++) {
      const entry = table + 6 + j * 12
      const platform = view.getUint16(entry)
      const nameId = view.getUint16(entry + 6)
      if (nameId !== 6) continue
      const length = view.getUint16(entry + 8)
      const start = strings + view.getUint16(entry + 10)
      if (platform === 3 || platform === 0) {
        let text = ''
        for (let k = 0; k + 1 < length; k += 2)
          text += String.fromCharCode(view.getUint16(start + k))
        return text
      }
      if (platform === 1 && fallback === null) {
        fallback = ''
        for (let k = 0; k < length; k++) fallback += String.fromCharCode(view.getUint8(start + k))
      }
    }
    return fallback
  }
  return null
}

export function singleFace(buffer: ArrayBuffer, postscriptName?: string): ArrayBuffer {
  const view = new DataView(buffer)
  if (buffer.byteLength < 12 || tag(view, 0) !== 'ttcf') return buffer
  const count = view.getUint32(8)
  const directories = Array.from({ length: count }, (_, i) => view.getUint32(12 + i * 4))
  const chosen =
    directories.find(
      (directory) => postscriptName && postscriptNameAt(view, directory) === postscriptName,
    ) ?? directories[0]
  const tables = view.getUint16(chosen + 4)
  const header = 12 + tables * 16
  const out = new Uint8Array(header + buffer.byteLength)
  out.set(new Uint8Array(buffer, chosen, header), 0)
  out.set(new Uint8Array(buffer), header)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < tables; i++) {
    const offset = 12 + i * 16 + 8
    outView.setUint32(offset, outView.getUint32(offset) + header)
  }
  return out.buffer
}

function capHeight(font: Font): number {
  const declared = font.tables.os2?.sCapHeight
  if (declared && declared > 0) return declared
  const box = font.charToGlyph('H')?.getBoundingBox()
  if (box && box.y2 > 0) return box.y2
  return font.unitsPerEm * 0.7
}

export function textOutline(font: Font, text: string): TextOutline {
  const cap = capHeight(font)
  const contours: GlyphContour[] = []
  const line = text.replace(/[\r\n\t]+/g, ' ')
  const advance = font.forEachGlyph(line, 0, 0, font.unitsPerEm, undefined, (glyph, x) => {
    const at = (px = 0, py = 0): [number, number] => [(x + px) / cap, py / cap]
    const pen: { contour: GlyphContour | null; last: [number, number] } = {
      contour: null,
      last: [0, 0],
    }
    const close = () => {
      const contour = pen.contour
      if (!contour) return
      const start = contour.start
      if (Math.hypot(pen.last[0] - start[0], pen.last[1] - start[1]) > 1e-9) {
        contour.segments.push([start[0], start[1]])
      }
      const points = flattenContour(contour)
      const xs = points.map((point) => point[0])
      const ys = points.map((point) => point[1])
      const wide = Math.max(...xs) - Math.min(...xs)
      const tall = Math.max(...ys) - Math.min(...ys)
      if (contour.segments.length >= 2 && Math.hypot(wide, tall) > 1e-6) contours.push(contour)
      pen.contour = null
    }
    for (const command of glyph.path.commands) {
      if (command.type === 'Z') {
        close()
        continue
      }
      const end = at(command.x, command.y)
      if (command.type === 'M') {
        close()
        pen.contour = { start: end, segments: [] }
        pen.last = end
        continue
      }
      const contour = pen.contour ?? { start: pen.last, segments: [] }
      pen.contour = contour
      let segment: GlyphSegment
      if (command.type === 'L') segment = end
      else if (command.type === 'Q') segment = [...at(command.x1, command.y1), ...end]
      else segment = [...at(command.x1, command.y1), ...at(command.x2, command.y2), ...end]
      const still = segment.every(
        (value, i) => Math.abs(value - (i % 2 === 0 ? pen.last[0] : pen.last[1])) < 1e-12,
      )
      if (!still) {
        contour.segments.push(segment)
        pen.last = end
      }
    }
    close()
  })
  return { width: advance / cap, contours }
}
