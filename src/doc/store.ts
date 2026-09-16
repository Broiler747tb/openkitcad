import type { SketchToolId } from '../sketch/tools/types'
import { trimEntity } from '../sketch/modify'
import { offsetChains } from '../sketch/offset'
import type { ConstraintToolId } from '../sketch/constraintTools'
import { create } from 'zustand'
import { resolveParameters } from './parameters'
import type { BodyMesh, EvaluateResult, Instance, KernelError } from '../kernel/types'
import { requestBuild } from '../kernel/api'
import {
  emptyDocument,
  type Body,
  type Component,
  type Feature,
  type LengthUnit,
  type Matrix4,
  type Occurrence,
  type OkcDocument,
  type PlaneRef,
  type SketchFeature,
} from './types'
import {
  canMoveFeature,
  timelineGroups,
  childOccurrences,
  expandInstances,
  featureCreatesBodies,
  featureDependents,
  featureIndex,
  featureModifiesBodies,
  featureReadsBodies,
  findBody,
  findComponent,
  findFeature,
  findOccurrence,
  identityMatrix,
  markerIndex,
  multiplyMatrices,
  parseInstanceId,
  translationMatrix,
  wouldCreateCycle,
} from './model'
import { emptySketch, type Constraint, type NewConstraint, type Sketch2D } from '../sketch/types'
import { applySolve, solveSketch, type SolveResult } from '../sketch/solver'
import type { SketchTarget } from '../sketch/inference'
import type { SubPick } from '../viewport/engine'
import type { ActionResult } from '../sketch/actions'
import { chamferCorner, filletBetween, filletCorner, type CornerResult } from '../sketch/corner'
import { addPolygon, addSlot, circularPattern, linearPattern, mirrorEntities } from '../sketch/edit'
import { getPart, userParts } from '../catalogue'
import { planHole, planPillar } from '../fasteners'
import { v3, type Frame, type Vec3 } from '../core/math'
import { frameFromPlaneRefLocal } from './planes'
import { lengthLabel } from '../core/units'
import { worldBounds, type Bounds } from './placement'

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const DEFAULT_BODY_COLOUR = '#b9c0c7'

export type ToolId =
  | SketchToolId
  | `constrain:${ConstraintToolId}`
  | 'select'
  | 'dimension'
  | 'trim'
  | 'extend'
  | 'break'
  | 'sketchFillet'
  | 'mirror'
  | 'circularPattern'
  | 'measure'

export interface Selection {
  kind: 'none' | 'body' | 'occurrence' | 'feature' | 'face' | 'edge'
  id?: string
  instanceId?: string
}

export interface ActiveSketch {
  featureId: string
  componentId: string
}

export interface SectionState {
  enabled: boolean
  axis: 'x' | 'y' | 'z'
  position: number
  flipped: boolean
}

interface AppState {
  doc: OkcDocument
  past: OkcDocument[]
  future: OkcDocument[]

  meshes: Map<string, BodyMesh>
  instances: Instance[]
  planes: ReadonlyMap<string, Frame>
  errors: KernelError[]
  buildMs: number
  building: boolean
  busy: string | null
  setBusy: (busy: string | null) => void
  kernelReady: boolean

  selection: Selection
  hovered: string | null
  tool: ToolId
  activeComponentId: string
  activeSketch: ActiveSketch | null
  sketchStatus: {
    dof: number
    failing: string[]
    closed: boolean
    freePoints: string[]
    freeRadii: string[]
    freeEntities: string[]
  } | null

  section: SectionState
  showPlacements: boolean
  showFasteners: boolean
  setShowFasteners: (show: boolean) => void
  statusMessage: string | null

  setDoc: (doc: OkcDocument, resetHistory?: boolean) => void
  commit: (
    fn: (draft: OkcDocument) => void,
    opts?: { transient?: boolean; mergeKey?: string },
  ) => void
  undo: () => void
  redo: () => void
  rebuild: () => void
  setKernelReady: (ready: boolean) => void

  setTool: (tool: ToolId) => void
  select: (selection: Selection) => void
  setHovered: (id: string | null) => void
  setStatus: (message: string | null) => void
  measure: { a: [number, number, number] | null; b: [number, number, number] | null }
  addMeasurePoint: (point: [number, number, number]) => void
  clearMeasure: () => void
  setSection: (patch: Partial<SectionState>) => void
  setShowPlacements: (show: boolean) => void

  setUnits: (units: LengthUnit) => void
  activateComponent: (componentId: string) => void
  createComponent: (name?: string) => string
  linkedCopy: (occurrenceId: string, offset?: Vec3) => string | null
  insertCatalogue: (partId: string, position?: Vec3) => string
  updateOccurrence: (
    id: string,
    patch: Partial<Omit<Occurrence, 'id'>>,
    opts?: { transient?: boolean },
  ) => void
  removeOccurrence: (id: string) => void
  updateComponent: (id: string, patch: Partial<Pick<Component, 'name' | 'source'>>) => void

  updateBody: (bodyId: string, patch: Partial<Omit<Body, 'id'>>) => void
  removeBody: (bodyId: string) => void
  addFeature: (feature: Feature, bodies?: Record<string, Partial<Body>>) => void
  addFeatures: (features: Feature[], bodies?: Record<string, Partial<Body>>) => void
  updateFeature: (
    featureId: string,
    patch: Partial<Feature>,
    opts?: { transient?: boolean },
  ) => void
  replaceFeature: (featureId: string, features: Feature[]) => void
  removeFeature: (featureId: string, opts?: { withDependents?: boolean }) => boolean
  moveFeature: (featureId: string, toIndex: number) => boolean
  setMarker: (index: number | null) => void
  groupSteps: (firstId: string, lastId: string) => string | null
  ungroup: (groupId: string) => void
  toggleGroup: (groupId: string) => void

  gizmoMode: 'translate' | 'rotate'
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  transientBase: OkcDocument | null
  beginTransient: () => void
  endTransient: () => void

  startSketch: (plane: PlaneRef, bodyId?: string) => void
  openSketch: (featureId: string) => void
  closeSketch: () => void
  editSketch: (fn: (sketch: Sketch2D) => void, opts?: { transient?: boolean }) => void
  solveActiveSketch: (drag?: { point: string; x: number; y: number }) => SolveResult | null
  addConstraint: (constraint: NewConstraint) => void

  subSelection: SubPick[]
  setSubSelection: (picks: SubPick[]) => void

  sketchSelection: SketchTarget[]
  setSketchSelection: (selection: SketchTarget[]) => void
  applySketchAction: (result: ActionResult) => void
}

export type StoreState = AppState

const HISTORY_LIMIT = 80
let statusTimer: number | undefined
const MERGE_WINDOW_MS = 900
let lastMerge: { key: string; at: number } | null = null
let buildTicket = 0
const sketchTargets = new Map<string, string>()

function clone<T>(v: T): T {
  return structuredClone(v)
}

export function insertFeatures(
  doc: OkcDocument,
  features: Feature[],
  bodies: Record<string, Partial<Body>> = {},
): void {
  const at = markerIndex(doc)
  doc.timeline.splice(at, 0, ...features)
  if (doc.marker !== null) doc.marker = at + features.length
  addCreatedBodies(doc, features, bodies)
}

export function addCreatedBodies(
  doc: OkcDocument,
  features: Feature[],
  bodies: Record<string, Partial<Body>> = {},
): void {
  for (const feature of features) {
    const component = findComponent(doc, feature.componentId)
    if (!component) continue
    for (const bodyId of featureCreatesBodies(feature)) {
      if (findBody(doc, bodyId)) continue
      component.bodies.push({
        name: nextBodyName(doc),
        visible: true,
        colour: DEFAULT_BODY_COLOUR,
        ...bodies[bodyId],
        id: bodyId,
      })
    }
  }
}

export function replaceFeatureInDocument(
  doc: OkcDocument,
  featureId: string,
  features: Feature[],
): void {
  const index = featureIndex(doc, featureId)
  if (index < 0) return
  const before = featureCreatesBodies(doc.timeline[index])
  doc.timeline.splice(index, 1, ...features)
  if (doc.marker !== null && doc.marker > index) doc.marker += features.length - 1
  const kept = new Set(features.flatMap(featureCreatesBodies))
  for (const bodyId of before) {
    if (kept.has(bodyId)) continue
    for (const component of doc.components) {
      component.bodies = component.bodies.filter((body) => body.id !== bodyId)
    }
  }
  const replacement = features.find((feature) => feature.id === featureId)
  doc.bindings = doc.bindings.filter(
    (link) =>
      link.featureId !== featureId ||
      (!!replacement &&
        typeof (replacement as unknown as Record<string, unknown>)[link.field] === 'number'),
  )
  addCreatedBodies(doc, features)
}

export function nextBodyName(doc: OkcDocument, base = 'Body'): string {
  const names = new Set(doc.components.flatMap((c) => c.bodies.map((b) => b.name)))
  let n = doc.components.reduce((sum, c) => sum + c.bodies.length, 0) + 1
  while (names.has(`${base}${n}`)) n++
  return `${base}${n}`
}

export function dependentClosure(doc: OkcDocument, ids: Iterable<string>): Set<string> {
  const out = new Set<string>(ids)
  const stack = [...out]
  while (stack.length) {
    const id = stack.pop()!
    for (const dependent of featureDependents(doc, id)) {
      if (out.has(dependent.id)) continue
      out.add(dependent.id)
      stack.push(dependent.id)
    }
  }
  return out
}

export function deleteFeatures(doc: OkcDocument, ids: Set<string>): void {
  if (!ids.size) return
  const bodies = new Set<string>()
  let before = 0
  doc.timeline.forEach((feature, index) => {
    if (!ids.has(feature.id)) return
    for (const bodyId of featureCreatesBodies(feature)) bodies.add(bodyId)
    if (doc.marker !== null && index < doc.marker) before++
  })
  doc.timeline = doc.timeline.filter((feature) => !ids.has(feature.id))
  if (doc.marker !== null) {
    doc.marker = Math.min(Math.max(0, doc.marker - before), doc.timeline.length)
  }
  for (const component of doc.components) {
    component.bodies = component.bodies.filter((body) => !bodies.has(body.id))
  }
  doc.groups = doc.groups.filter((group) => !ids.has(group.firstId) && !ids.has(group.lastId))
}

export function occurrenceReferences(feature: Feature): string[] {
  if (
    (feature.kind === 'hole' || feature.kind === 'standoff') &&
    feature.source.kind === 'occurrence'
  )
    return [...feature.source.occurrencePath, ...feature.source.contextPath]
  if (feature.kind === 'portCutout') return [...feature.occurrencePath, ...feature.contextPath]
  return []
}

export function removeBodyFromDocument(doc: OkcDocument, bodyId: string): void {
  const others = (ids: string[]) => ids.filter((id) => id !== bodyId)
  for (const feature of doc.timeline) {
    if (
      'result' in feature &&
      (feature.result.kind === 'cut' || feature.result.kind === 'intersect') &&
      feature.result.bodyIds.length > 1
    )
      feature.result.bodyIds = others(feature.result.bodyIds)
    if (feature.kind === 'move' && feature.bodyIds.length > 1)
      feature.bodyIds = others(feature.bodyIds)
    if (feature.kind === 'combine' && feature.toolBodyIds.length > 1)
      feature.toolBodyIds = others(feature.toolBodyIds)
  }
  const touching = doc.timeline.filter(
    (feature) =>
      featureCreatesBodies(feature).includes(bodyId) ||
      featureModifiesBodies(feature).includes(bodyId) ||
      featureReadsBodies(feature).includes(bodyId),
  )
  deleteFeatures(
    doc,
    dependentClosure(
      doc,
      touching.map((feature) => feature.id),
    ),
  )
  for (const component of doc.components) {
    component.bodies = component.bodies.filter((body) => body.id !== bodyId)
  }
}

export function removeOccurrencesFromDocument(doc: OkcDocument, ids: string[]): void {
  const goneOccurrences = new Set<string>()
  const goneComponents = new Set<string>()
  const queue = [...ids]
  while (queue.length) {
    const id = queue.pop()!
    if (goneOccurrences.has(id)) continue
    const occurrence = findOccurrence(doc, id)
    if (!occurrence) continue
    goneOccurrences.add(id)
    const componentId = occurrence.componentId
    if (componentId === doc.rootComponentId || goneComponents.has(componentId)) continue
    if (doc.occurrences.some((o) => o.componentId === componentId && !goneOccurrences.has(o.id)))
      continue
    goneComponents.add(componentId)
    for (const child of childOccurrences(doc, componentId)) queue.push(child.id)
  }
  const features = doc.timeline.filter(
    (feature) =>
      goneComponents.has(feature.componentId) ||
      occurrenceReferences(feature).some((id) => goneOccurrences.has(id)),
  )
  deleteFeatures(
    doc,
    dependentClosure(
      doc,
      features.map((feature) => feature.id),
    ),
  )
  doc.occurrences = doc.occurrences.filter((o) => !goneOccurrences.has(o.id))
  doc.components = doc.components.filter((c) => !goneComponents.has(c.id))
}

export function occurrenceName(doc: OkcDocument, component: Component): string {
  const names = new Set(doc.occurrences.map((o) => o.name))
  const existing = doc.occurrences.filter((o) => o.componentId === component.id).length
  if (component.source.kind === 'catalogue' && existing === 0 && !names.has(component.name))
    return component.name
  let n = existing + 1
  while (names.has(`${component.name}:${n}`)) n++
  return `${component.name}:${n}`
}

function componentName(doc: OkcDocument): string {
  const names = new Set(doc.components.map((c) => c.name))
  let n = 1
  while (names.has(`Component${n}`)) n++
  return `Component${n}`
}

export function componentInstance(
  doc: OkcDocument,
  componentId: string,
): { path: string[]; matrix: Matrix4 } | null {
  const node = expandInstances(doc).find((candidate) => candidate.componentId === componentId)
  return node ? { path: node.path, matrix: node.matrix } : null
}

export function occurrencePathOf(
  doc: OkcDocument,
  occurrenceId: string,
  instanceId?: string,
): string[] | null {
  if (instanceId) {
    const { path } = parseInstanceId(instanceId)
    const at = path.indexOf(occurrenceId)
    if (at >= 0) return path.slice(0, at + 1)
  }
  return (
    expandInstances(doc).find((node) => node.path[node.path.length - 1] === occurrenceId)?.path ??
    null
  )
}

export function targetBodies(doc: OkcDocument): Array<{ value: string; label: string }> {
  const placed = new Set(expandInstances(doc).map((node) => node.componentId))
  return doc.components
    .filter((component) => component.source.kind === 'design' && placed.has(component.id))
    .flatMap((component) =>
      component.bodies.map((body) => ({
        value: body.id,
        label:
          component.id === doc.rootComponentId ? body.name : `${component.name} / ${body.name}`,
      })),
    )
}

export function componentMatrix(doc: OkcDocument, componentId: string): Matrix4 {
  return componentInstance(doc, componentId)?.matrix ?? identityMatrix()
}

export function bodyInstance(
  state: Pick<AppState, 'instances'>,
  bodyId: string,
): Instance | undefined {
  return state.instances.find((instance) => instance.kind === 'body' && instance.bodyId === bodyId)
}

export function bodyBounds(
  state: Pick<AppState, 'instances' | 'meshes'>,
  bodyId: string,
): Bounds | undefined {
  const instance = bodyInstance(state, bodyId)
  return instance ? state.meshes.get(instance.meshKey)?.bounds : undefined
}

export function instanceWorldBounds(
  state: Pick<AppState, 'meshes'>,
  instance: Instance,
): Bounds | undefined {
  const bounds = state.meshes.get(instance.meshKey)?.bounds
  return bounds ? worldBounds(bounds, instance.matrix) : undefined
}

export function sketchTargetBody(doc: OkcDocument, sketch: SketchFeature): string | undefined {
  const produced = doc.timeline.flatMap((feature) =>
    (feature.kind === 'extrude' || feature.kind === 'revolve') && feature.sketchId === sketch.id
      ? [
          feature.result.kind === 'newBody' || feature.result.kind === 'join'
            ? feature.result.bodyId
            : feature.result.bodyIds[0],
        ]
      : [],
  )
  const candidates = [
    sketch.plane.kind === 'face' ? sketch.plane.face.bodyId : undefined,
    sketchTargets.get(sketch.id),
    ...produced,
  ]
  return candidates.find((id) => !!id && findBody(doc, id)?.component.id === sketch.componentId)
}

export function selectedBodyId(state: Pick<AppState, 'doc' | 'selection'>): string | undefined {
  const s = state.selection
  if ((s.kind === 'body' || s.kind === 'face' || s.kind === 'edge') && s.id)
    return findBody(state.doc, s.id) ? s.id : undefined
  if (s.kind === 'feature' && s.id) {
    const feature = findFeature(state.doc, s.id)
    if (!feature) return undefined
    return [...featureCreatesBodies(feature), ...featureModifiesBodies(feature)].find(
      (id) => !!findBody(state.doc, id),
    )
  }
  return undefined
}

export function activeComponentOf(state: Pick<AppState, 'doc' | 'activeComponentId'>): string {
  const component = findComponent(state.doc, state.activeComponentId)
  return component && component.source.kind === 'design' ? component.id : state.doc.rootComponentId
}

function reconcile(state: AppState, doc: OkcDocument): Partial<AppState> {
  const out: Partial<AppState> = {}
  if (!findComponent(doc, state.activeComponentId)) out.activeComponentId = doc.rootComponentId
  if (state.activeSketch && findFeature(doc, state.activeSketch.featureId)?.kind !== 'sketch') {
    out.activeSketch = null
    out.sketchStatus = null
    out.sketchSelection = []
    out.tool = 'select'
  }
  const s = state.selection
  const gone =
    s.kind === 'body' || s.kind === 'face' || s.kind === 'edge'
      ? !findBody(doc, s.id ?? '')
      : s.kind === 'occurrence'
        ? !findOccurrence(doc, s.id ?? '')
        : s.kind === 'feature'
          ? !findFeature(doc, s.id ?? '')
          : false
  if (gone) out.selection = { kind: 'none' }
  const picks = state.subSelection.filter((pick) => findBody(doc, pick.bodyId))
  if (picks.length !== state.subSelection.length) out.subSelection = picks
  return out
}

function copyOffset(state: AppState, occurrenceId: string): Vec3 {
  let lo = Infinity
  let hi = -Infinity
  for (const instance of state.instances) {
    if (!instance.path.includes(occurrenceId)) continue
    const bounds = instanceWorldBounds(state, instance)
    if (!bounds) continue
    lo = Math.min(lo, bounds[0])
    hi = Math.max(hi, bounds[3])
  }
  return Number.isFinite(lo) && Number.isFinite(hi)
    ? [Math.round((hi - lo + 10) * 1000) / 1000, 0, 0]
    : [10, 10, 0]
}

export const useStore = create<AppState>((set, get) => ({
  doc: emptyDocument(),
  past: [],
  future: [],

  meshes: new Map(),
  instances: [],
  planes: new Map(),
  errors: [],
  buildMs: 0,
  building: false,
  busy: null,
  kernelReady: false,

  selection: { kind: 'none' },
  hovered: null,
  tool: 'select',
  activeComponentId: emptyDocument().rootComponentId,
  activeSketch: null,
  sketchStatus: null,

  section: { enabled: false, axis: 'z', position: 0, flipped: false },
  showPlacements: true,
  showFasteners: true,
  statusMessage: null,

  setDoc(doc, resetHistory = true) {
    doc = clone(doc)
    resolveParameters(doc)
    set(
      resetHistory
        ? {
            doc,
            past: [],
            future: [],
            activeSketch: null,
            sketchStatus: null,
            selection: { kind: 'none' },
            subSelection: [],
            sketchSelection: [],
            activeComponentId: doc.rootComponentId,
          }
        : { doc, ...reconcile(get(), doc) },
    )
    get().rebuild()
  },

  commit(fn, opts) {
    const state = get()
    const next = clone(state.doc)
    fn(next)
    resolveParameters(next, true)

    const now = performance.now()
    const merges =
      !!opts?.mergeKey &&
      lastMerge !== null &&
      lastMerge.key === opts.mergeKey &&
      now - lastMerge.at < MERGE_WINDOW_MS
    lastMerge = opts?.mergeKey ? { key: opts.mergeKey, at: now } : null

    const fixes = reconcile(state, next)
    if (opts?.transient || merges) {
      set({ doc: next, ...fixes })
    } else {
      set({
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        ...fixes,
      })
    }
    get().rebuild()
  },

  undo() {
    lastMerge = null
    const state = get()
    const { past, doc, future } = state
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const active = state.activeSketch
    const activeSketch =
      active && findFeature(previous, active.featureId)?.kind === 'sketch' ? active : null
    set({
      doc: previous,
      past: past.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY_LIMIT),
      selection: { kind: 'none' },
      subSelection: [],
      sketchSelection: [],
      hovered: null,
      activeSketch,
      tool: activeSketch ? state.tool : 'select',
      sketchStatus: null,
      activeComponentId: findComponent(previous, state.activeComponentId)
        ? state.activeComponentId
        : previous.rootComponentId,
    })
    get().rebuild()
  },

  redo() {
    lastMerge = null
    const state = get()
    const { future, doc, past } = state
    if (future.length === 0) return
    const next = future[0]
    const active = state.activeSketch
    const activeSketch =
      active && findFeature(next, active.featureId)?.kind === 'sketch' ? active : null
    set({
      doc: next,
      future: future.slice(1),
      past: [...past, doc].slice(-HISTORY_LIMIT),
      selection: { kind: 'none' },
      subSelection: [],
      sketchSelection: [],
      hovered: null,
      activeSketch,
      tool: activeSketch ? state.tool : 'select',
      sketchStatus: null,
      activeComponentId: findComponent(next, state.activeComponentId)
        ? state.activeComponentId
        : next.rootComponentId,
    })
    get().rebuild()
  },

  rebuild() {
    const doc = { ...get().doc, customParts: userParts() }
    const ticket = ++buildTicket
    set({ building: true })
    requestBuild(doc, () => [...get().meshes.keys()]).then((result: EvaluateResult) => {
      if (ticket !== buildTicket) return
      const crashed =
        result.instances.length === 0 &&
        result.meshes.length === 0 &&
        result.errors.some((error) => error.featureId === '')
      if (crashed && get().instances.length) {
        set({ errors: result.errors, buildMs: result.elapsedMs, building: false })
        return
      }
      const meshes = new Map(get().meshes)
      for (const mesh of result.meshes) meshes.set(mesh.key, mesh)
      const used = new Set(result.instances.map((instance) => instance.meshKey))
      for (const key of [...meshes.keys()]) if (!used.has(key)) meshes.delete(key)
      set({
        meshes,
        instances: result.instances,
        planes: new Map(result.planes.map((entry) => [entry.featureId, entry.frame])),
        errors: result.errors,
        buildMs: result.elapsedMs,
        building: false,
      })
    })
  },

  setBusy(busy) {
    set({ busy })
  },

  setKernelReady(kernelReady) {
    set({ kernelReady })
  },
  setTool(tool) {
    set({ tool })
  },
  select(selection) {
    set({ selection })
  },
  setHovered(hovered) {
    set({ hovered })
  },
  setStatus(statusMessage) {
    set({ statusMessage })
    clearTimeout(statusTimer)
    if (statusMessage) {
      statusTimer = setTimeout(() => {
        if (get().statusMessage === statusMessage) set({ statusMessage: null })
      }, 6000) as unknown as number
    }
  },

  measure: { a: null, b: null },
  addMeasurePoint(point) {
    const current = get().measure
    const next =
      current.a && current.b
        ? { a: point, b: null }
        : current.a
          ? { a: current.a, b: point }
          : { a: point, b: null }
    set({ measure: next })
    if (next.a && next.b) {
      const unit = get().doc.units
      const dx = next.b[0] - next.a[0]
      const dy = next.b[1] - next.a[1]
      const dz = next.b[2] - next.a[2]
      const d = Math.hypot(dx, dy, dz)
      const show = (mm: number) => lengthLabel(mm, unit, false)
      get().setStatus(
        `${show(d)} ${unit} apart  (across ${show(dx)}, along ${show(dy)}, up ${show(dz)})`,
      )
    } else {
      get().setStatus('Now click the second point.')
    }
  },
  clearMeasure() {
    set({ measure: { a: null, b: null } })
  },
  setSection(patch) {
    set({ section: { ...get().section, ...patch } })
  },
  setShowFasteners(showFasteners) {
    set({ showFasteners })
  },
  setShowPlacements(showPlacements) {
    set({ showPlacements })
  },

  setUnits(units) {
    if (get().doc.units === units) return
    get().commit((d) => {
      d.units = units
    })
  },

  activateComponent(componentId) {
    const component = findComponent(get().doc, componentId)
    if (!component || component.source.kind !== 'design') return
    set({ activeComponentId: componentId })
  },

  createComponent(name) {
    const parent = activeComponentOf(get())
    const componentId = newId('comp')
    const occurrenceId = newId('occ')
    get().commit((d) => {
      const component: Component = {
        id: componentId,
        name: name ?? componentName(d),
        source: { kind: 'design' },
        bodies: [],
      }
      d.components.push(component)
      d.occurrences.push({
        id: occurrenceId,
        parentComponentId: parent,
        componentId,
        name: occurrenceName(d, component),
        transform: identityMatrix(),
        visible: true,
        grounded: false,
      })
    })
    set({
      activeComponentId: componentId,
      selection: { kind: 'occurrence', id: occurrenceId },
      subSelection: [],
    })
    return occurrenceId
  },

  linkedCopy(occurrenceId, offset) {
    const state = get()
    const source = findOccurrence(state.doc, occurrenceId)
    if (!source) return null
    if (wouldCreateCycle(state.doc, source.parentComponentId, source.componentId)) {
      state.setStatus('A component cannot contain a copy of itself.')
      return null
    }
    const id = newId('occ')
    const shift = offset ?? copyOffset(state, occurrenceId)
    state.commit((d) => {
      const component = findComponent(d, source.componentId)
      if (!component) return
      d.occurrences.push({
        ...clone(source),
        id,
        name: occurrenceName(d, component),
        transform: multiplyMatrices(translationMatrix(shift), source.transform),
      })
    })
    set({ selection: { kind: 'occurrence', id }, subSelection: [] })
    return id
  },

  insertCatalogue(partId, position = [0, 0, 0]) {
    const part = getPart(partId)
    const parent = activeComponentOf(get())
    const componentId = newId('part')
    const occurrenceId = newId('occ')
    get().commit((d) => {
      const component: Component = {
        id: componentId,
        name: part?.name ?? partId,
        source: { kind: 'catalogue', partId },
        bodies: [],
      }
      d.components.push(component)
      d.occurrences.push({
        id: occurrenceId,
        parentComponentId: parent,
        componentId,
        name: occurrenceName(d, component),
        transform: translationMatrix(position),
        visible: true,
        grounded: false,
      })
    })
    set({ selection: { kind: 'occurrence', id: occurrenceId }, subSelection: [] })
    return occurrenceId
  },

  updateOccurrence(id, patch, opts) {
    get().commit(
      (d) => {
        const occurrence = findOccurrence(d, id)
        if (occurrence) Object.assign(occurrence, patch)
      },
      { ...opts, mergeKey: `occurrence:${id}:${Object.keys(patch).join(',')}` },
    )
  },

  removeOccurrence(id) {
    get().commit((d) => removeOccurrencesFromDocument(d, [id]))
  },

  updateComponent(id, patch) {
    get().commit(
      (d) => {
        const component = findComponent(d, id)
        if (component) Object.assign(component, patch)
      },
      { mergeKey: `component:${id}:${Object.keys(patch).join(',')}` },
    )
  },

  updateBody(bodyId, patch) {
    get().commit(
      (d) => {
        const found = findBody(d, bodyId)
        if (found) Object.assign(found.body, patch)
      },
      { mergeKey: `body:${bodyId}:${Object.keys(patch).join(',')}` },
    )
  },

  removeBody(bodyId) {
    get().commit((d) => removeBodyFromDocument(d, bodyId))
  },

  addFeature(feature, bodies) {
    get().commit((d) => insertFeatures(d, [feature], bodies))
  },

  addFeatures(features, bodies) {
    get().commit((d) => insertFeatures(d, features, bodies))
  },

  updateFeature(featureId, patch, opts) {
    get().commit(
      (d) => {
        const index = featureIndex(d, featureId)
        if (index < 0) return
        d.bindings = d.bindings.filter(
          (link) =>
            !(
              link.featureId === featureId &&
              typeof (patch as Record<string, unknown>)[link.field] === 'number'
            ),
        )
        const before = featureCreatesBodies(d.timeline[index])
        const updated = { ...d.timeline[index], ...patch } as Feature
        d.timeline[index] = updated
        const after = featureCreatesBodies(updated)
        for (const bodyId of before) {
          if (after.includes(bodyId)) continue
          for (const component of d.components) {
            component.bodies = component.bodies.filter((body) => body.id !== bodyId)
          }
        }
        const component = findComponent(d, updated.componentId)
        for (const bodyId of after) {
          if (findBody(d, bodyId) || !component) continue
          component.bodies.push({
            id: bodyId,
            name: nextBodyName(d),
            visible: true,
            colour: DEFAULT_BODY_COLOUR,
          })
        }
      },
      {
        transient: opts?.transient,
        mergeKey: `feature:${featureId}:${Object.keys(patch).join(',')}`,
      },
    )
  },

  replaceFeature(featureId, features) {
    get().commit((d) => replaceFeatureInDocument(d, featureId, features))
  },

  removeFeature(featureId, opts) {
    const state = get()
    const feature = findFeature(state.doc, featureId)
    if (!feature) return false
    const closure = dependentClosure(state.doc, [featureId])
    if (closure.size > 1 && !opts?.withDependents) {
      const names = state.doc.timeline
        .filter((f) => closure.has(f.id) && f.id !== featureId)
        .map((f) => f.name)
      state.setStatus(
        `${feature.name} can't be deleted on its own: ${names.join(', ')} ${names.length === 1 ? 'depends' : 'depend'} on it.`,
      )
      return false
    }
    state.commit((d) => deleteFeatures(d, closure))
    return true
  },

  moveFeature(featureId, toIndex) {
    const state = get()
    const from = featureIndex(state.doc, featureId)
    if (from < 0 || from === toIndex) return false
    if (!canMoveFeature(state.doc, featureId, toIndex)) {
      state.setStatus('That would put a step before something it depends on.')
      return false
    }
    state.commit((d) => {
      const index = featureIndex(d, featureId)
      const [moved] = d.timeline.splice(index, 1)
      d.timeline.splice(toIndex, 0, moved)
      const kept = new Set(timelineGroups(d).map((span) => span.group.id))
      d.groups = d.groups.filter((group) => kept.has(group.id))
    })
    return true
  },

  setMarker(index) {
    const doc = get().doc
    const next = index === null || index >= doc.timeline.length ? null : Math.max(0, index)
    if (next === doc.marker) return
    get().commit(
      (d) => {
        d.marker = next
      },
      { mergeKey: 'marker' },
    )
  },

  groupSteps(firstId, lastId) {
    const state = get()
    const a = featureIndex(state.doc, firstId)
    const b = featureIndex(state.doc, lastId)
    if (a < 0 || b < 0 || a === b) return null
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    if (timelineGroups(state.doc).some((span) => start <= span.end && end >= span.start)) {
      state.setStatus('Those steps overlap a group that already exists.')
      return null
    }
    const names = new Set(state.doc.groups.map((group) => group.name))
    let n = state.doc.groups.length + 1
    while (names.has(`Group${n}`)) n++
    const id = newId('group')
    state.commit((d) => {
      d.groups.push({
        id,
        name: `Group${n}`,
        firstId: d.timeline[start].id,
        lastId: d.timeline[end].id,
        collapsed: true,
      })
    })
    return id
  },

  ungroup(groupId) {
    get().commit((d) => {
      d.groups = d.groups.filter((group) => group.id !== groupId)
    })
  },

  toggleGroup(groupId) {
    get().commit(
      (d) => {
        const group = d.groups.find((candidate) => candidate.id === groupId)
        if (group) group.collapsed = !group.collapsed
      },
      { mergeKey: `group:${groupId}` },
    )
  },

  gizmoMode: 'translate',
  setGizmoMode(gizmoMode) {
    set({ gizmoMode })
  },
  transientBase: null,
  beginTransient() {
    if (!get().transientBase) set({ transientBase: get().doc })
  },
  endTransient() {
    const base = get().transientBase
    if (base && base !== get().doc) {
      set({
        past: [...get().past, base].slice(-HISTORY_LIMIT),
        future: [],
      })
    }
    set({ transientBase: null })
  },

  startSketch(plane, bodyId) {
    const state = get()
    const owner = plane.kind === 'face' ? plane.face.bodyId : bodyId
    const componentId =
      (owner ? findBody(state.doc, owner)?.component.id : undefined) ?? activeComponentOf(state)
    const featureId = newId('sketch')
    if (owner) sketchTargets.set(featureId, owner)
    const feature: SketchFeature = {
      id: featureId,
      kind: 'sketch',
      name: 'Sketch',
      componentId,
      plane,
      sketch: emptySketch(),
      visible: true,
    }
    state.commit((doc) => insertFeatures(doc, [feature]))
    set({
      activeSketch: { featureId, componentId },
      tool: 'select',
      selection: { kind: 'feature', id: featureId },
    })
  },

  openSketch(featureId) {
    const feature = findFeature(get().doc, featureId)
    if (feature?.kind !== 'sketch') return
    set({
      activeSketch: { featureId, componentId: feature.componentId },
      tool: 'select',
      selection: { kind: 'feature', id: featureId },
    })
  },

  closeSketch() {
    const active = get().activeSketch
    set({
      activeSketch: null,
      tool: 'select',
      sketchStatus: null,
      sketchSelection: [],
      ...(active ? { selection: { kind: 'feature' as const, id: active.featureId } } : {}),
    })
  },

  editSketch(fn, opts) {
    const active = get().activeSketch
    if (!active) return
    get().commit((d) => {
      const feature = findFeature(d, active.featureId)
      if (feature?.kind === 'sketch') fn(feature.sketch)
    }, opts)
  },

  solveActiveSketch(drag) {
    const feature = activeSketchFeature(get())
    if (!feature) return null

    const result = solveSketch(feature.sketch, drag ? { drag } : undefined)
    get().editSketch((sketch) => applySolve(sketch, result), { transient: true })
    set({
      sketchStatus: {
        dof: result.dof,
        failing: result.failing,
        closed: feature.sketch.entities.some((e) => !e.construction),
        freePoints: result.freePoints,
        freeRadii: result.freeRadii,
        freeEntities: result.freeEntities,
      },
    })
    return result
  },

  addConstraint(constraint) {
    get().editSketch((sketch) => {
      sketch.constraints.push({ ...constraint, id: newId('c') } as Constraint)
    })
    get().solveActiveSketch()
  },

  subSelection: [],
  setSubSelection(subSelection) {
    set({ subSelection })
  },

  sketchSelection: [],
  setSketchSelection(sketchSelection) {
    set({ sketchSelection })
  },

  applySketchAction(result) {
    switch (result.kind) {
      case 'constraint':
        get().addConstraint(result.constraint)
        break
      case 'deleteEntity':
        get().editSketch((sketch) => {
          sketch.entities = sketch.entities.filter((e) => e.id !== result.entityId)
          sketch.constraints = sketch.constraints.filter(
            (c) =>
              !(
                ('e' in c && c.e === result.entityId) ||
                ('a' in c && c.a === result.entityId) ||
                ('b' in c && c.b === result.entityId) ||
                ('line' in c && c.line === result.entityId) ||
                ('circle' in c && c.circle === result.entityId)
              ),
          )
        })
        get().solveActiveSketch()
        break
      case 'toggleConstruction':
        get().editSketch((sketch) => {
          const entity = sketch.entities.find((e) => e.id === result.entityId)
          if (entity) entity.construction = !entity.construction
        })
        break
      case 'deleteConstraint':
        get().editSketch((sketch) => {
          sketch.constraints = sketch.constraints.filter((c) => c.id !== result.constraintId)
        })
        get().solveActiveSketch()
        break
      case 'deletePoint':
        get().editSketch((sketch) => {
          sketch.points = sketch.points.filter((p) => p.id !== result.pointId)
        })
        get().solveActiveSketch()
        break
      case 'filletCorner':
      case 'chamferCorner':
      case 'filletBetween':
      case 'trim':
      case 'linearPattern':
      case 'circularPattern':
      case 'mirror':
      case 'offset':
      case 'addPolygon':
      case 'addSlot': {
        let outcome: CornerResult = { ok: true }
        get().editSketch((sketch) => {
          switch (result.kind) {
            case 'filletCorner':
              outcome = filletCorner(sketch, result.pointId, result.radius, newId)
              break
            case 'chamferCorner':
              outcome = chamferCorner(sketch, result.pointId, result.distance, newId)
              break
            case 'filletBetween':
              outcome = filletBetween(
                sketch,
                result.aId,
                result.bId,
                result.radius,
                result.cursor,
                newId,
              )
              break
            case 'trim':
              outcome = trimEntity(sketch, result.entityId, result.at, newId)
              break
            case 'linearPattern':
              outcome = linearPattern(
                sketch,
                result.entityIds,
                { count: result.count, dx: result.dx, dy: result.dy },
                newId,
              )
              break
            case 'mirror':
              outcome = mirrorEntities(sketch, result.entityIds, result.axis, newId)
              break
            case 'offset':
              outcome = offsetChains(sketch, result.entityIds, result.distance, newId)
              break
            case 'addPolygon':
              outcome = addPolygon(sketch, result.centre, result.sides, result.radius, newId)
              break
            case 'addSlot':
              outcome = addSlot(sketch, result.centre, result.length, result.width, newId)
              break
            case 'circularPattern':
              outcome = circularPattern(
                sketch,
                result.entityIds,
                {
                  count: result.count,
                  centre: result.centre,
                  totalAngle: result.totalAngle,
                },
                newId,
              )
              break
          }
        })
        if (!outcome.ok) {
          get().undo()
          set({ statusMessage: outcome.message ?? null })
        } else {
          set({ statusMessage: null })
          get().solveActiveSketch()
        }
        break
      }

      case 'standoff': {
        const seat = surfacePlane(get())
        if (!seat) break
        const plan = planPillar(result.kindOf, result.size, result.height)
        if (plan.warning) get().setStatus(plan.warning)
        get().addFeature({
          id: newId('standoff'),
          kind: 'standoff',
          name: plan.name,
          componentId: seat.componentId,
          plane: seat.plane,
          source: { kind: 'explicit', positions: result.positions },
          height: result.height,
          outerDiameter: plan.outerDiameter,
          boreDiameter: plan.boreDiameter,
          boreDepth: plan.boreDepth,
          fastener: { kind: result.kindOf, size: result.size },
          result: seat.bodyId
            ? { kind: 'join', bodyId: seat.bodyId }
            : { kind: 'newBody', bodyId: newId('body') },
        })
        break
      }

      case 'fastener': {
        const seat = surfacePlane(get())
        if (!seat) break
        if (!seat.bodyId) {
          get().setStatus('Holes need a solid to cut into. Extrude the sketch first.')
          break
        }
        const plan = planHole(result.kindOf, result.size)
        get().addFeature({
          id: newId('hole'),
          kind: 'hole',
          name: plan.name,
          componentId: seat.componentId,
          bodyId: seat.bodyId,
          plane: seat.plane,
          source: { kind: 'explicit', positions: result.positions },
          style: plan.style,
          diameter: plan.diameter,
          depth: result.depth > 0 ? result.depth : 'through',
          counterboreDiameter: plan.counterboreDiameter,
          counterboreDepth: plan.counterboreDepth,
          countersinkAngle: plan.countersinkAngle,
          fastener: { kind: result.kindOf, size: result.size },
        })
        break
      }
    }
    set({ sketchSelection: [] })
  },
}))

function surfacePlane(
  state: AppState,
): { bodyId?: string; componentId: string; plane: PlaneRef } | null {
  const sketchFeature = activeSketchFeature(state)
  if (!sketchFeature) return null
  const frame = frameFromPlaneRefLocal(sketchFeature.plane, state.planes.get(sketchFeature.id))
  if (!frame) return null
  const bodyId = sketchTargetBody(state.doc, sketchFeature)
  const bounds = bodyId ? bodyBounds(state, bodyId) : undefined
  let lift = 0
  if (bounds) {
    const [x0, y0, z0, x1, y1, z1] = bounds
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        for (const z of [z0, z1]) {
          const d = v3.dot(v3.sub([x, y, z], frame.origin), frame.normal)
          if (d > lift) lift = d
        }
      }
    }
  }
  return {
    bodyId,
    componentId: sketchFeature.componentId,
    plane: { ...sketchFeature.plane, offset: sketchFeature.plane.offset + lift },
  }
}

export function activeSketchFeature(state: AppState = useStore.getState()): SketchFeature | null {
  if (!state.activeSketch) return null
  const feature = findFeature(state.doc, state.activeSketch.featureId)
  return feature?.kind === 'sketch' ? feature : null
}
