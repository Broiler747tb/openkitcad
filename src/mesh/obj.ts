import { decodeText, formatNumber, type BinaryInput } from './io'
import { triangulateLoops } from './polygon'
import {
  MILLIMETRES_PER_UNIT,
  MeshError,
  type MeshGroup,
  type MeshUnit,
  type TriMesh,
} from './types'

export interface ObjImportOptions {
  unit?: MeshUnit
}

function triangulateFace(positions: number[], ids: number[], out: number[]) {
  const loop: number[] = []
  for (const id of ids) if (loop[loop.length - 1] !== id) loop.push(id)
  while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop()
  if (loop.length < 3) return
  if (loop.length === 3) {
    out.push(loop[0], loop[1], loop[2])
    return
  }
  const triangles = triangulateLoops(positions, [loop])
  if (triangles.length === (loop.length - 2) * 3) {
    for (const id of triangles) out.push(id)
    return
  }
  for (let k = 1; k + 1 < loop.length; k++) out.push(loop[0], loop[k], loop[k + 1])
}

export function parseObj(input: string | BinaryInput, options: ObjImportOptions = {}): TriMesh {
  const lines = decodeText(input).split(/\r?\n/)
  const positions: number[] = []
  const faces: number[][] = []
  const faceLines: number[] = []
  const segments: Array<{ name: string; face: number }> = [{ name: 'default', face: 0 }]
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1
    let line = lines[index]
    while (line.endsWith('\\') && index + 1 < lines.length)
      line = line.slice(0, -1) + ' ' + lines[++index]
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash)
    line = line.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    const keyword = parts[0]
    if (keyword === 'v') {
      if (parts.length < 4)
        throw new MeshError(`Line ${lineNumber} has a vertex with fewer than three coordinates.`)
      const x = Number(parts[1])
      const y = Number(parts[2])
      const z = Number(parts[3])
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new MeshError(`Line ${lineNumber} has a vertex coordinate that is not a number.`)
      }
      positions.push(x, y, z)
    } else if (keyword === 'f' || keyword === 'fo') {
      const ids: number[] = []
      const defined = positions.length / 3
      for (let k = 1; k < parts.length; k++) {
        const token = parts[k]
        const slash = token.indexOf('/')
        const head = slash < 0 ? token : token.slice(0, slash)
        const value = head === '' ? NaN : Number(head)
        if (!Number.isInteger(value) || value === 0) {
          throw new MeshError(`Line ${lineNumber}: "${token}" is not a vertex index.`)
        }
        const id = value < 0 ? defined + value : value - 1
        if (id < 0) {
          throw new MeshError(
            `Line ${lineNumber} refers to vertex ${value}, but only ${defined} vertices come before it.`,
          )
        }
        ids.push(id)
      }
      if (ids.length >= 3) {
        faces.push(ids)
        faceLines.push(lineNumber)
      }
    } else if (keyword === 'g' || keyword === 'o') {
      const name = parts.slice(1).join(' ') || 'default'
      const last = segments[segments.length - 1]
      if (last.face === faces.length) last.name = name
      else segments.push({ name, face: faces.length })
    }
  }
  const vertexTotal = positions.length / 3
  faces.forEach((ids, k) => {
    for (const id of ids) {
      if (id >= vertexTotal) {
        throw new MeshError(
          `Line ${faceLines[k]} refers to vertex ${id + 1}, but the file only defines ${vertexTotal}.`,
        )
      }
    }
  })
  const triangles: number[] = []
  const faceStart: number[] = []
  for (const ids of faces) {
    faceStart.push(triangles.length / 3)
    triangulateFace(positions, ids, triangles)
  }
  faceStart.push(triangles.length / 3)
  if (triangles.length === 0) throw new MeshError('This OBJ file has no faces in it.')
  const groups: MeshGroup[] = []
  segments.forEach((segment, k) => {
    const start = faceStart[segment.face]
    const endFace = k + 1 < segments.length ? segments[k + 1].face : faces.length
    const count = faceStart[endFace] - start
    if (count > 0) groups.push({ name: segment.name, start, count })
  })
  const factor = MILLIMETRES_PER_UNIT[options.unit ?? 'mm']
  const mesh: TriMesh = {
    positions: Float64Array.from(positions, (value) => value * factor),
    triangles: Uint32Array.from(triangles),
  }
  if (groups.length > 1 || (groups.length === 1 && groups[0].name !== 'default'))
    mesh.groups = groups
  return mesh
}

export function writeObj(mesh: TriMesh, options: { name?: string } = {}): string {
  const p = mesh.positions
  const t = mesh.triangles
  const lines: string[] = ['# OpenKitCAD mesh', `o ${options.name ?? 'mesh'}`]
  for (let i = 0; i < p.length; i += 3) {
    lines.push(`v ${formatNumber(p[i])} ${formatNumber(p[i + 1])} ${formatNumber(p[i + 2])}`)
  }
  const face = (tri: number) => `f ${t[tri * 3] + 1} ${t[tri * 3 + 1] + 1} ${t[tri * 3 + 2] + 1}`
  const count = t.length / 3
  const covered = new Uint8Array(count)
  for (const group of mesh.groups ?? []) {
    for (let tri = group.start; tri < group.start + group.count && tri < count; tri++)
      covered[tri] = 1
  }
  for (let tri = 0; tri < count; tri++) if (!covered[tri]) lines.push(face(tri))
  for (const group of mesh.groups ?? []) {
    lines.push(`g ${group.name}`)
    for (let tri = group.start; tri < group.start + group.count && tri < count; tri++)
      lines.push(face(tri))
  }
  lines.push('')
  return lines.join('\n')
}
