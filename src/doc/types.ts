import type { Vec2, Vec3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'
import type { FastenerKind, ThreadSize } from '../fasteners'
import type { CataloguePart } from '../catalogue/types'
import type { DofLimits, DofReference, JointMotion } from '../assembly/types'
import type { EncodedMesh } from '../mesh/blob'

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
  surface?: boolean
  kind: 'extrude'
  sketchId: string
  profiles?: string[]
  distance: number
  symmetric: boolean
  reverse: boolean
  draftAngle?: number
  result: BodyOperation
}

export interface RevolveFeature extends FeatureBase {
  surface?: boolean
  kind: 'revolve'
  sketchId: string
  profiles?: string[]
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

export interface OffsetFaceFeature extends FeatureBase {
  kind: 'offsetFace'
  bodyId: string
  faces: ElementRef[]
  distance: number
}

export interface DraftFeature extends FeatureBase {
  kind: 'draft'
  bodyId: string
  faces: ElementRef[]
  plane: PlaneRef
  angle: number
  flip: boolean
}

export interface LoftSection {
  sketchId: string
  profiles?: string[]
}

export interface LoftFeature extends FeatureBase {
  kind: 'loft'
  sections: LoftSection[]
  ruled: boolean
  surface: boolean
  result: BodyOperation
}

export interface SweepFeature extends FeatureBase {
  kind: 'sweep'
  sketchId: string
  profiles?: string[]
  pathSketchId: string
  surface: boolean
  result: BodyOperation
}

export type CoilSection = 'circular' | 'square' | 'triangleOutside' | 'triangleInside'

export interface CoilFeature extends FeatureBase {
  kind: 'coil'
  plane: PlaneRef
  centre: Vec2
  diameter: number
  revolutions: number
  height: number
  section: CoilSection
  sectionSize: number
  clockwise: boolean
  result: BodyOperation
}

export interface PipeFeature extends FeatureBase {
  kind: 'pipe'
  pathSketchId: string
  section: 'circular' | 'square' | 'triangular'
  size: number
  hollow: boolean
  thickness: number
  result: BodyOperation
}

export interface ThickenFeature extends FeatureBase {
  kind: 'thicken'
  sourceBodyId: string
  thickness: number
  symmetric: boolean
  result: BodyOperation
}

export interface PatchFeature extends FeatureBase {
  kind: 'patch'
  sketchId: string
  profiles?: string[]
  bodyId: string
}

export interface BodyPatternFeature extends FeatureBase {
  kind: 'bodyPattern'
  bodyIds: string[]
  pattern: 'rectangular' | 'circular'
  axisOne: 'x' | 'y' | 'z'
  countOne: number
  spacingOne: number
  axisTwo: 'x' | 'y' | 'z'
  countTwo: number
  spacingTwo: number
  axis: 'x' | 'y' | 'z'
  count: number
  angle: number
  newBodyIds: string[]
}

export interface MirrorFeature extends FeatureBase {
  kind: 'mirror'
  bodyIds: string[]
  plane: PlaneRef
  newBodyIds: string[]
}

export interface SplitBodyFeature extends FeatureBase {
  kind: 'splitBody'
  bodyId: string
  plane: PlaneRef
  newBodyId: string
}

export interface ScaleFeature extends FeatureBase {
  kind: 'scale'
  bodyIds: string[]
  factor: number
}

export interface StitchFeature extends FeatureBase {
  kind: 'stitch'
  bodyIds: string[]
  tolerance: number
}

export interface UnstitchFeature extends FeatureBase {
  kind: 'unstitch'
  bodyId: string
  newBodyIds: string[]
}

export interface SurfaceOffsetFeature extends FeatureBase {
  kind: 'surfaceOffset'
  sourceBodyId: string
  distance: number
  bodyId: string
}

export interface ReverseNormalFeature extends FeatureBase {
  kind: 'reverseNormal'
  bodyIds: string[]
}

export type MeshRefinement = 'coarse' | 'medium' | 'high'

export interface MeshInsertFeature extends FeatureBase {
  kind: 'meshInsert'
  bodyId: string
  dataId: string
  transform: Matrix4
  unit: LengthUnit | 'um'
  yUp: boolean
  centre: boolean
  ground: boolean
}

export interface TessellateFeature extends FeatureBase {
  kind: 'tessellate'
  sourceBodyId: string
  bodyId: string
  refinement: MeshRefinement
}

export interface MeshRepairFeature extends FeatureBase {
  kind: 'meshRepair'
  bodyId: string
  closeHoles: boolean
}

export interface MeshReduceFeature extends FeatureBase {
  kind: 'meshReduce'
  bodyId: string
  method: 'proportion' | 'tolerance' | 'count'
  proportion: number
  tolerance: number
  count: number
}

export interface MeshRemeshFeature extends FeatureBase {
  kind: 'meshRemesh'
  bodyId: string
  edgeLength: number
  preserveSharp: boolean
}

export interface MeshSmoothFeature extends FeatureBase {
  kind: 'meshSmooth'
  bodyId: string
  strength: number
  iterations: number
}

export interface MeshReverseFeature extends FeatureBase {
  kind: 'meshReverse'
  bodyIds: string[]
}

export interface MeshPlaneCutFeature extends FeatureBase {
  kind: 'meshPlaneCut'
  bodyId: string
  plane: PlaneRef
  flip: boolean
  fill: boolean
  keep: 'both' | 'front' | 'back'
  newBodyId: string
}

export interface MeshSeparateFeature extends FeatureBase {
  kind: 'meshSeparate'
  bodyId: string
  newBodyIds: string[]
}

export interface MeshCombineFeature extends FeatureBase {
  kind: 'meshCombine'
  bodyId: string
  toolBodyIds: string[]
}

export interface MeshConvertFeature extends FeatureBase {
  kind: 'meshConvert'
  sourceBodyId: string
  bodyId: string
  method: 'faceted' | 'prismatic'
}

export type JointKeypoint = 'centre' | 'middle' | 'point' | 'origin'

export interface JointSnap {
  ref: ElementRef | null
  keypoint: JointKeypoint
  originId?: string
}

export interface JointSide {
  occurrencePath: string[]
  snap: JointSnap
  frame: Matrix4
}

export interface JointFeature extends FeatureBase {
  kind: 'joint'
  asBuilt: boolean
  one: JointSide
  two: JointSide
  motion: JointMotion
  flip: boolean
  angle: number
  offset: number
  values: number[]
  limits: DofLimits[]
  locked?: boolean
}

export interface JointOriginFeature extends FeatureBase {
  kind: 'jointOrigin'
  snap: JointSnap
  base: Matrix4
  offset: Vec3
  angle: number
  flip: boolean
}

export interface MotionStudyKey {
  step: number
  value: number
}

export interface MotionStudyTrack {
  jointId: string
  dof: number
  keys: MotionStudyKey[]
}

export interface MotionStudyFeature extends FeatureBase {
  kind: 'motionStudy'
  steps: number
  tracks: MotionStudyTrack[]
}

export interface RigidGroupFeature extends FeatureBase {
  kind: 'rigidGroup'
  members: string[][]
}

export interface MotionLinkFeature extends FeatureBase {
  kind: 'motionLink'
  a: DofReference
  b: DofReference
  ratio: number
  offset: number
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
  | JointFeature
  | JointOriginFeature
  | RigidGroupFeature
  | MotionLinkFeature
  | MotionStudyFeature
  | MeshInsertFeature
  | TessellateFeature
  | MeshRepairFeature
  | MeshReduceFeature
  | MeshRemeshFeature
  | MeshSmoothFeature
  | MeshReverseFeature
  | MeshPlaneCutFeature
  | MeshSeparateFeature
  | MeshCombineFeature
  | MeshConvertFeature
  | LoftFeature
  | SweepFeature
  | CoilFeature
  | PipeFeature
  | ThickenFeature
  | PatchFeature
  | BodyPatternFeature
  | MirrorFeature
  | SplitBodyFeature
  | ScaleFeature
  | StitchFeature
  | UnstitchFeature
  | OffsetFaceFeature
  | DraftFeature
  | SurfaceOffsetFeature
  | ReverseNormalFeature

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
  meshData?: Record<string, EncodedMesh>
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
  joint: 'Joint',
  jointOrigin: 'Joint Origin',
  rigidGroup: 'Rigid Group',
  motionLink: 'Motion Link',
  motionStudy: 'Motion Study',
  meshInsert: 'Insert Mesh',
  tessellate: 'Tessellate',
  meshRepair: 'Repair',
  meshReduce: 'Reduce',
  meshRemesh: 'Remesh',
  meshSmooth: 'Smooth',
  meshReverse: 'Reverse Normal',
  meshPlaneCut: 'Plane Cut',
  meshSeparate: 'Separate',
  meshCombine: 'Combine Meshes',
  meshConvert: 'Convert Mesh',
  loft: 'Loft',
  sweep: 'Sweep',
  coil: 'Coil',
  pipe: 'Pipe',
  thicken: 'Thicken',
  patch: 'Patch',
  bodyPattern: 'Pattern',
  mirror: 'Mirror',
  splitBody: 'Split Body',
  scale: 'Scale',
  stitch: 'Stitch',
  unstitch: 'Unstitch',
  surfaceOffset: 'Offset Surface',
  reverseNormal: 'Reverse Normal',
  offsetFace: 'Offset Face',
  draft: 'Draft',
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
  joint: 'Holds two components together, with the motion left between them.',
  jointOrigin: 'A saved snap point on a component that joints can use.',
  rigidGroup: 'Locks components together so they move as one.',
  motionLink: 'Ties the motion of one joint to another.',
  motionStudy: 'Moves joints over time so the mechanism can be played back.',
  meshInsert: 'A mesh read from an STL, OBJ or 3MF file.',
  tessellate: 'Turns a solid into a mesh of triangles.',
  meshRepair: 'Joins loose triangles, turns them all the same way and closes holes.',
  meshReduce: 'Uses fewer, larger triangles while keeping the shape.',
  meshRemesh: 'Rebuilds the mesh from evenly sized triangles.',
  meshSmooth: 'Evens out bumps and noise in the surface.',
  meshReverse: 'Turns the mesh inside out.',
  meshPlaneCut: 'Cuts a mesh in two along a plane, and can close the cut.',
  meshSeparate: 'Splits a mesh into one body per loose piece.',
  meshCombine: 'Merges meshes into one mesh body.',
  meshConvert: 'Turns a mesh into a solid body made of flat faces.',
  loft: 'A shape that blends from one profile to the next.',
  sweep: 'A profile carried along a path.',
  coil: 'A spring or thread-like helix.',
  pipe: 'A round, square or triangular tube along a path.',
  thicken: 'Gives a surface a thickness so it becomes a solid.',
  patch: 'A surface filling a closed outline.',
  bodyPattern: 'Copies of bodies in rows, columns or around an axis.',
  mirror: 'A mirror image of bodies across a plane.',
  splitBody: 'Cuts a body in two along a plane.',
  scale: 'Makes bodies bigger or smaller.',
  stitch: 'Joins surfaces along their edges, closing them into a solid when they meet all round.',
  unstitch: 'Breaks a body into one surface per face.',
  surfaceOffset: 'A copy of a surface moved a set distance along its normal.',
  reverseNormal: 'Turns a surface inside out.',
  offsetFace: 'Moves flat faces of a body in or out, stretching the faces around them.',
  draft: 'Tilts faces by an angle so the part slides out of a mould.',
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
  joint: '⚭',
  jointOrigin: '⊕',
  rigidGroup: '⛓',
  motionLink: '⟲',
  motionStudy: '⏵',
  meshInsert: '▲',
  tessellate: '◬',
  meshRepair: '✚',
  meshReduce: '▼',
  meshRemesh: '◇',
  meshSmooth: '≈',
  meshReverse: '⇅',
  meshPlaneCut: '⊟',
  meshSeparate: '⧉',
  meshCombine: '⊞',
  meshConvert: '⬢',
  loft: '◭',
  sweep: '⤳',
  coil: '➰',
  pipe: '◯',
  thicken: '▰',
  patch: '▭',
  bodyPattern: '⁂',
  mirror: '⧓',
  splitBody: '⊘',
  scale: '⤢',
  stitch: '⧢',
  unstitch: '⧣',
  surfaceOffset: '⧈',
  reverseNormal: '⇵',
  offsetFace: '⇱',
  draft: '◿',
}
