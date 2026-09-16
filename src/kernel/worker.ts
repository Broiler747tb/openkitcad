import * as Comlink from 'comlink'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import wasmUrl from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import {
  cast,
  downcast,
  drawProjection,
  drawRectangle,
  getOC,
  measureDistanceBetween,
  measureVolume,
  setOC,
} from 'replicad'
import type { Component, Matrix4, OkcDocument } from '../doc/types'
import {
  activeFeatures,
  expandInstances,
  findComponent,
  findOccurrence,
  instanceId,
  invertRigidMatrix,
  multiplyMatrices,
  transformPoint,
} from '../doc/model'
import { resolveParameters } from '../doc/parameters'
import { CATEGORY_COLOUR, getPart, setCustomParts, type CataloguePart } from '../catalogue'
import {
  buildPartLocal,
  emptySnapshot,
  evaluateFeature,
  externalInputs,
  transformShape,
  type Snapshot,
} from './build'
import {
  cut as namedCut,
  nameShape,
  releaseNamedShape,
  resolveElement,
  type ElementMap,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import { flattenSvgPaths } from '../export/svgpath'
import type {
  BodyMesh,
  Clash,
  EdgeData,
  EvaluateResult,
  Instance,
  KernelApi,
  KernelError,
  MeshData,
  PreviewRequest,
  PrintOptions,
  PrintWarning,
  ProjectionPlane,
  ProjectionResult,
} from './types'

let ocReady: Promise<void> | null = null

function ensureOC(): Promise<void> {
  if (!ocReady) {
    ocReady = initOpenCascade({ locateFile: () => wasmUrl }).then((OC) => {
      setOC(OC as never)
    })
  }
  return ocReady
}

const MESH_TOLERANCE = 0.02
const MESH_ANGULAR_TOLERANCE = 12
const NEGATIVE_COLOUR = '#4a5560'
const SNAPSHOT_CAP = 128
const TESSELLATION_CAP = 256
const PART_CAP = 64
const CUT_CAP = 128
const NEGATIVE_CUT = '~negative'

function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

function hash(...parts: string[]): string {
  return hashText(parts.join('␞'))
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

class Lru<V> {
  private map = new Map<string, V>()
  constructor(private cap: number) {}
  has(key: string): boolean {
    return this.map.has(key)
  }
  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }
  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
  }
  evict(): V[] {
    const out: V[] = []
    while (this.map.size > this.cap) {
      const key = this.map.keys().next().value as string
      out.push(this.map.get(key)!)
      this.map.delete(key)
    }
    return out
  }
  values(): IterableIterator<V> {
    return this.map.values()
  }
  get size(): number {
    return this.map.size
  }
}

type Bounds = [number, number, number, number, number, number]

interface Tessellation {
  mesh: MeshData
  edges: EdgeData
  volume: number
  bounds: Bounds
}

interface PartSolid {
  shape: any | null
  error?: string
}

type MeshElementKind = 'face' | 'edge'

type ReferenceNames = Record<MeshElementKind, ReadonlyMap<string, string>>

interface MapOwner {
  local: any
  map?: ElementMap<OcShape>
}

interface CutEntry {
  world: any
  local: any
  map?: ElementMap<OcShape>
  references?: ReferenceNames
  failures: string[]
}

interface LiveInstance {
  instance: Instance
  label: string
  name: string
  colour: string
  featureId: string
  ancestorsVisible: boolean
  local: any
  world: any | null
  map?: ElementMap<OcShape>
  references?: ReferenceNames
}

const snapshots = new Lru<Snapshot>(SNAPSHOT_CAP)
const tessellations = new Lru<Tessellation>(TESSELLATION_CAP)
const partSolids = new Lru<PartSolid>(PART_CAP)
const cuts = new Lru<CutEntry>(CUT_CAP)
let live = new Map<string, LiveInstance>()
let liveSnapshot: Snapshot | null = null
const localBounds = new WeakMap<object, Bounds>()

function snapshotShapes(snapshot: Snapshot): any[] {
  return [
    ...[...snapshot.bodies.values()].map((body) => body.shape),
    ...[...snapshot.preShell.values()].map((entry) => entry.shape),
  ]
}

function liveShapes(instances: Map<string, LiveInstance>): any[] {
  return [...instances.values()].flatMap((entry) => [entry.local, entry.world])
}

function snapshotOwners(snapshot: Snapshot): MapOwner[] {
  return [...snapshot.bodies.values()].map((body) => ({ local: body.shape, map: body.map }))
}

function release(candidates: any[], owners: MapOwner[] = []): void {
  if (!candidates.length && !owners.length) return
  const held = new Set<any>()
  for (const snapshot of snapshots.values())
    for (const shape of snapshotShapes(snapshot)) held.add(shape)
  if (liveSnapshot) for (const shape of snapshotShapes(liveSnapshot)) held.add(shape)
  for (const shape of liveShapes(live)) held.add(shape)
  for (const solid of partSolids.values()) held.add(solid.shape)
  for (const cut of cuts.values()) {
    held.add(cut.world)
    held.add(cut.local)
  }
  for (const shape of new Set(candidates)) {
    if (!shape || held.has(shape)) continue
    try {
      shape.delete()
    } catch {
      continue
    }
  }
  const disposed = new Set<ElementMap<OcShape>>()
  for (const { local, map } of owners) {
    if (!map || disposed.has(map) || held.has(local)) continue
    disposed.add(map)
    try {
      map.dispose()
    } catch {
      continue
    }
  }
}

function referenceName(
  kind: MeshElementKind,
  shape: OcShape,
  map?: ElementMap<OcShape>,
  references?: ReferenceNames,
): string {
  const name = map?.nameOf(kind, shape)
  if (name === undefined) return ''
  return references ? (references[kind].get(name) ?? '') : name
}

function tessellate(
  shape: any,
  map?: ElementMap<OcShape>,
  references?: ReferenceNames,
): Tessellation {
  const raw = shape.mesh({ tolerance: MESH_TOLERANCE, angularTolerance: MESH_ANGULAR_TOLERANCE })
  const rawEdges = shape.meshEdges({ keepMesh: true })
  const rawFaceGroups: any[] = raw.faceGroups ?? []
  const faceNames: string[] = []
  const edgeNames = new Map<number, string>()
  if (map) {
    const faces = shape.faces
    let next = 0
    for (const group of rawFaceGroups) {
      let at = next
      while (at < faces.length && faces[at].hashCode !== group.faceId) at++
      if (at < faces.length) {
        faceNames.push(referenceName('face', faces[at].wrapped, map, references))
        next = at + 1
      } else {
        faceNames.push('')
      }
    }
    for (const edge of shape.edges) {
      edgeNames.set(edge.hashCode, referenceName('edge', edge.wrapped, map, references))
    }
  }
  const mesh: MeshData = {
    vertices: new Float32Array(raw.vertices),
    triangles: new Uint32Array(raw.triangles),
    normals: new Float32Array(raw.normals),
    faceGroups: rawFaceGroups.map((g: any, index: number) => ({
      start: g.start,
      count: g.count,
      faceId: g.faceId,
      name: faceNames[index] ?? '',
    })),
  }
  const edges: EdgeData = {
    lines: new Float32Array(rawEdges.lines),
    edgeGroups: (rawEdges.edgeGroups ?? []).map((g: any) => ({
      start: g.start,
      count: g.count,
      edgeId: g.edgeId,
      name: edgeNames.get(g.edgeId) ?? '',
    })),
  }
  let volume = 0
  try {
    volume = measureVolume(shape)
  } catch {
    volume = 0
  }
  return { mesh, edges, volume, bounds: boundsOf(shape) }
}

function boundsOf(shape: any): Bounds {
  const cached = localBounds.get(shape)
  if (cached) return cached
  const [min, max] = shape.boundingBox.bounds
  const bounds: Bounds = [min[0], min[1], min[2], max[0], max[1], max[2]]
  localBounds.set(shape, bounds)
  return bounds
}

function worldBounds(shape: any, matrix: Matrix4): Bounds {
  const [x0, y0, z0, x1, y1, z1] = boundsOf(shape)
  const out: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const p = transformPoint(matrix, [x, y, z])
        for (let i = 0; i < 3; i++) {
          out[i] = Math.min(out[i], p[i])
          out[i + 3] = Math.max(out[i + 3], p[i])
        }
      }
    }
  }
  return out
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5]
  )
}

function cutNegatives(target: LiveInstance, cutters: LiveInstance[]): CutEntry {
  const oc = getOC() as unknown as OC
  const timeline = target.map
  const failures: string[] = []
  const inverse = invertRigidMatrix(target.instance.matrix)
  const splitFrom: Record<MeshElementKind, Map<string, string>> = {
    face: new Map(),
    edge: new Map(),
  }
  let current: NamedShape | null = null
  let local = target.local
  cutters.forEach((cutter, index) => {
    const placed = transformShape(cutter.local, multiplyMatrices(inverse, cutter.instance.matrix))
    let tool: NamedShape | null = null
    try {
      if (!timeline) {
        const next = local.cut(placed)
        if (local !== target.local) local.delete()
        local = next
        return
      }
      tool = nameShape(
        oc,
        `${NEGATIVE_CUT}:${index}`,
        downcast(placed.wrapped) as unknown as OcShape,
      )
      const next = namedCut(oc, {
        featureId: NEGATIVE_CUT,
        target: current ?? { shape: target.local.wrapped, map: timeline },
        tools: [tool],
      })
      for (const kind of ['face', 'edge'] as const) {
        for (const [name, retirement] of next.map.retired(kind)) {
          if (retirement.reason !== 'split' || retirement.featureId !== NEGATIVE_CUT) continue
          const root = splitFrom[kind].get(name) ?? name
          for (const child of retirement.children) splitFrom[kind].set(child, root)
        }
      }
      if (current) releaseNamedShape(current)
      current = next
    } catch (e) {
      failures.push((e as Error)?.message ?? 'unknown failure')
    } finally {
      if (tool) releaseNamedShape(tool)
      placed.delete()
    }
  })

  if (!current) {
    return {
      world: transformShape(local, target.instance.matrix),
      local,
      map: local === target.local ? timeline : undefined,
      failures,
    }
  }

  const named: NamedShape = current
  const references: ReferenceNames = { face: new Map(), edge: new Map() }
  for (const kind of ['face', 'edge'] as const) {
    const table = references[kind] as Map<string, string>
    for (const element of named.map.elements(kind)) {
      const reference = [element.name, ...element.aliases]
        .map((name) => splitFrom[kind].get(name) ?? name)
        .find((name) => resolveElement(timeline, { bodyId: target.instance.bodyId, kind, name }).ok)
      table.set(element.name, reference ?? '')
    }
  }
  const cutLocal = cast(named.shape)
  named.shape.delete()
  return {
    world: transformShape(cutLocal, target.instance.matrix),
    local: cutLocal,
    map: named.map,
    references,
    failures,
  }
}

function worldOf(entry: LiveInstance): any {
  if (!entry.world) entry.world = transformShape(entry.local, entry.instance.matrix)
  return entry.world
}

function catalogueSolid(
  component: Component,
  errors: KernelError[],
): { shape: any; key: string; part: CataloguePart } | null {
  if (component.source.kind !== 'catalogue') return null
  const { partId, overrides } = component.source
  const part = getPart(partId)
  if (!part) return null
  const key = hash('part', partId, canonicalJson(overrides ?? null), canonicalJson(part))
  let entry = partSolids.get(key)
  if (!entry) {
    try {
      entry = { shape: buildPartLocal(part, overrides) ?? null }
    } catch (e) {
      entry = { shape: null, error: (e as Error)?.message ?? 'unknown failure' }
    }
    partSolids.set(key, entry)
  }
  if (entry.error) {
    errors.push({
      featureId: component.id,
      bodyId: component.id,
      severity: 'error',
      message: `Could not build "${component.name}": ${entry.error}`,
      hint: 'This is a problem with the catalogue part, not with your design.',
    })
  }
  return entry.shape ? { shape: entry.shape, key, part } : null
}

interface Pipeline {
  result: EvaluateResult
  transfer: Transferable[]
  live: Map<string, LiveInstance>
  snapshot: Snapshot
  evicted: any[]
  evictedOwners: MapOwner[]
}

function run(doc: OkcDocument, knownMeshKeys: string[], preview: boolean): Pipeline {
  const t0 = performance.now()
  setCustomParts(doc.customParts ?? [])

  const features = activeFeatures(doc)
  const position = new Map(features.map((feature, i) => [feature.id, i]))
  const rootKey = hash('openkitcad', canonicalJson(doc.customParts ?? []))
  const keys: string[] = []
  let chain = rootKey
  for (const feature of features) {
    chain = hash(chain, canonicalJson(feature), canonicalJson(externalInputs(doc, feature)))
    keys.push(chain)
  }

  let start = -1
  for (let i = keys.length - 1; i >= 0; i--) {
    if (snapshots.has(keys[i])) {
      start = i
      break
    }
  }
  let snapshot = start >= 0 ? snapshots.get(keys[start])! : emptySnapshot(rootKey)
  let misses = 0
  for (let i = start + 1; i < features.length; i++) {
    const index = i
    snapshot = evaluateFeature(
      { doc, available: (id) => (position.get(id) ?? Infinity) < index },
      features[i],
      keys[i],
      snapshot,
    )
    snapshots.set(keys[i], snapshot)
    misses++
  }

  const errors: KernelError[] = [...snapshot.errors]
  const built = new Map<string, LiveInstance>()

  for (const node of expandInstances(doc)) {
    const component = findComponent(doc, node.componentId)
    if (!component) continue
    const occurrenceName = node.path.length
      ? findOccurrence(doc, node.path[node.path.length - 1])?.name
      : undefined
    if (component.source.kind === 'catalogue') {
      const solid = catalogueSolid(component, errors)
      if (!solid) continue
      const id = instanceId(node.path, component.id)
      built.set(id, {
        instance: {
          id,
          kind: 'catalogue',
          path: node.path,
          componentId: component.id,
          bodyId: component.id,
          meshKey: solid.key,
          matrix: node.matrix,
          visible: node.visible,
          negative: node.negative,
        },
        label: occurrenceName ?? component.name,
        name: component.name,
        colour: CATEGORY_COLOUR[solid.part.category] ?? '#7f878f',
        featureId: component.id,
        ancestorsVisible: node.visible,
        local: solid.shape,
        world: null,
      })
      continue
    }
    for (const body of component.bodies) {
      const state = snapshot.bodies.get(body.id)
      if (!state) continue
      const id = instanceId(node.path, body.id)
      built.set(id, {
        instance: {
          id,
          kind: 'body',
          path: node.path,
          componentId: component.id,
          bodyId: body.id,
          meshKey: hash(state.key, body.id),
          matrix: node.matrix,
          visible: node.visible && body.visible,
          negative: node.negative || !!body.negative,
        },
        label: occurrenceName ? `${occurrenceName} / ${body.name}` : body.name,
        name: body.name,
        colour: body.negative ? NEGATIVE_COLOUR : body.colour,
        featureId: state.featureId,
        ancestorsVisible: node.visible,
        local: state.shape,
        world: null,
        map: state.map,
      })
    }
  }

  const cutters = [...built.values()].filter(
    (entry) => entry.instance.negative && entry.ancestorsVisible,
  )
  if (cutters.length) {
    const cutterBounds = cutters.map((entry) => worldBounds(entry.local, entry.instance.matrix))
    for (const target of built.values()) {
      if (target.instance.negative || target.instance.kind !== 'body') continue
      const box = worldBounds(target.local, target.instance.matrix)
      const hits = cutters.filter((_, i) => boundsOverlap(box, cutterBounds[i]))
      if (!hits.length) continue
      const cutKey = hash(
        'cut',
        target.instance.meshKey,
        canonicalJson(target.instance.matrix),
        ...hits.map((c) => `${c.instance.meshKey}@${canonicalJson(c.instance.matrix)}`),
      )
      let entry = cuts.get(cutKey)
      if (!entry) {
        entry = cutNegatives(target, hits)
        cuts.set(cutKey, entry)
      }
      for (const failure of entry.failures) {
        errors.push({
          featureId: target.featureId,
          bodyId: target.instance.bodyId,
          severity: 'error',
          message: `Could not cut a hole out of "${target.name}": ${failure}`,
          hint: 'The hole may not overlap this part, or may cut it clean in two.',
        })
      }
      target.instance.meshKey = cutKey
      target.local = entry.local
      target.world = entry.world
      target.map = entry.map
      target.references = entry.references
    }
  }

  const known = new Set(knownMeshKeys)
  const sent = new Set<string>()
  const broken = new Set<string>()
  const meshes: BodyMesh[] = []
  const transfer: Transferable[] = []
  for (const entry of built.values()) {
    const key = entry.instance.meshKey
    if (known.has(key) || sent.has(key) || broken.has(key)) continue
    let tessellation = tessellations.get(key)
    if (!tessellation) {
      try {
        tessellation = tessellate(entry.local, entry.map, entry.references)
        tessellations.set(key, tessellation)
      } catch (e) {
        broken.add(key)
        errors.push({
          featureId: entry.featureId,
          bodyId: entry.instance.bodyId,
          severity: 'error',
          message: `Built, but could not be displayed: ${(e as Error)?.message}`,
        })
        continue
      }
    }
    sent.add(key)
    const mesh: MeshData = {
      vertices: tessellation.mesh.vertices.slice(),
      triangles: tessellation.mesh.triangles.slice(),
      normals: tessellation.mesh.normals.slice(),
      faceGroups: tessellation.mesh.faceGroups.map((group) => ({ ...group })),
    }
    const edges: EdgeData = {
      lines: tessellation.edges.lines.slice(),
      edgeGroups: tessellation.edges.edgeGroups.map((group) => ({ ...group })),
    }
    transfer.push(
      mesh.vertices.buffer,
      mesh.triangles.buffer,
      mesh.normals.buffer,
      edges.lines.buffer,
    )
    meshes.push({
      key,
      bodyId: entry.instance.bodyId,
      componentId: entry.instance.componentId,
      name: entry.name,
      colour: entry.colour,
      mesh,
      edges,
      volume: tessellation.volume,
      bounds: [...tessellation.bounds],
    })
  }

  const instances: Instance[] = []
  for (const [id, entry] of built) {
    if (broken.has(entry.instance.meshKey)) {
      built.delete(id)
      continue
    }
    instances.push(preview ? { ...entry.instance, preview: true } : { ...entry.instance })
  }

  const evictedSnapshots = snapshots.evict()
  const evictedCuts = cuts.evict()
  const evictedOwners: MapOwner[] = [
    ...evictedSnapshots.flatMap(snapshotOwners),
    ...evictedCuts.map((entry) => ({ local: entry.local, map: entry.map })),
  ]
  const evicted = [
    ...evictedSnapshots.flatMap(snapshotShapes),
    ...partSolids.evict().map((solid) => solid.shape),
    ...evictedCuts.flatMap((entry) => [entry.world, entry.local]),
  ]
  tessellations.evict()

  return {
    result: {
      meshes,
      instances,
      errors,
      elapsedMs: Math.round(performance.now() - t0),
      cache: { hits: start + 1, misses, entries: snapshots.size },
      planes: [...snapshot.planes].map(([featureId, frame]) => ({ featureId, frame })),
    },
    transfer,
    live: built,
    snapshot,
    evicted,
    evictedOwners,
  }
}
function requireWorld(id: string): any {
  const entry = live.get(id)
  if (!entry) throw new Error('That shape is not built.')
  return worldOf(entry)
}

function overlapOf(a: any, b: any): { volume: number; at: [number, number, number] } | null {
  try {
    const common = a.clone().intersect(b.clone())
    const volume = measureVolume(common)
    if (!(volume > 0.5)) return null
    const [min, max] = common.boundingBox.bounds
    return {
      volume,
      at: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    }
  } catch {
    return null
  }
}

function colourChannels(hex: string): [number, number, number] {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '7f878f'
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
}

function writeStep(parts: Array<{ shape: any; name: string; colour: string }>): ArrayBuffer {
  const oc = getOC() as any
  const owned: Array<{ delete(): void }> = []
  const own = <T extends { delete(): void }>(value: T): T => {
    owned.push(value)
    return value
  }
  const filename = `/export-${Date.now()}.step`
  try {
    const format = own(new oc.TCollection_ExtendedString_2('XmlOcaf', true))
    const document = own(new oc.Handle_TDocStd_Document_2(new oc.TDocStd_Document(format)))
    oc.XCAFDoc_ShapeTool.SetAutoNaming(false)
    const main = own(document.get().Main())
    const shapes = own(oc.XCAFDoc_DocumentTool.ShapeTool(main))
    const colours = own(oc.XCAFDoc_DocumentTool.ColorTool(main))
    for (const part of parts) {
      const label = own(shapes.get().NewShape())
      shapes.get().SetShape(label, part.shape.wrapped)
      own(oc.TDataStd_Name.Set_1(label, own(new oc.TCollection_ExtendedString_2(part.name, true))))
      const [r, g, b] = colourChannels(part.colour)
      colours
        .get()
        .SetColor_3(
          label,
          own(new oc.Quantity_ColorRGBA_5(r, g, b, 1)),
          oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf,
        )
    }
    shapes.get().UpdateAssemblies()
    const writer = own(new oc.STEPCAFControl_Writer_1())
    writer.SetColorMode(true)
    writer.SetLayerMode(true)
    writer.SetNameMode(true)
    oc.Interface_Static.SetIVal('write.surfacecurve.mode', 1)
    oc.Interface_Static.SetIVal('write.precision.mode', 0)
    oc.Interface_Static.SetIVal('write.step.assembly', 2)
    oc.Interface_Static.SetIVal('write.step.schema', 5)
    const progress = own(new oc.Message_ProgressRange_1())
    writer.Transfer_1(document, oc.STEPControl_StepModelType.STEPControl_AsIs, null, progress)
    if (writer.Write(filename) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error('The STEP file could not be written.')
    }
    const bytes: Uint8Array = oc.FS.readFile(filename)
    return bytes.slice().buffer
  } finally {
    if (oc.FS.analyzePath(filename).exists) oc.FS.unlink(filename)
    for (const value of owned.reverse()) value.delete()
  }
}

function projectedPaths(shape: any, plane: ProjectionPlane): string[] {
  const paths = drawProjection(shape, plane).visible.toSVGPaths()
  return Array.isArray(paths[0]) ? (paths as string[][]).flat() : (paths as string[])
}

const api: KernelApi = {
  async ready(): Promise<boolean> {
    await ensureOC()
    return true
  },

  async evaluate(doc: OkcDocument, knownMeshKeys: string[]): Promise<EvaluateResult> {
    await ensureOC()
    const resolved = structuredClone(doc)
    resolveParameters(resolved)
    const out = run(resolved, knownMeshKeys, false)
    const previous = live
    live = out.live
    liveSnapshot = out.snapshot
    release([...out.evicted, ...liveShapes(previous)], [...out.evictedOwners, ...previous.values()])
    return Comlink.transfer(out.result, out.transfer)
  },

  async preview(request: PreviewRequest, knownMeshKeys: string[]): Promise<EvaluateResult> {
    await ensureOC()
    const doc = structuredClone(request.doc)
    const insertAt = Math.max(0, Math.min(request.insertAt, doc.timeline.length))
    const prefix = doc.timeline
      .slice(0, insertAt)
      .filter((feature) => feature.id !== request.replaceFeatureId)
    doc.timeline = [...prefix, ...structuredClone(request.features)]
    doc.marker = null
    doc.groups = []
    resolveParameters(doc, true)
    const out = run(doc, knownMeshKeys, true)
    release([...out.evicted, ...liveShapes(out.live)], [...out.evictedOwners, ...out.live.values()])
    return Comlink.transfer(out.result, out.transfer)
  },

  async exportStep(instanceIds: string[], name: string): Promise<ArrayBuffer> {
    await ensureOC()
    const parts = instanceIds
      .filter((id) => live.has(id))
      .map((id) => ({
        shape: requireWorld(id),
        name: `${name}-${live.get(id)!.label}`,
        colour: live.get(id)!.colour,
      }))
    if (parts.length === 0) throw new Error('Nothing to export.')
    return writeStep(parts)
  },

  async meshOf(instanceId: string): Promise<MeshData> {
    await ensureOC()
    const raw = requireWorld(instanceId).mesh({
      tolerance: MESH_TOLERANCE / 2,
      angularTolerance: MESH_ANGULAR_TOLERANCE / 2,
    })
    return {
      vertices: new Float32Array(raw.vertices),
      triangles: new Uint32Array(raw.triangles),
      normals: new Float32Array(raw.normals),
      faceGroups: [],
    }
  },

  async project(instanceId: string, plane: ProjectionPlane = 'XY'): Promise<ProjectionResult> {
    await ensureOC()
    return flattenSvgPaths(projectedPaths(requireWorld(instanceId), plane))
  },

  async debugProjectPaths(instanceId: string, plane: ProjectionPlane = 'XY'): Promise<string[]> {
    await ensureOC()
    return projectedPaths(requireWorld(instanceId), plane)
  },

  async clearance(doc: OkcDocument): Promise<Clash[]> {
    await ensureOC()
    const clashes: Clash[] = []
    const push = (aLabel: string, bLabel: string, hit: ReturnType<typeof overlapOf>) => {
      if (hit) clashes.push({ aLabel, bLabel, overlap: Math.cbrt(hit.volume), at: hit.at })
    }

    const keepouts: Array<{ label: string; solid: any }> = []
    for (const node of expandInstances(doc)) {
      if (!node.visible) continue
      const component = findComponent(doc, node.componentId)
      if (component?.source.kind !== 'catalogue') continue
      const part = getPart(component.source.partId)
      const owner = node.path.length
        ? (findOccurrence(doc, node.path[node.path.length - 1])?.name ?? component.name)
        : component.name
      for (const k of part?.keepouts ?? []) {
        try {
          const box = drawRectangle(k.w, k.h)
            .translate(k.x + k.w / 2, k.y + k.h / 2)
            .sketchOnPlane('XY', k.z)
            .extrude(k.height)
          keepouts.push({ label: `${owner} - ${k.label}`, solid: transformShape(box, node.matrix) })
        } catch {
          continue
        }
      }
    }

    const entries = [...live.values()]
    const bodies = entries.filter((entry) => entry.instance.kind === 'body')
    for (const keepout of keepouts) {
      for (const body of bodies)
        push(keepout.label, body.label, overlapOf(keepout.solid, worldOf(body)))
    }

    const pairs = (list: LiveInstance[], skip: (a: LiveInstance, b: LiveInstance) => boolean) => {
      const boxes = list.map((entry) => worldBounds(entry.local, entry.instance.matrix))
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (skip(list[i], list[j]) || !boundsOverlap(boxes[i], boxes[j])) continue
          push(list[i].label, list[j].label, overlapOf(worldOf(list[i]), worldOf(list[j])))
        }
      }
    }
    pairs(
      entries.filter((entry) => entry.instance.kind === 'catalogue' && entry.instance.visible),
      () => false,
    )
    pairs(
      bodies.filter((entry) => entry.instance.visible && !entry.instance.negative),
      (a, b) => a.instance.path.join('/') === b.instance.path.join('/'),
    )
    return clashes
  },

  async printPrep(instanceIds: string[], options: PrintOptions): Promise<PrintWarning[]> {
    await ensureOC()
    const out: PrintWarning[] = []
    for (const id of instanceIds) {
      const entry = live.get(id)
      if (!entry) continue
      const shape = worldOf(entry)
      const name = entry.label
      const warn = (severity: PrintWarning['severity'], message: string, hint?: string) =>
        out.push(
          hint
            ? { instanceId: id, name, severity, message, hint }
            : { instanceId: id, name, severity, message },
        )
      const [min, max] = shape.boundingBox.bounds
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

      const fitsFlat = size[0] <= options.bed[0] && size[1] <= options.bed[1]
      const fitsTurned = size[1] <= options.bed[0] && size[0] <= options.bed[1]
      if (!fitsFlat && !fitsTurned) {
        warn(
          'error',
          `Too big for the print bed: ${size[0].toFixed(0)} x ${size[1].toFixed(0)} mm against a ${options.bed[0]} x ${options.bed[1]} mm bed.`,
          'Split it into pieces, or set a larger bed size.',
        )
      } else if (!fitsFlat) {
        warn('info', 'Only fits if you rotate it 90 degrees on the bed.')
      }
      if (size[2] > options.bed[2]) {
        warn(
          'error',
          `Taller than the printer allows: ${size[2].toFixed(0)} mm against ${options.bed[2]} mm.`,
        )
      }

      const raw = shape.mesh({ tolerance: 0.05, angularTolerance: 20 })
      let downwardArea = 0
      let totalArea = 0
      let flatBottomArea = 0
      const v = raw.vertices
      for (let t = 0; t < raw.triangles.length; t += 3) {
        const a = raw.triangles[t] * 3
        const b = raw.triangles[t + 1] * 3
        const c = raw.triangles[t + 2] * 3
        const ux = v[b] - v[a]
        const uy = v[b + 1] - v[a + 1]
        const uz = v[b + 2] - v[a + 2]
        const wx = v[c] - v[a]
        const wy = v[c + 1] - v[a + 1]
        const wz = v[c + 2] - v[a + 2]
        const nx = uy * wz - uz * wy
        const ny = uz * wx - ux * wz
        const nz = ux * wy - uy * wx
        const len = Math.hypot(nx, ny, nz)
        if (len < 1e-9) continue
        const area = len / 2
        totalArea += area
        if (-nz / len > 0.7071) {
          const lowest = Math.min(v[a + 2], v[b + 2], v[c + 2])
          if (lowest - min[2] < 0.05) flatBottomArea += area
          else downwardArea += area
        }
      }

      if (totalArea > 0 && downwardArea / totalArea > 0.06) {
        warn(
          'warning',
          `About ${Math.round((downwardArea / totalArea) * 100)}% of the surface overhangs and would need supports.`,
          'Turning the part over, or adding a chamfer instead of an overhang, often removes the need entirely.',
        )
      }
      if (flatBottomArea < 1) {
        warn(
          'warning',
          'Nothing flat is touching the bed.',
          'Parts print far better with a flat face down. Try a different orientation.',
        )
      }

      const volume = measureVolume(shape)
      if (totalArea > 0 && volume > 0) {
        const estimated = (2 * volume) / totalArea
        if (estimated < options.nozzle * 2) {
          warn(
            'warning',
            `Average wall works out around ${estimated.toFixed(1)} mm, which is thin for a ${options.nozzle} mm nozzle.`,
            'This is an estimate from volume against surface area, so check the thinnest wall yourself. Aim for at least two nozzle widths.',
          )
        }
      }
    }
    return out
  },

  async distanceBetween(a: string, b: string): Promise<number | null> {
    await ensureOC()
    const first = live.get(a)
    const second = live.get(b)
    if (!first || !second) return null
    try {
      return measureDistanceBetween(worldOf(first), worldOf(second))
    } catch {
      return null
    }
  },

  async selfTest(): Promise<{ triangles: number; volume: number; faces: number }> {
    await ensureOC()
    const solid = drawRectangle(40, 30).sketchOnPlane('XY').extrude(10)
    const result = tessellate(solid)
    return {
      triangles: result.mesh.triangles.length / 3,
      volume: result.volume,
      faces: result.mesh.faceGroups.length,
    }
  },
}

Comlink.expose(api)
