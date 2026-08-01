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
import type { SubPick } from '../viewport/engine'
import type { ActionResult } from '../sketch/actions'
import {
  chamferCorner,
  filletBetween,
  filletCorner,
  type CornerResult,
} from '../sketch/corner'
import {
  addPolygon,
  addSlot,
  circularPattern,
  linearPattern,
  mirrorEntities,
  offsetEntities,
  trimLine,
  trimRound,
} from '../sketch/edit'
import { getPart, userParts } from '../catalogue'
import { planHole, planPillar } from '../fasteners'
import { v3 } from '../core/math'
import { frameFromPlaneRefLocal } from './planes'

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
  /**
   * What the app is busy doing, for the progress bar. Separate from `building`
   * because exporting a STEP file is the slowest thing here and is not a
   * rebuild.
   */
  busy: string | null
  setBusy: (busy: string | null) => void
  kernelReady: boolean

  selection: Selection
  hovered: string | null
  tool: ToolId
  /** Set while a sketch is open for editing. */
  activeSketch: { bodyId: string; featureId: string } | null
  sketchStatus: {
    dof: number
    failing: string[]
    closed: boolean
    /** Geometry the solver says can still move, for colouring it differently. */
    freePoints: string[]
    freeRadii: string[]
  } | null

  section: SectionState
  showPlacements: boolean
  /** Draw ghosts of the screws and inserts the holes were made for. */
  showFasteners: boolean
  setShowFasteners: (show: boolean) => void
  statusMessage: string | null

  // --- actions
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
  /** Two picked points, for the measure tool. */
  measure: { a: [number, number, number] | null; b: [number, number, number] | null }
  addMeasurePoint: (point: [number, number, number]) => void
  clearMeasure: () => void
  setSection: (patch: Partial<SectionState>) => void
  setShowPlacements: (show: boolean) => void

  addBody: (name?: string) => string
  removeBody: (bodyId: string) => void
  /** Move one body above another, so it is built first. */
  moveBodyBefore: (bodyId: string, beforeId: string) => void
  addFeature: (bodyId: string, feature: Feature) => void
  updateFeature: (
    bodyId: string,
    featureId: string,
    patch: Partial<Feature>,
    opts?: { transient?: boolean },
  ) => void
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

  /**
   * Faces, edges and corners picked on a built solid. Shift-clicking adds to
   * it, which is what makes per-edge operations possible.
   */
  subSelection: SubPick[]
  setSubSelection: (picks: SubPick[]) => void

  /** What the user has picked inside the open sketch, for the right-click menu. */
  sketchSelection: SketchTarget[]
  setSketchSelection: (selection: SketchTarget[]) => void
  applySketchAction: (result: ActionResult) => void
}

const HISTORY_LIMIT = 80
let statusTimer: number | undefined
/** How long edits to the same field keep folding into one undo step. */
const MERGE_WINDOW_MS = 900
let lastMerge: { key: string; at: number } | null = null
let buildTicket = 0

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
  busy: null,
  kernelReady: false,

  selection: { kind: 'none' },
  hovered: null,
  tool: 'select',
  activeSketch: null,
  sketchStatus: null,

  section: { enabled: false, axis: 'z', position: 0, flipped: false },
  showPlacements: true,
  showFasteners: true,
  statusMessage: null,

  setDoc(doc, resetHistory = true) {
    set(
      resetHistory
        ? {
            doc,
            past: [],
            future: [],
            activeSketch: null,
            selection: { kind: 'none' },
            subSelection: [],
          }
        : { doc },
    )
    get().rebuild()
  },

  commit(fn, opts) {
    const state = get()
    const next = clone(state.doc)
    fn(next)

    // Typing "12.5" into a box fires an edit per keystroke. Without merging,
    // undo walks back through "12.", "12", "1" one press at a time, which is
    // what makes Ctrl+Z feel like it is not working.
    const now = performance.now()
    const merges =
      !!opts?.mergeKey &&
      lastMerge !== null &&
      lastMerge.key === opts.mergeKey &&
      now - lastMerge.at < MERGE_WINDOW_MS
    lastMerge = opts?.mergeKey ? { key: opts.mergeKey, at: now } : null

    if (opts?.transient || merges) {
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
    lastMerge = null
    const { past, doc, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT) })
    get().rebuild()
  },

  redo() {
    lastMerge = null
    const { future, doc, past } = get()
    if (future.length === 0) return
    set({ doc: future[0], future: future.slice(1), past: [...past, doc].slice(-HISTORY_LIMIT) })
    get().rebuild()
  },

  rebuild() {
    // Custom parts ride along with the document: the worker cannot read them
    // from storage itself.
    const doc = { ...get().doc, customParts: userParts() }
    const ticket = ++buildTicket
    set({ building: true })
    requestBuild(doc).then((result: EvaluateResult) => {
      // Results can arrive out of order. Comparing a sequence number is exact,
      // where the old identity check could drop a result that was actually the
      // newest and leave stale geometry on screen.
      if (ticket !== buildTicket) return
      set({
        shapes: result.shapes,
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
    // Clear itself after a few seconds. A message that stays forever stops
    // being read, and the next one then goes unnoticed too.
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
    // Third click starts a fresh measurement rather than extending the old one.
    const next =
      current.a && current.b ? { a: point, b: null } : current.a
        ? { a: current.a, b: point }
        : { a: point, b: null }
    set({ measure: next })
    if (next.a && next.b) {
      const dx = next.b[0] - next.a[0]
      const dy = next.b[1] - next.a[1]
      const dz = next.b[2] - next.a[2]
      const d = Math.hypot(dx, dy, dz)
      get().setStatus(
        `${d.toFixed(2)} mm apart  (across ${dx.toFixed(2)}, along ${dy.toFixed(2)}, up ${dz.toFixed(2)})`,
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

  moveBodyBefore(bodyId, beforeId) {
    get().commit((d) => {
      const from = d.bodies.findIndex((b) => b.id === bodyId)
      const to = d.bodies.findIndex((b) => b.id === beforeId)
      if (from < 0 || to < 0 || from < to) return
      const [moved] = d.bodies.splice(from, 1)
      d.bodies.splice(to, 0, moved)
    })
  },

  addFeature(bodyId, feature) {
    get().commit((d) => {
      d.bodies.find((b) => b.id === bodyId)?.features.push(feature)
    })
  },

  updateFeature(bodyId, featureId, patch, opts) {
    get().commit(
      (d) => {
        const body = d.bodies.find((b) => b.id === bodyId)
        const index = body?.features.findIndex((f) => f.id === featureId) ?? -1
        if (body && index >= 0) {
          body.features[index] = { ...body.features[index], ...patch } as Feature
        }
      },
      {
        // A gizmo drag is one undo step, not one per frame. Merging alone is
        // not enough: a slow drag outlasts the merge window and would leave a
        // trail of half-moves behind it.
        transient: opts?.transient,
        mergeKey: `feature:${featureId}:${Object.keys(patch).join(',')}`,
      },
    )
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
    get().commit(
      (d) => {
        const i = d.placements.findIndex((p) => p.id === id)
        if (i >= 0) d.placements[i] = { ...d.placements[i], ...patch }
      },
      { ...opts, mergeKey: `placement:${id}:${Object.keys(patch).join(',')}` },
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
    // Always transient. Solving is what happens *because* of an edit, not an
    // edit in its own right; pushing history here meant every constraint,
    // fillet and trim cost two presses of Ctrl+Z to undo.
    get().editSketch((sketch) => applySolve(sketch, result), { transient: true })
    set({
      sketchStatus: {
        dof: result.dof,
        failing: result.failing,
        closed: feature.sketch.entities.some((e) => !e.construction),
        freePoints: result.freePoints,
        freeRadii: result.freeRadii,
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
            case 'trim': {
              const target = sketch.entities.find((e) => e.id === result.entityId)
              outcome =
                target && target.kind !== 'line'
                  ? trimRound(sketch, result.entityId, result.at, newId)
                  : trimLine(sketch, result.entityId, result.at, newId)
              break
            }
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
              outcome = offsetEntities(sketch, result.entityIds, result.distance, newId)
              break
            case 'addPolygon':
              outcome = addPolygon(
                sketch,
                result.centre,
                result.sides,
                result.radius,
                newId,
              )
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

      case 'standoff': {
        const seat = surfacePlane(get())
        if (!seat) break
        const plan = planPillar(result.kindOf, result.size, result.height)
        if (plan.warning) get().setStatus(plan.warning)
        get().addFeature(seat.bodyId, {
          id: newId('standoff'),
          kind: 'standoff',
          name: plan.name,
          // Pillars grow along the plane normal, so the same lifted plane that
          // puts a hole at the top surface stands a pillar on it.
          plane: seat.plane,
          source: { kind: 'explicit', positions: result.positions },
          height: result.height,
          outerDiameter: plan.outerDiameter,
          boreDiameter: plan.boreDiameter,
          boreDepth: plan.boreDepth,
          fastener: { kind: result.kindOf, size: result.size },
        })
        break
      }

      case 'fastener': {
        const seat = surfacePlane(get())
        if (!seat) break
        const plan = planHole(result.kindOf, result.size)
        get().addFeature(seat.bodyId, {
          id: newId('hole'),
          kind: 'hole',
          name: plan.name,
          plane: seat.plane,
          source: { kind: 'explicit', positions: result.positions },
          style: plan.style,
          diameter: plan.diameter,
          // The hole is measured from the surface it starts at, which is where
          // the plane has just been lifted to - not from where the sketch was
          // drawn, which may be somewhere in the middle of the part.
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

/**
 * The plane to hang a hole or a pillar off, given the sketch that is open.
 *
 * Both cut or grow along the sketch plane's normal, so the plane has to sit on
 * the far surface of the material: a hole started under the part comes out the
 * other side without touching it, and a pillar started there is buried inside
 * it. The offset is measured rather than assumed, because the sketch may be on
 * a base plane, on a face, or on something tilted - the built solid's corners
 * are projected onto the plane normal and the furthest one wins.
 */
function surfacePlane(state: AppState): { bodyId: string; plane: PlaneRef } | null {
  const active = state.activeSketch
  if (!active) return null
  const sketchFeature = activeSketchFeature(state)
  if (!sketchFeature) return null
  const frame = frameFromPlaneRefLocal(sketchFeature.plane)
  const built = state.shapes.find((sh) => sh.id === active.bodyId)
  let lift = 0
  if (built) {
    const [x0, y0, z0, x1, y1, z1] = built.bounds
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
    bodyId: active.bodyId,
    plane: { ...sketchFeature.plane, offset: sketchFeature.plane.offset + lift },
  }
}

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
