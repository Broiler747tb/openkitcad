import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { formatNumber, toBytes, type BinaryInput } from './io'
import { MILLIMETRES_PER_UNIT, MeshError, type MeshUnit, type NamedMesh } from './types'
import { escapeXml, scanXml } from './xml'

type Matrix = number[]

interface ModelObject {
  id: string
  name: string
  positions: number[]
  triangles: number[]
  hasMesh: boolean
  components: Array<{ objectId: string; path?: string; transform: Matrix }>
}

interface ModelItem {
  objectId: string
  path?: string
  transform: Matrix
  partNumber?: string
}

interface Model {
  unit: MeshUnit
  objects: Map<string, ModelObject>
  items: ModelItem[]
}

const UNIT_NAMES: Record<string, MeshUnit> = {
  micron: 'um',
  millimeter: 'mm',
  centimeter: 'cm',
  meter: 'm',
  inch: 'in',
  foot: 'ft',
}

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const MODEL_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel'

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY
  const numbers = value.trim().split(/\s+/).map(Number)
  if (numbers.length !== 12 || numbers.some((n) => !Number.isFinite(n))) {
    throw new MeshError(`The 3MF file has a transform that is not twelve numbers: "${value}".`)
  }
  const v = numbers
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1]
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k]
      out[column * 4 + row] = sum
    }
  }
  return out
}

function determinant(m: Matrix): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  )
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function parseModel(text: string): Model {
  const model: Model = { unit: 'mm', objects: new Map(), items: [] }
  let current: ModelObject | null = null
  let inMesh = false
  let inBuild = false
  scanXml(text, {
    open(name, attributes) {
      switch (name) {
        case 'model': {
          const unit = attributes.unit
          if (unit !== undefined) {
            const mapped = UNIT_NAMES[unit.toLowerCase()]
            if (!mapped) throw new MeshError(`The 3MF file uses an unknown unit "${unit}".`)
            model.unit = mapped
          }
          break
        }
        case 'object':
          current = {
            id: attributes.id ?? '',
            name: attributes.name ?? '',
            positions: [],
            triangles: [],
            hasMesh: false,
            components: [],
          }
          model.objects.set(current.id, current)
          break
        case 'mesh':
          if (current) {
            current.hasMesh = true
            inMesh = true
          }
          break
        case 'vertex':
          if (current && inMesh) {
            const x = Number(attributes.x)
            const y = Number(attributes.y)
            const z = Number(attributes.z)
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
              throw new MeshError(
                `Object ${current.id} in the 3MF file has a vertex that is not three numbers.`,
              )
            }
            current.positions.push(x, y, z)
          }
          break
        case 'triangle':
          if (current && inMesh) {
            const a = Number(attributes.v1)
            const b = Number(attributes.v2)
            const c = Number(attributes.v3)
            if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
              throw new MeshError(
                `Object ${current.id} in the 3MF file has a triangle without three vertex indices.`,
              )
            }
            current.triangles.push(a, b, c)
          }
          break
        case 'component':
          if (current && attributes.objectid !== undefined) {
            current.components.push({
              objectId: attributes.objectid,
              path: attributes.path,
              transform: parseTransform(attributes.transform),
            })
          }
          break
        case 'build':
          inBuild = true
          break
        case 'item':
          if (inBuild && attributes.objectid !== undefined) {
            model.items.push({
              objectId: attributes.objectid,
              path: attributes.path,
              transform: parseTransform(attributes.transform),
              partNumber: attributes.partnumber,
            })
          }
          break
      }
    },
    close(name) {
      if (name === 'object') current = null
      else if (name === 'mesh') inMesh = false
      else if (name === 'build') inBuild = false
    },
  })
  return model
}

function rootModelPath(read: (path: string) => string | undefined): string {
  const rels = read('_rels/.rels')
  let target: string | undefined
  if (rels) {
    scanXml(rels, {
      open(name, attributes) {
        if (name !== 'Relationship' || target) return
        if ((attributes.Type ?? '').toLowerCase().endsWith('/3dmodel')) target = attributes.Target
      },
      close() {},
    })
  }
  return normalizePath(target ?? '3D/3dmodel.model')
}

export function parse3mf(data: BinaryInput): NamedMesh[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(toBytes(data))
  } catch (error) {
    throw new MeshError(
      `This 3MF file is not a readable zip package (${(error as Error).message}).`,
    )
  }
  const lookup = new Map<string, string>()
  for (const key of Object.keys(files)) lookup.set(normalizePath(key).toLowerCase(), key)
  const read = (path: string) => {
    const key = lookup.get(normalizePath(path).toLowerCase())
    return key === undefined ? undefined : strFromU8(files[key])
  }
  const models = new Map<string, Model>()
  const load = (path: string): Model => {
    const normal = normalizePath(path)
    const cached = models.get(normal.toLowerCase())
    if (cached) return cached
    const text = read(normal)
    if (text === undefined) throw new MeshError(`The 3MF package has no model part at ${normal}.`)
    const model = parseModel(text)
    models.set(normal.toLowerCase(), model)
    return model
  }
  const rootPath = rootModelPath(read)
  const root = load(rootPath)
  const factor = MILLIMETRES_PER_UNIT[root.unit]
  const results: NamedMesh[] = []
  root.items.forEach((item) => {
    const positions: number[] = []
    const triangles: number[] = []
    let firstName = ''
    const append = (path: string, objectId: string, matrix: Matrix, depth: number) => {
      if (depth > 64) throw new MeshError('The 3MF file has components that contain themselves.')
      const object = load(path).objects.get(objectId)
      if (!object)
        throw new MeshError(`The 3MF file refers to object ${objectId}, which it does not define.`)
      if (!firstName && object.name) firstName = object.name
      if (object.hasMesh) {
        const base = positions.length / 3
        const count = object.positions.length / 3
        const m = matrix
        const p = object.positions
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i]
          const y = p[i + 1]
          const z = p[i + 2]
          positions.push(
            (m[0] * x + m[4] * y + m[8] * z + m[12]) * factor,
            (m[1] * x + m[5] * y + m[9] * z + m[13]) * factor,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) * factor,
          )
        }
        const flip = determinant(matrix) < 0
        const t = object.triangles
        for (let i = 0; i < t.length; i += 3) {
          if (
            t[i] < 0 ||
            t[i] >= count ||
            t[i + 1] < 0 ||
            t[i + 1] >= count ||
            t[i + 2] < 0 ||
            t[i + 2] >= count
          ) {
            throw new MeshError(
              `Object ${objectId} in the 3MF file has a triangle that points past its vertices.`,
            )
          }
          if (flip) triangles.push(base + t[i], base + t[i + 2], base + t[i + 1])
          else triangles.push(base + t[i], base + t[i + 1], base + t[i + 2])
        }
      }
      for (const component of object.components) {
        append(
          component.path ?? path,
          component.objectId,
          multiply(matrix, component.transform),
          depth + 1,
        )
      }
    }
    append(item.path ?? rootPath, item.objectId, item.transform, 0)
    if (!triangles.length) return
    results.push({
      name: firstName || item.partNumber || `Object ${item.objectId}`,
      mesh: { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) },
    })
  })
  if (!results.length)
    throw new MeshError('This 3MF file has nothing to build: its build list is empty.')
  return results
}

export function write3mf(bodies: NamedMesh[]): Uint8Array {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NAMESPACE}">\n`,
    '<resources>\n',
  ]
  bodies.forEach((body, k) => {
    const p = body.mesh.positions
    const t = body.mesh.triangles
    parts.push(
      `<object id="${k + 1}" name="${escapeXml(body.name)}" type="model"><mesh><vertices>\n`,
    )
    for (let i = 0; i < p.length; i += 3) {
      parts.push(
        `<vertex x="${formatNumber(p[i])}" y="${formatNumber(p[i + 1])}" z="${formatNumber(p[i + 2])}"/>\n`,
      )
    }
    parts.push('</vertices><triangles>\n')
    for (let i = 0; i < t.length; i += 3) {
      parts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`)
    }
    parts.push('</triangles></mesh></object>\n')
  })
  parts.push('</resources>\n<build>\n')
  bodies.forEach((_, k) => parts.push(`<item objectid="${k + 1}"/>\n`))
  parts.push('</build>\n</model>\n')
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>\n'
  const relationships =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${MODEL_RELATIONSHIP}"/>` +
    '</Relationships>\n'
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(relationships),
    '3D/3dmodel.model': strToU8(parts.join('')),
  })
}
