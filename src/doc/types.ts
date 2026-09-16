import type { Vec2, Vec3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import type { FastenerKind, ThreadSize } from '../fasteners'
import type { CataloguePart } from '../catalogue/types'

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export type Matrix4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface Parameter {
  id: string
  name: string
  value: number
  expression?: string
  comment?: string
}

export interface ParameterBinding {
  featureId: string
  field: string
  expression: string
}

export type ElementKind = 'face' | 'edge' | 'vertex'

export interface ElementRef {
  bodyId: string
  kind: ElementKind
  name: string
}

export type PlaneRef =
  | { kind: 'named'; name: 'XY' | 'XZ' | 'YZ'; offset: number }
  | { kind: 'face'; face: ElementRef; offset: number }
  | {
      kind: 'angled'
      name: 'XY' | 'XZ' | 'YZ'
      tiltAxis: 'x' | 'y'
      angle: number
      offset: number
    }

export type BodyOperation =
  | { kind: 'newBody'; bodyId: string }
  | { kind: 'join'; bodyId: string }
  | { kind: 'cut'; bodyIds: string[] }
  | { kind: 'intersect'; bodyIds: string[] }

export type NewBodyOperation = Extract<BodyOperation, { kind: 'newBody' }>

export type AdditiveOperation = Extract<BodyOperation, { kind: 'newBody' | 'join' }>

interface FeatureBase {
  id: string
  name: string
  componentId: string
  suppressed?: boolean
}

export interface SketchFeature extends FeatureBase {
  kind: 'sketch'
  plane: PlaneRef
  sketch: Sketch2D
  visible: boolean
}

export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude'
  sketchId: string
  distance: number
  symmetric: boolean
  reverse: boolean
  draftAngle?: number
  result: BodyOperation
}

export interface RevolveFeature extends FeatureBase {
  kind: 'revolve'
  sketchId: string
  angle: number
  axis: 'x' | 'y'
  result: BodyOperation
}

export interface BoxFeature extends FeatureBase {
  kind: 'box'
  plane: PlaneRef
  origin: Vec2
  width: number
  depth: number
  height: number
  cornerRadius?: number
  result: BodyOperation
}

export interface CylinderFeature extends FeatureBase {
  kind: 'cylinder'
  plane: PlaneRef
  centre: Vec2
  radius: number
  height: number
  result: BodyOperation
}

export interface SphereFeature extends FeatureBase {
  kind: 'sphere'
  plane: PlaneRef
  centre: Vec2
  radius: number
  half: boolean
  result: BodyOperation
}

export interface FilletFeature extends FeatureBase {
  kind: 'fillet'
  bodyId: string
  radius: number
  edges: ElementRef[]
}

export interface ChamferFeature extends FeatureBase {
  kind: 'chamfer'
  bodyId: string
  distance: number
  edges: ElementRef[]
}

export interface ShellFeature extends FeatureBase {
  kind: 'shell'
  bodyId: string
  thickness: number
  openFaces: ElementRef[]
}

export type HoleStyle = 'simple' | 'counterbore' | 'countersink' | 'tapped'

export type PositionSource =
  | { kind: 'explicit'; positions: Vec2[] }
  | { kind: 'occurrence'; occurrencePath: string[]; contextPath: string[]; holeIds?: string[] }

export interface HoleFeature extends FeatureBase {
  kind: 'hole'
  bodyId: string
  plane: PlaneRef
  source: PositionSource
  style: HoleStyle
  diameter: number
  depth: 'through' | number
  counterboreDiameter?: number
  counterboreDepth?: number
  countersinkAngle?: number
  fastener?: { kind: FastenerKind; size: ThreadSize }
}

export interface StandoffFeature extends FeatureBase {
  kind: 'standoff'
  plane: PlaneRef
  source: PositionSource
  height: number
  outerDiameter: number
  boreDiameter: number
  boreDepth: number
  fastener?: { kind: FastenerKind; size: ThreadSize }
  result: AdditiveOperation
}

export interface PortCutoutFeature extends FeatureBase {
  kind: 'portCutout'
  bodyId: string
  occurrencePath: string[]
  contextPath: string[]
  connectorIds: string[]
  tolerance: number
}

export interface CombineFeature extends FeatureBase {
  kind: 'combine'
  bodyId: string
  toolBodyIds: string[]
  operation: 'join' | 'cut' | 'intersect'
  keepTools: boolean
}

export type VentShape =
  'hex' | 'round' | 'square' | 'triangle' | 'diamond' | 'slot' | 'cross' | 'gyroid'

export interface VentFeature extends FeatureBase {
  kind: 'vent'
  bodyId: string
  plane: PlaneRef
  shape: VentShape
  size: number
  spacing: number
  margin: number
  depth: 'through' | number
}

export type LidFit = 'friction' | 'ledge' | 'snap'

export interface LidFeature extends FeatureBase {
  kind: 'lid'
  sourceBodyId: string
  shellFeatureId: string
  thickness: number
  clearance: number
  fit: LidFit
  result: NewBodyOperation
}

export interface LidSocketFeature extends FeatureBase {
  kind: 'lidSocket'
  bodyId: string
  lidFeatureId: string
}

export interface MoveFeature extends FeatureBase {
  kind: 'move'
  bodyIds: string[]
  offset: Vec3
  rotation: Vec3
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | BoxFeature
  | CylinderFeature
  | SphereFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | HoleFeature
  | StandoffFeature
  | PortCutoutFeature
  | CombineFeature
  | VentFeature
  | LidFeature
  | LidSocketFeature
  | MoveFeature

export type FeatureKind = Feature['kind']

export interface Body {
  id: string
  name: string
  visible: boolean
  colour: string
  negative?: boolean
}

export type ComponentSource =
  { kind: 'design' } | { kind: 'catalogue'; partId: string; overrides?: Record<string, number> }

export interface Component {
  id: string
  name: string
  source: ComponentSource
  bodies: Body[]
}

export interface Occurrence {
  id: string
  parentComponentId: string
  componentId: string
  name: string
  transform: Matrix4
  visible: boolean
  grounded: boolean
  negative?: boolean
}

export interface TimelineGroup {
  id: string
  name: string
  firstId: string
  lastId: string
  collapsed: boolean
}

export interface OkcDocument {
  format: 'openkitcad'
  version: 2
  name: string
  units: LengthUnit
  parameters: Parameter[]
  bindings: ParameterBinding[]
  rootComponentId: string
  components: Component[]
  occurrences: Occurrence[]
  timeline: Feature[]
  marker: number | null
  groups: TimelineGroup[]
  customParts?: CataloguePart[]
}

export const ROOT_COMPONENT_ID = 'root'

export function emptyDocument(name = 'Untitled'): OkcDocument {
  return {
    format: 'openkitcad',
    version: 2,
    name,
    units: 'mm',
    parameters: [],
    bindings: [],
    rootComponentId: ROOT_COMPONENT_ID,
    components: [{ id: ROOT_COMPONENT_ID, name, source: { kind: 'design' }, bodies: [] }],
    occurrences: [],
    timeline: [],
    marker: null,
    groups: [],
  }
}

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  hole: 'Hole',
  standoff: 'Standoff',
  portCutout: 'Port Cutout',
  combine: 'Combine',
  vent: 'Vent Pattern',
  lid: 'Lid',
  lidSocket: 'Lid Seat',
  move: 'Move',
}

export const FEATURE_HINT: Record<FeatureKind, string> = {
  sketch: 'A flat drawing on a plane that solids are built from.',
  extrude: 'Pushes a closed sketch profile into a solid.',
  revolve: 'Spins a sketch profile around an axis.',
  box: 'A rectangular block with exact sizes.',
  cylinder: 'A round rod or disc with exact sizes.',
  sphere: 'A ball, or half of one sitting on a plane.',
  fillet: 'Rounds off the chosen edges.',
  chamfer: 'Cuts the chosen edges off at an angle.',
  shell: 'Hollows the body out, leaving walls and an opening.',
  hole: 'Drills holes, plain, counterbored or countersunk.',
  standoff: 'Printed pillars that a board screws onto.',
  portCutout: "Cuts openings for a part's connectors through a wall.",
  combine: 'Joins, cuts or intersects bodies with each other.',
  vent: 'A grid of ventilation holes inside a solid border.',
  lid: 'A lid that fits the opening a Shell left.',
  lidSocket: 'The ledge or groove a lid sits in.',
  move: 'Moves and turns bodies by exact amounts.',
}

export const FEATURE_ICON: Record<FeatureKind, string> = {
  sketch: '✎',
  extrude: '⬛',
  revolve: '◑',
  box: '▢',
  cylinder: '○',
  sphere: '●',
  fillet: '◜',
  chamfer: '◢',
  shell: '▣',
  hole: '⊙',
  standoff: '║',
  portCutout: '⬚',
  combine: '◍',
  vent: '⁙',
  lid: '▭',
  lidSocket: '⊓',
  move: '✚',
}
