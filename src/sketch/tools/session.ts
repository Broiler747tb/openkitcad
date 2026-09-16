import type { Vec2 } from '../../core/math'
import type { SnapResult } from '../inference'
import type { Constraint, Sketch2D, SketchEntity } from '../types'
import { freeAnchor } from './shapes'
import type {
  SketchToolSpec,
  ToolAnchor,
  ToolBuild,
  ToolFrame,
  ToolState,
  ToolWriter,
} from './types'

export function emptyToolState(): ToolState {
  return { anchors: [], locked: {}, dims: {}, memory: {} }
}

export function anchorFromSnap(snap: SnapResult): ToolAnchor {
  return {
    point: snap.point,
    snapToPointId: snap.snapToPointId,
    onEntityId: snap.onEntityId,
    onEntityKind: snap.onEntityKind,
    align: snap.align,
  }
}

export function lockField(state: ToolState, id: string, value: number | null): ToolState {
  const locked = { ...state.locked }
  if (value === null || !Number.isFinite(value)) delete locked[id]
  else locked[id] = value
  return { ...state, locked }
}

export function remember(state: ToolState, frame: ToolFrame): ToolState {
  return frame.memory ? { ...state, memory: frame.memory } : state
}

export function placeAnchor(
  spec: SketchToolSpec,
  state: ToolState,
  frame: ToolFrame,
): { state: ToolState; complete: boolean } {
  if (frame.blocked) return { state, complete: false }
  const anchors = [...state.anchors, frame.anchor]
  const next: ToolState = {
    origin: state.origin,
    anchors,
    locked: {},
    dims: { ...state.dims, ...state.locked },
    memory: {},
  }
  return { state: next, complete: spec.clicks > 0 && anchors.length >= spec.clicks }
}

export function canFinish(spec: SketchToolSpec, state: ToolState): boolean {
  return spec.clicks === 0 && state.anchors.length >= (spec.minimum ?? 1)
}

export function toolWriter(sketch: Sketch2D, newId: (prefix: string) => string): ToolWriter {
  const writer: ToolWriter = {
    sketch,
    point(input) {
      const anchor = Array.isArray(input) ? freeAnchor(input as Vec2) : (input as ToolAnchor)
      const existing = anchor.snapToPointId
      if (existing && sketch.points.some((p) => p.id === existing)) return existing
      const id = newId('p')
      sketch.points.push({ id, x: anchor.point[0], y: anchor.point[1] })
      const on = anchor.onEntityId
      if (on && sketch.entities.some((e) => e.id === on)) {
        if (anchor.onEntityKind === 'line') writer.constrain({ kind: 'pointOnLine', p: id, e: on })
        else if (anchor.onEntityKind === 'circle') {
          writer.constrain({ kind: 'pointOnCircle', p: id, e: on })
        } else if (anchor.onEntityKind === 'midpoint') {
          writer.constrain({ kind: 'midpoint', p: id, e: on })
        } else if (anchor.onEntityKind === 'curve') {
          writer.constrain({ kind: 'pointOnCurve', p: id, e: on })
        }
      }
      return id
    },
    entity(entity) {
      const id = newId('e')
      sketch.entities.push({ ...entity, id } as SketchEntity)
      return id
    },
    constrain(constraint) {
      sketch.constraints.push({ ...constraint, id: newId('c') } as Constraint)
    },
  }
  return writer
}

export function buildTool(
  spec: SketchToolSpec,
  sketch: Sketch2D,
  state: ToolState,
  newId: (prefix: string) => string,
): ToolBuild {
  return spec.build(toolWriter(sketch, newId), state.anchors, state.dims)
}

export function continueFrom(
  sketch: Sketch2D,
  pointId: string | undefined,
  origin?: string,
): ToolState {
  const p = pointId ? sketch.points.find((candidate) => candidate.id === pointId) : undefined
  if (!p || (origin && pointId === origin)) return emptyToolState()
  return {
    ...emptyToolState(),
    origin,
    anchors: [{ ...freeAnchor([p.x, p.y]), snapToPointId: p.id }],
  }
}
