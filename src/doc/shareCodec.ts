type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const KEYS =
  'id name kind componentId bodyId bodyIds sketchId featureId rootComponentId components occurrences timeline parameters bindings marker groups units source bodies visible colour plane origin centre width depth height radius distance angle axis result sketch points lines circles arcs constraints x y a b c offset face edge vertex profiles expression value transform parentComponentId childComponentId grounded suppressed symmetric reverse surface dataId meshData customParts positions triangles category summary confidence geometry outline thickness ports mounts partId path target options'.split(
    ' ',
  )
const WORDS =
  'design catalogue named face construction angled XY XZ YZ x y z mm cm m in ft newBody join cut intersect sketch extrude revolve box cylinder sphere fillet chamfer shell hole combine move scale bodyPattern mirror splitBody loft sweep rib web emboss coil pipe thicken constructionPlane meshInsert meshRepair meshReduce meshRemesh meshSmooth meshReverse meshPlaneCut meshConvert tessellate line circle arc rectangle point distance coincident horizontal vertical parallel perpendicular tangent equal concentric angle midpoint fixed diameter radius board rect measured approximate datasheet mcu'.split(
    ' ',
  )
const keyCodes = new Map(KEYS.map((key, index) => [key, index + 1]))
const wordCodes = new Map(WORDS.map((word, index) => [word, index]))

const SCHEMAS = [
  ['box', 'id name componentId plane origin width depth height result cornerRadius suppressed'],
  ['cylinder', 'id name componentId plane centre radius height result suppressed'],
  ['sphere', 'id name componentId centre radius result suppressed'],
  ['sketch', 'id name componentId plane sketch visible suppressed'],
  [
    'extrude',
    'id name componentId sketchId profiles distance symmetric reverse draftAngle result surface suppressed',
  ],
  [
    'revolve',
    'id name componentId sketchId profiles angle axis axisLine result surface suppressed',
  ],
  ['named', 'name offset'],
  ['face', 'face offset'],
  ['construction', 'featureId offset'],
  ['newBody', 'bodyId'],
  ['join', 'bodyId'],
  ['cut', 'bodyIds'],
  ['intersect', 'bodyIds'],
  ['design', ''],
  ['catalogue', 'partId options'],
  ['torus', 'id name componentId suppressed plane centre majorRadius minorRadius result'],
  ['fillet', 'id name componentId suppressed bodyId radius edges'],
  ['chamfer', 'id name componentId suppressed bodyId distance edges'],
  ['shell', 'id name componentId suppressed bodyId thickness openFaces'],
  [
    'hole',
    'id name componentId suppressed bodyId plane source style diameter depth counterboreDiameter counterboreDepth countersinkAngle fastener',
  ],
  [
    'standoff',
    'id name componentId suppressed plane source height outerDiameter boreDiameter boreDepth fastener result',
  ],
  [
    'portCutout',
    'id name componentId suppressed bodyId occurrencePath contextPath connectorIds tolerance',
  ],
  ['combine', 'id name componentId suppressed bodyId toolBodyIds operation keepTools'],
  ['vent', 'id name componentId suppressed bodyId plane shape size spacing margin depth'],
  [
    'lid',
    'id name componentId suppressed sourceBodyId shellFeatureId thickness clearance fit fitClass hooks hinge result',
  ],
  ['lidSocket', 'id name componentId suppressed bodyId lidFeatureId'],
  [
    'snapFit',
    'id name componentId suppressed bodyId mateBodyId gap fitClass plane position angle length thickness width hookDepth retention material through',
  ],
  [
    'fitPins',
    'id name componentId suppressed bodyId mateBodyId gap fitClass plane positions diameter height',
  ],
  [
    'lipGroove',
    'id name componentId suppressed bodyId mateBodyId gap fitClass plane width height inset',
  ],
  [
    'dovetail',
    'id name componentId suppressed bodyId mateBodyId gap fitClass plane position angle length width height flankAngle through',
  ],
  [
    'snapRing',
    'id name componentId suppressed bodyId mateBodyId gap fitClass face anchor flipEnd distance bead retention slots',
  ],
  [
    'bayonet',
    'id name componentId suppressed bodyId mateBodyId gap fitClass face anchor flipEnd distance lugs width height thickness angle detent',
  ],
  [
    'hinge',
    'id name componentId suppressed bodyId mateBodyId gap fitClass plane position angle length knuckles diameter',
  ],
  ['move', 'id name componentId suppressed bodyIds offset rotation'],
  [
    'constructionPlane',
    'id name componentId suppressed method base second distance axis angle visible',
  ],
  ['offsetFace', 'id name componentId suppressed bodyId faces distance'],
  ['draft', 'id name componentId suppressed bodyId faces plane angle flip'],
  ['loft', 'id name componentId suppressed sections ruled surface result'],
  ['sweep', 'id name componentId suppressed sketchId profiles pathSketchId surface result'],
  [
    'coil',
    'id name componentId suppressed plane centre diameter revolutions height section sectionSize clockwise result',
  ],
  ['pipe', 'id name componentId suppressed pathSketchId section size hollow thickness result'],
  ['thicken', 'id name componentId suppressed sourceBodyId thickness symmetric result'],
  [
    'screwLid',
    'id name componentId suppressed face anchor flipEnd pitch turns profile gap fitClass wall top grip capBodyId',
  ],
  [
    'enclosure',
    'id name componentId suppressed contextPath mounts clearance under wall floor lid lidThickness gap fitClass screw tolerance bodyId lidBodyId',
  ],
  [
    'boardClips',
    'id name componentId suppressed bodyId occurrencePath contextPath count width post grip ledge hook gap fitClass',
  ],
  [
    'cableEntry',
    'id name componentId suppressed entry bodyId plane position angle cable clearance gland tie screw nutRoom barBodyId',
  ],
  [
    'fitCoupon',
    'id name componentId suppressed plane origin diameter start step count thickness height pinBodyId holeBodyId',
  ],
  [
    'rib',
    'id name componentId suppressed sketchId curves bodyId thickness sides flipSide depth distance flip',
  ],
  ['emboss', 'id name componentId suppressed sketchId profiles face depth effect'],
  ['patch', 'id name componentId suppressed sketchId profiles bodyId'],
  [
    'bodyPattern',
    'id name componentId suppressed bodyIds pattern axisOne countOne spacingOne axisTwo countTwo spacingTwo axis count angle newBodyIds',
  ],
  ['mirror', 'id name componentId suppressed bodyIds plane newBodyIds'],
  ['splitBody', 'id name componentId suppressed bodyId plane newBodyId'],
  ['scale', 'id name componentId suppressed bodyIds factor'],
  ['stitch', 'id name componentId suppressed bodyIds tolerance'],
  ['unstitch', 'id name componentId suppressed bodyId newBodyIds'],
  ['surfaceOffset', 'id name componentId suppressed sourceBodyId distance bodyId'],
  ['reverseNormal', 'id name componentId suppressed bodyIds'],
  ['meshInsert', 'id name componentId suppressed bodyId dataId transform unit yUp centre ground'],
  ['tessellate', 'id name componentId suppressed sourceBodyId bodyId refinement'],
  ['meshRepair', 'id name componentId suppressed bodyId closeHoles'],
  ['meshReduce', 'id name componentId suppressed bodyId method proportion tolerance count'],
  ['meshRemesh', 'id name componentId suppressed bodyId edgeLength preserveSharp'],
  ['meshSmooth', 'id name componentId suppressed bodyId strength iterations'],
  ['meshReverse', 'id name componentId suppressed bodyIds'],
  ['meshPlaneCut', 'id name componentId suppressed bodyId plane flip fill keep newBodyId'],
  ['meshSeparate', 'id name componentId suppressed bodyId newBodyIds'],
  ['meshCombine', 'id name componentId suppressed bodyId toolBodyIds'],
  ['meshConvert', 'id name componentId suppressed sourceBodyId bodyId method'],
  [
    'joint',
    'id name componentId suppressed asBuilt one two motion flip angle offset values limits locked',
  ],
  ['jointOrigin', 'id name componentId suppressed snap base offset angle flip'],
  ['motionStudy', 'id name componentId suppressed steps tracks'],
  ['rigidGroup', 'id name componentId suppressed members'],
  ['motionLink', 'id name componentId suppressed a b ratio offset'],
].map(([kind, fields]) => ({ kind, keys: fields ? fields.split(' ') : [] }))

const ROOT_DEFAULTS: Record<string, Json> = {
  format: 'openkitcad',
  version: 2,
  units: 'mm',
  parameters: [],
  bindings: [],
  occurrences: [],
  timeline: [],
  marker: null,
  groups: [],
}
const rootKeys = Object.keys(ROOT_DEFAULTS)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_DEPTH = 96

export function shareChecksum(bytes: Uint8Array): number {
  let hash = 2166136261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
  return hash >>> 0
}

class Writer {
  bytes: number[] = []
  integer(value: number) {
    do {
      const next = value % 128
      value = Math.floor(value / 128)
      this.bytes.push(next | (value ? 128 : 0))
    } while (value)
  }
  string(value: string) {
    const bytes = encoder.encode(value)
    this.integer(bytes.length)
    for (const byte of bytes) this.bytes.push(byte)
  }
  value(value: Json, ids: Map<string, number>, depth = 0) {
    if (depth > MAX_DEPTH) throw new Error('Model nesting is too deep.')
    if (value === null) {
      this.bytes.push(0)
      return
    }
    if (typeof value === 'boolean') {
      this.bytes.push(value ? 2 : 1)
      return
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid model number.')
      if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
        this.bytes.push(value < 0 ? 4 : 3)
        this.integer(value < 0 ? -1 - value : value)
      } else {
        this.bytes.push(5)
        const bytes = new Uint8Array(8)
        new DataView(bytes.buffer).setFloat64(0, value, true)
        this.bytes.push(...bytes)
      }
      return
    }
    if (typeof value === 'string') {
      const id = ids.get(value)
      const word = wordCodes.get(value)
      if (id !== undefined) {
        this.bytes.push(7)
        this.integer(id)
      } else if (word !== undefined) {
        this.bytes.push(8)
        this.integer(word)
      } else {
        this.bytes.push(6)
        this.string(value)
      }
      return
    }
    if (Array.isArray(value)) {
      this.bytes.push(9)
      this.integer(value.length)
      for (const child of value) this.value(child, ids, depth + 1)
      return
    }
    const keys = Object.keys(value)
    const schemaIndex = SCHEMAS.findIndex(
      (schema) =>
        value.kind === schema.kind &&
        keys.every((key) => key === 'kind' || schema.keys.includes(key)),
    )
    if (schemaIndex >= 0) {
      const schema = SCHEMAS[schemaIndex]
      this.bytes.push(11)
      this.integer(schemaIndex)
      this.integer(
        schema.keys.reduce(
          (mask, key, index) => mask | (Object.hasOwn(value, key) ? 1 << index : 0),
          0,
        ),
      )
      for (const key of schema.keys)
        if (Object.hasOwn(value, key)) this.value(value[key], ids, depth + 1)
    } else {
      this.bytes.push(10)
      this.integer(keys.length)
      for (const key of keys) {
        const code = keyCodes.get(key) ?? 0
        this.integer(code)
        if (!code) this.string(key)
        this.value(value[key], ids, depth + 1)
      }
    }
  }
}

class Reader {
  offset = 0
  constructor(private bytes: Uint8Array) {}
  byte() {
    if (this.offset >= this.bytes.length) throw new Error('Truncated model.')
    return this.bytes[this.offset++]
  }
  integer() {
    let value = 0
    let factor = 1
    for (let i = 0; i < 8; i++) {
      const byte = this.byte()
      value += (byte & 127) * factor
      if (!Number.isSafeInteger(value)) throw new Error('Invalid model length.')
      if (!(byte & 128)) return value
      factor *= 128
    }
    throw new Error('Invalid model length.')
  }
  count() {
    const count = this.integer()
    if (count > this.bytes.length - this.offset) throw new Error('Invalid model length.')
    return count
  }
  string() {
    const count = this.count()
    const bytes = this.bytes.subarray(this.offset, this.offset + count)
    this.offset += count
    return decoder.decode(bytes)
  }
  value(ids: string[], depth = 0): Json {
    if (depth > MAX_DEPTH) throw new Error('Model nesting is too deep.')
    const tag = this.byte()
    if (tag === 0) return null
    if (tag === 1 || tag === 2) return tag === 2
    if (tag === 3 || tag === 4) {
      const n = this.integer()
      return tag === 3 ? n : -1 - n
    }
    if (tag === 5) {
      if (this.bytes.length - this.offset < 8) throw new Error('Truncated model.')
      const value = new DataView(
        this.bytes.buffer,
        this.bytes.byteOffset + this.offset,
        8,
      ).getFloat64(0, true)
      this.offset += 8
      if (!Number.isFinite(value)) throw new Error('Invalid model number.')
      return value
    }
    if (tag === 6) return this.string()
    if (tag === 7 || tag === 8) {
      const value = (tag === 7 ? ids : WORDS)[this.integer()]
      if (value === undefined) throw new Error('Unknown model reference.')
      return value
    }
    if (tag === 9) {
      const count = this.count()
      return Array.from({ length: count }, () => this.value(ids, depth + 1))
    }
    const out: Record<string, Json> = {}
    const put = (key: string, value: Json) => {
      if (Object.hasOwn(out, key)) throw new Error('Duplicate model field.')
      Object.defineProperty(out, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
    if (tag === 10) {
      const count = this.count()
      for (let i = 0; i < count; i++) {
        const code = this.integer()
        const key = code ? KEYS[code - 1] : this.string()
        if (key === undefined) throw new Error('Unknown model field.')
        put(key, this.value(ids, depth + 1))
      }
    } else if (tag === 11) {
      const schema = SCHEMAS[this.integer()]
      if (!schema) throw new Error('Unknown model operation.')
      const mask = this.integer()
      if (mask >= 2 ** schema.keys.length) throw new Error('Invalid model fields.')
      put('kind', schema.kind)
      schema.keys.forEach((key, index) => {
        if (mask & (1 << index)) put(key, this.value(ids, depth + 1))
      })
    } else throw new Error('Unknown model value.')
    return out
  }
  done() {
    return this.offset === this.bytes.length
  }
}

export function encodeCompactDocument(input: unknown): Uint8Array {
  const doc = input as Record<string, Json>
  const ids = new Map<string, number>()
  const collect = (value: Json, depth = 0) => {
    if (depth > MAX_DEPTH) throw new Error('Model nesting is too deep.')
    if (Array.isArray(value)) value.forEach((child) => collect(child, depth + 1))
    else if (value && typeof value === 'object') {
      if (typeof value.id === 'string' && !ids.has(value.id)) ids.set(value.id, ids.size)
      Object.values(value).forEach((child) => collect(child, depth + 1))
    }
  }
  collect(doc)
  const writer = new Writer()
  writer.integer(ids.size)
  for (const id of ids.keys()) writer.string(id)
  const packed = { ...doc }
  let defaults = 0
  rootKeys.forEach((key, index) => {
    if (JSON.stringify(packed[key]) === JSON.stringify(ROOT_DEFAULTS[key])) {
      defaults |= 1 << index
      delete packed[key]
    }
  })
  writer.integer(defaults)
  writer.value(packed, ids)
  return Uint8Array.from(writer.bytes)
}

export function decodeCompactDocument(bytes: Uint8Array): unknown {
  const reader = new Reader(bytes)
  const count = reader.count()
  const ids = Array.from({ length: count }, () => reader.string())
  const defaults = reader.integer()
  if (defaults >= 2 ** rootKeys.length) throw new Error('Unknown model defaults.')
  const doc = reader.value(ids)
  if (!doc || Array.isArray(doc) || typeof doc !== 'object' || !reader.done())
    throw new Error('Invalid model payload.')
  rootKeys.forEach((key, index) => {
    if (defaults & (1 << index)) {
      if (Object.hasOwn(doc, key)) throw new Error('Duplicate model default.')
      doc[key] = structuredClone(ROOT_DEFAULTS[key])
    }
  })
  return doc
}
