/**
 * Application state.
 *
 * One store holds the document, its undo history, the current selection and
 * the last result from the kernel. Every mutation goes through `commit`, which
 * snapshots for undo and schedules a rebuild, so no caller can accidentally
 * change geometry without the viewport catching up.
 */
import { create } from 'zustand'
import type { EvaluateResult, KernelError, ShapeResult } from '../kernel/types'
import { requestBuild } from '../kernel/api'
import {
  emptyDocument,
  type Body,
  type Feature,
  type OkcDocument,
  type Placement,
  type PlaneRef,
  type SketchFeature,
} from './types'
import {
  emptySketch,
  type Constraint,
  type NewConstraint,
  type Sketch2D,
} from '../sketch/types'
import { applySolve, solveSketch, type SolveResult } from '../sketch/solver'
import type { SketchTarget } from '../sketch/inference'
import type { ActionResult } from '../sketch/actions'
import { chamferCorner, filletCorner, type CornerResult } from '../sketch/corner'
import { getPart } from '../catalogue'

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export type ToolId =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'dimension'
  | 'measure'

export interface Selection {
  kind: 'none' | 'body' | 'placement' | 'feature' | 'face' | 'edge'
  id?: string
  /** For feature selection, which body owns it. */
  bodyId?: string
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

  shapes: ShapeResult[]
  errors: KernelError[]
  buildMs: number
  building: boolean
  kernelReady: boolean

  selection: Selection
  hovered: string | null
  tool: ToolId
  /** Set while a sketch is open for editing. */
  activeSketch: { bodyId: string; featureId: string } | null
  sketchStatus: { dof: number; failing: string[]; closed: boolean } | null

  section: SectionState
  showPlacements: boolean
  statusMessage: string | null

  // --- actions
  setDoc: (doc: OkcDocument, resetHistory?: boolean) => void
  commit: (fn: (draft: OkcDocument) => void, opts?: { transient?: boolean }) => void
  undo: () => void
  redo: () => void
  rebuild: () => void
  setKernelReady: (ready: boolean) => void

  setTool: (tool: ToolId) => void
  select: (selection: Selection) => void
  setHovered: (id: string | null) => void
  setStatus: (message: string | null) => void
  setSection: (patch: Partial<SectionState>) => void
  setShowPlacements: (show: boolean) => void

  addBody: (name?: string) => string
  removeBody: (bodyId: string) => void
  addFeature: (bodyId: string, feature: Feature) => void
  updateFeature: (bodyId: string, featureId: string, patch: Partial<Feature>) => void
  removeFeature: (bodyId: string, featureId: string) => void
  moveFeature: (bodyId: string, featureId: string, delta: number) => void

  addPlacement: (partId: string, position?: [number, number, number]) => string
  updatePlacement: (
    id: string,
    patch: Partial<Placement>,
    opts?: { transient?: boolean },
  ) => void
  removePlacement: (id: string) => void

  /**
   * Bracket a drag so it lands in the undo history as one step rather than
   * sixty. Without this, dragging a gizmo across the screen buries everything
   * that came before it under a hundred identical undo entries.
   */
  gizmoMode: 'translate' | 'rotate'
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  transientBase: OkcDocument | null
  beginTransient: () => void
  endTransient: () => void

  startSketch: (plane: PlaneRef, bodyId?: string) => void
  openSketch: (bodyId: string, featureId: string) => void
  closeSketch: () => void
  editSketch: (fn: (sketch: Sketch2D) => void, opts?: { transient?: boolean }) => void
  solveActiveSketch: (drag?: { point: string; x: number; y: number }) => SolveResult | null
  addConstraint: (constraint: NewConstraint) => void

  /** What the user has picked inside the open sketch, for the right-click menu. */
  sketchSelection: SketchTarget[]
  setSketchSelection: (selection: SketchTarget[]) => void
  applySketchAction: (result: ActionResult) => void
}

const HISTORY_LIMIT = 80

function clone<T>(v: T): T {
  return structuredClone(v)
}

export const useStore = create<AppState>((set, get) => ({
  doc: emptyDocument(),
  past: [],
  future: [],

  shapes: [],
  errors: [],
  buildMs: 0,
  building: false,
  kernelReady: false,

  selection: { kind: 'none' },
  hovered: null,
  tool: 'select',
  activeSketch: null,
  sketchStatus: null,

  section: { enabled: false, axis: 'z', position: 0, flipped: false },
  showPlacements: true,
  statusMessage: null,

  setDoc(doc, resetHistory = true) {
    set(
      resetHistory
        ? { doc, past: [], future: [], activeSketch: null, selection: { kind: 'none' } }
        : { doc },
    )
    get().rebuild()
  },

  commit(fn, opts) {
    const state = get()
    const next = clone(state.doc)
    fn(next)
    if (opts?.transient) {
      set({ doc: next })
    } else {
      set({
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
      })
    }
    get().rebuild()
  },

  undo() {
    const { past, doc, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT) })
    get().rebuild()
  },

  redo() {
    const { future, doc, past } = get()
    if (future.length === 0) return
    set({ doc: future[0], future: future.slice(1), past: [...past, doc].slice(-HISTORY_LIMIT) })
    get().rebuild()
  },

  rebuild() {
    const doc = get().doc
    set({ building: true })
    requestBuild(doc).then((result: EvaluateResult) => {
      // A newer build may have finished first; only accept the latest.
      if (get().doc !== doc && get().building) return
      set({
        shapes: result.shapes,
        errors: result.errors,
        buildMs: result.elapsedMs,
        building: false,
      })
    })
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
  },
  setSection(patch) {
    set({ section: { ...get().section, ...patch } })
  },
  setShowPlacements(showPlacements) {
    set({ showPlacements })
  },

  addBody(name) {
    const id = newId('body')
    get().commit((d) => {
      d.bodies.push({
        id,
        name: name ?? `Part ${d.bodies.length + 1}`,
        visible: true,
        colour: '#b9c0c7',
        features: [],
      })
    })
    return id
  },

  removeBody(bodyId) {
    get().commit((d) => {
      d.bodies = d.bodies.filter((b) => b.id !== bodyId)
    })
    if (get().selection.id === bodyId) set({ selection: { kind: 'none' } })
  },

  addFeature(bodyId, feature) {
    get().commit((d) => {
      d.bodies.find((b) => b.id === bodyId)?.features.push(feature)
    })
  },

  updateFeature(bodyId, featureId, patch) {
    get().commit((d) => {
      const body = d.bodies.find((b) => b.id === bodyId)
      const index = body?.features.findIndex((f) => f.id === featureId) ?? -1
      if (body && index >= 0) {
        body.features[index] = { ...body.features[index], ...patch } as Feature
      }
    })
  },

  removeFeature(bodyId, featureId) {
    get().commit((d) => {
      const body = d.bodies.find((b) => b.id === bodyId)
      if (body) body.features = body.features.filter((f) => f.id !== featureId)
    })
  },

  moveFeature(bodyId, featureId, delta) {
    get().commit((d) => {
      const body = d.bodies.find((b) => b.id === bodyId)
      if (!body) return
      const i = body.features.findIndex((f) => f.id === featureId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= body.features.length) return
      const [moved] = body.features.splice(i, 1)
      body.features.splice(j, 0, moved)
    })
  },

  addPlacement(partId, position) {
    const id = newId('place')
    const part = getPart(partId)
    get().commit((d) => {
      d.placements.push({
        id,
        partId,
        name: part?.name ?? partId,
        position: position ?? [0, 0, 0],
        rotation: 0,
        flipped: false,
        visible: true,
      })
    })
    set({ selection: { kind: 'placement', id } })
    return id
  },

  updatePlacement(id, patch, opts) {
    get().commit((d) => {
      const i = d.placements.findIndex((p) => p.id === id)
      if (i >= 0) d.placements[i] = { ...d.placements[i], ...patch }
    }, opts)
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

  removePlacement(id) {
    get().commit((d) => {
      d.placements = d.placements.filter((p) => p.id !== id)
      // Any feature driven by this placement would silently produce nothing,
      // so drop those too rather than leave dead steps in the tree.
      for (const body of d.bodies) {
        body.features = body.features.filter((f) => {
          if (f.kind === 'portCutout') return f.placementId !== id
          if ((f.kind === 'hole' || f.kind === 'standoff') && f.source.kind === 'placement') {
            return f.source.placementId !== id
          }
          return true
        })
      }
    })
    if (get().selection.id === id) set({ selection: { kind: 'none' } })
  },

  startSketch(plane, bodyId) {
    const targetBody = bodyId ?? get().doc.bodies[0]?.id ?? get().addBody()
    const featureId = newId('sketch')
    const feature: SketchFeature = {
      id: featureId,
      kind: 'sketch',
      name: 'Sketch',
      plane,
      sketch: emptySketch(),
    }
    get().addFeature(targetBody, feature)
    set({
      activeSketch: { bodyId: targetBody, featureId },
      tool: 'rectangle',
      selection: { kind: 'feature', id: featureId, bodyId: targetBody },
    })
  },

  openSketch(bodyId, featureId) {
    set({
      activeSketch: { bodyId, featureId },
      tool: 'select',
      selection: { kind: 'feature', id: featureId, bodyId },
    })
  },

  closeSketch() {
    set({ activeSketch: null, tool: 'select', sketchStatus: null, sketchSelection: [] })
  },

  editSketch(fn, opts) {
    const active = get().activeSketch
    if (!active) return
    get().commit((d) => {
      const body = d.bodies.find((b) => b.id === active.bodyId)
      const feature = body?.features.find((f) => f.id === active.featureId)
      if (feature?.kind === 'sketch') fn(feature.sketch)
    }, opts)
  },

  solveActiveSketch(drag) {
    const active = get().activeSketch
    if (!active) return null
    const body = get().doc.bodies.find((b) => b.id === active.bodyId)
    const feature = body?.features.find((f) => f.id === active.featureId)
    if (feature?.kind !== 'sketch') return null

    const result = solveSketch(feature.sketch, drag ? { drag } : undefined)
    get().editSketch((sketch) => applySolve(sketch, result), { transient: !!drag })
    set({
      sketchStatus: {
        dof: result.dof,
        failing: result.failing,
        closed: feature.sketch.entities.some((e) => !e.construction),
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
          // Drop constraints that referenced it, or the solver would carry rows
          // pointing at geometry that no longer exists.
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
      case 'chamferCorner': {
        let outcome: CornerResult = { ok: true }
        get().editSketch((sketch) => {
          outcome =
            result.kind === 'filletCorner'
              ? filletCorner(sketch, result.pointId, result.radius, newId)
              : chamferCorner(sketch, result.pointId, result.distance, newId)
        })
        if (!outcome.ok) {
          // The edit above cannot have changed anything on failure, so undoing
          // it would eat the user's previous step. Just say why instead.
          get().undo()
          set({ statusMessage: outcome.message ?? null })
        } else {
          set({ statusMessage: null })
          get().solveActiveSketch()
        }
        break
      }
    }
    set({ sketchSelection: [] })
  },
}))

/** The sketch currently open for editing, if any. */
export function activeSketchFeature(state: AppState = useStore.getState()): SketchFeature | null {
  if (!state.activeSketch) return null
  const body = state.doc.bodies.find((b) => b.id === state.activeSketch!.bodyId)
  const feature = body?.features.find((f) => f.id === state.activeSketch!.featureId)
  return feature?.kind === 'sketch' ? feature : null
}

export function findBody(doc: OkcDocument, id: string | undefined): Body | undefined {
  return doc.bodies.find((b) => b.id === id)
}
