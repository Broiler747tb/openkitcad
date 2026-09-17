import type { Vec2 } from '../../core/math'
import type { SnapResult } from '../inference'
import type { NewConstraint, Sketch2D, SketchEntity } from '../types'

export type SketchToolId =
  | 'line'
  | 'rectangle'
  | 'rectangle3'
  | 'rectangleCentre'
  | 'circle'
  | 'circle2'
  | 'circle3'
  | 'arc'
  | 'arc3'
  | 'arcTangent'
  | 'polygon'
  | 'polygonInscribed'
  | 'polygonEdge'
  | 'ellipse'
  | 'slot'
  | 'slotOverall'
  | 'slotCentrePoint'
  | 'spline'
  | 'splineControl'
  | 'point'
  | 'text'

export type ToolAnchor = Pick<
  SnapResult,
  'point' | 'snapToPointId' | 'onEntityId' | 'onEntityKind' | 'align'
> & { turn?: number }

export type FieldKind = 'length' | 'angle' | 'count'

export interface ToolField {
  id: string
  label: string
  kind: FieldKind
  value: number
  at: Vec2
  locked: boolean
}

export interface ToolState {
  origin?: string
  anchors: ToolAnchor[]
  locked: Readonly<Record<string, number>>
  dims: Readonly<Record<string, number>>
  memory: Readonly<Record<string, number>>
}

export interface ToolFrame {
  anchor: ToolAnchor
  curves: Vec2[][]
  construction: Vec2[][]
  fields: ToolField[]
  memory?: Record<string, number>
  blocked?: string
}

type WithoutId<T> = T extends { id: string } ? Omit<T, 'id'> : never

export type NewEntity = WithoutId<SketchEntity>

export interface ToolWriter {
  sketch: Sketch2D
  point(anchor: ToolAnchor | Vec2): string
  entity(entity: NewEntity): string
  constrain(constraint: NewConstraint): void
}

export interface ToolBuild {
  chainFrom?: string
  chainStart?: string
  error?: string
  created?: string
}

export interface SketchToolSpec {
  id: SketchToolId
  label: string
  menu: string
  hint: string
  shortcut?: string
  prompts: readonly string[]
  clicks: number
  minimum?: number
  chain?: boolean
  frame(state: ToolState, cursor: ToolAnchor, sketch: Sketch2D): ToolFrame
  build(
    writer: ToolWriter,
    anchors: readonly ToolAnchor[],
    dims: Readonly<Record<string, number>>,
  ): ToolBuild
}
