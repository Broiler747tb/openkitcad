import { decodeText, formatNumber, scalePositions, toBytes, type BinaryInput } from './io'
import { MILLIMETRES_PER_UNIT, MeshError, type MeshUnit, type TriMesh } from './types'
import { triangleNormal } from './vec'
import { weldExact } from './weld'

export interface StlImportOptions {
  unit?: MeshUnit
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let i = start; i < end; i++) text += String.fromCharCode(bytes[i])
  return text
}

export function isBinaryStl(data: BinaryInput): boolean {
  const bytes = toBytes(data)
  if (bytes.length < 84) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  if (84 + count * 50 === bytes.length) return true
  const head = latin1(bytes, 0, Math.min(bytes.length, 4096))
  if (/^\s*solid/i.test(head)) return !/\b(facet|endsolid)\b/i.test(head)
  return true
}

function binarySoup(bytes: Uint8Array): Float64Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  const available = Math.floor((bytes.length - 84) / 50)
  if (count > available) {
    throw new MeshError(
      `This STL file is cut short: it declares ${count} triangles but only holds ${available}.`,
    )
  }
  const soup = new Float64Array(count * 9)
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12
    for (let k = 0; k < 9; k++) soup[i * 9 + k] = view.getFloat32(base + k * 4, true)
  }
  return soup
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function asciiSoup(text: string): number[] {
  const soup: number[] = []
  const loop: number[] = []
  const tokens = /\S+/g
  const flush = () => {
    const count = loop.length / 3
    for (let k = 1; k + 1 < count; k++) {
      soup.push(loop[0], loop[1], loop[2])
      soup.push(loop[k * 3], loop[k * 3 + 1], loop[k * 3 + 2])
      soup.push(loop[(k + 1) * 3], loop[(k + 1) * 3 + 1], loop[(k + 1) * 3 + 2])
    }
    loop.length = 0
  }
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text))) {
    const word = match[0]
    const first = word.charCodeAt(0) | 32
    if (first < 97 || first > 122) continue
    const lower = word.toLowerCase()
    if (lower === 'vertex') {
      for (let k = 0; k < 3; k++) {
        const token = tokens.exec(text)
        const value = token ? Number(token[0]) : NaN
        if (!Number.isFinite(value)) {
          throw new MeshError(
            `Line ${lineOf(text, match.index)} of this STL file has a vertex that is not three numbers.`,
          )
        }
        loop.push(value)
      }
    } else if (lower === 'endloop' || lower === 'endfacet' || lower === 'facet') {
      flush()
    }
  }
  flush()
  return soup
}

export function parseStl(data: BinaryInput, options: StlImportOptions = {}): TriMesh {
  const bytes = toBytes(data)
  let soup: ArrayLike<number>
  if (isBinaryStl(bytes)) {
    soup = binarySoup(bytes)
  } else {
    soup = asciiSoup(decodeText(bytes))
    if (soup.length === 0 && bytes.length >= 84) {
      const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        80,
        true,
      )
      if (count > 0 && 84 + count * 50 <= bytes.length) soup = binarySoup(bytes)
    }
  }
  if (soup.length === 0) throw new MeshError('This STL file has no triangles in it.')
  for (let i = 0; i < soup.length; i++) {
    if (!Number.isFinite(soup[i])) {
      throw new MeshError('This STL file has a vertex with an invalid coordinate.')
    }
  }
  const mesh = weldExact(soup)
  scalePositions(mesh.positions, MILLIMETRES_PER_UNIT[options.unit ?? 'mm'])
  return mesh
}

export function writeStlBinary(mesh: TriMesh, header = 'OpenKitCAD mesh'): Uint8Array {
  const count = mesh.triangles.length / 3
  const bytes = new Uint8Array(84 + count * 50)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < Math.min(80, header.length); i++) bytes[i] = header.charCodeAt(i) & 0x7f
  view.setUint32(80, count, true)
  const p = mesh.positions
  const t = mesh.triangles
  for (let tri = 0; tri < count; tri++) {
    const offset = 84 + tri * 50
    const a = t[tri * 3]
    const b = t[tri * 3 + 1]
    const c = t[tri * 3 + 2]
    const n = triangleNormal(p, a, b, c)
    view.setFloat32(offset, n[0], true)
    view.setFloat32(offset + 4, n[1], true)
    view.setFloat32(offset + 8, n[2], true)
    const corners = [a, b, c]
    for (let k = 0; k < 3; k++) {
      const v = corners[k] * 3
      view.setFloat32(offset + 12 + k * 12, p[v], true)
      view.setFloat32(offset + 16 + k * 12, p[v + 1], true)
      view.setFloat32(offset + 20 + k * 12, p[v + 2], true)
    }
  }
  return bytes
}

export function writeStlAscii(mesh: TriMesh, name = 'mesh'): string {
  const safe = name.replace(/\s+/g, '_') || 'mesh'
  const p = mesh.positions
  const t = mesh.triangles
  const lines: string[] = [`solid ${safe}`]
  const vertex = (v: number) =>
    `      vertex ${formatNumber(p[v * 3])} ${formatNumber(p[v * 3 + 1])} ${formatNumber(p[v * 3 + 2])}`
  for (let i = 0; i < t.length; i += 3) {
    const n = triangleNormal(p, t[i], t[i + 1], t[i + 2])
    lines.push(`  facet normal ${formatNumber(n[0])} ${formatNumber(n[1])} ${formatNumber(n[2])}`)
    lines.push('    outer loop', vertex(t[i]), vertex(t[i + 1]), vertex(t[i + 2]), '    endloop')
    lines.push('  endfacet')
  }
  lines.push(`endsolid ${safe}`, '')
  return lines.join('\n')
}
