/**
 * The document model.
 *
 * One document holds several bodies (each with its own ordered feature
 * history) plus instances of catalogue parts positioned in the same space.
 * There is no separate "assembly mode": a beginner should never have to learn
 * file management to see their board sitting on their plate.
 *
 * ---------------------------------------------------------------------------
 * On referring to faces and edges
 *
 * Every parametric CAD has the same hard problem: a feature says "fillet that
 * edge", the model is rebuilt with different numbers, and the kernel hands back
 * a differently-ordered edge list. Index-based references then silently point
 * at the wrong edge.
 *
 * A full solution needs persistent topological naming, which is a research
 * problem in its own right. Instead this stores a geometric fingerprint of what
 * was picked - a point on it, plus a normal or a length - and re-finds the
 * closest match on rebuild. That is honest about being a heuristic, degrades
 * predictably (a small parameter change keeps the right face), and is enough
 * for the kind of models this app is for.
 */
import type { Vec2, Vec3 } from '../core/math'
import type { Sketch2D } from '../sketch/types'

export interface Parameter {
  id: string
  /** Referenced in expressions as this exact name. */
  name: string
  value: number
  comment?: string
}

/** Geometric fingerprint of a picked face. */
export interface FaceRef {
  bodyId: string
  /** A point on the face when it was picked, in world mm. */
  anchor: Vec3
  /** Outward normal at pick time. */
  normal: Vec3
}

/** Geometric fingerprint of a picked edge. */
export interface EdgeRef {
  bodyId: string
  /** Midpoint of the edge at pick time. */
  anchor: Vec3
  length: number
}

export type PlaneRef =
  | { kind: 'named'; name: 'XY' | 'XZ' | 'YZ'; offset: number }
  | { kind: 'face'; face: FaceRef; offset: number }
  /**
   * A base plane tipped over about one of its own axes. Enough for the things
   * people actually need an angled plane for - a sloped face, a bracket at 30
   * degrees - without a general plane-definition dialog.
   */
  | {
      kind: 'angled'
      name: 'XY' | 'XZ' | 'YZ'
      tiltAxis: 'x' | 'y'
      angle: number
      offset: number
    }

/** How a solid feature combines with what came before it in the body. */
export type BooleanOp = 'new' | 'add' | 'cut' | 'intersect'

interface FeatureBase {
  id: string
  name: string
  suppressed?: boolean
}

export interface SketchFeature extends FeatureBase {
  kind: 'sketch'
  plane: PlaneRef
  sketch: Sketch2D
}

export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude'
  sketchId: string
  distance: number
  /** Grow the same distance both ways from the sketch plane. */
  symmetric: boolean
  /** Extrude against the plane normal instead of along it. */
  reverse: boolean
  operation: BooleanOp
  /** Optional wall taper, in degrees. */
  draftAngle?: number
}

export interface RevolveFeature extends FeatureBase {
  kind: 'revolve'
  sketchId: string
  /** Degrees. */
  angle: number
  /** Axis in sketch coordinates. */
  axis: 'x' | 'y'
  operation: BooleanOp
}

export interface BoxFeature extends FeatureBase {
  kind: 'box'
  plane: PlaneRef
  /** Lower-left corner in plane coordinates. */
  origin: Vec2
  width: number
  depth: number
  height: number
  cornerRadius?: number
  operation: BooleanOp
}

export interface CylinderFeature extends FeatureBase {
  kind: 'cylinder'
  plane: PlaneRef
  centre: Vec2
  radius: number
  height: number
  operation: BooleanOp
}

export interface FilletFeature extends FeatureBase {
  kind: 'fillet'
  radius: number
  /** Empty means every edge. */
  edges: EdgeRef[]
}

export interface ChamferFeature extends FeatureBase {
  kind: 'chamfer'
  distance: number
  edges: EdgeRef[]
}

export interface ShellFeature extends FeatureBase {
  kind: 'shell'
  thickness: number
  /** Faces to remove, leaving the shell open there. */
  openFaces: FaceRef[]
}

export type HoleStyle = 'simple' | 'counterbore' | 'countersink' | 'tapped'

/**
 * Holes, either at explicit positions or - the interesting case - derived live
 * from a placed catalogue part, so moving the board moves its holes.
 */
export interface HoleFeature extends FeatureBase {
  kind: 'hole'
  plane: PlaneRef
  source:
    | { kind: 'explicit'; positions: Vec2[] }
    | { kind: 'placement'; placementId: string; holeIds?: string[] }
  style: HoleStyle
  diameter: number
  /** `through` cuts past the far side of the body whatever its thickness. */
  depth: 'through' | number
  counterboreDiameter?: number
  counterboreDepth?: number
  /** Included angle for countersinks, degrees. */
  countersinkAngle?: number
}

export interface StandoffFeature extends FeatureBase {
  kind: 'standoff'
  plane: PlaneRef
  source:
    | { kind: 'explicit'; positions: Vec2[] }
    | { kind: 'placement'; placementId: string; holeIds?: string[] }
  height: number
  outerDiameter: number
  /** Bore for a self-tapping screw or a heat-set insert. */
  boreDiameter: number
  boreDepth: number
}

export interface PortCutoutFeature extends FeatureBase {
  kind: 'portCutout'
  placementId: string
  /** Connector ids on the placed part. Empty means all of them. */
  connectorIds: string[]
  /** Extra clearance added all round, per side. */
  tolerance: number
}

/**
 * Merge another body into this one.
 *
 * References a body rather than copying it, so editing the tool body updates
 * the result. The referenced body has to appear earlier in the list, because
 * bodies are evaluated in order and a later one has not been built yet.
 */
export interface CombineFeature extends FeatureBase {
  kind: 'combine'
  otherBodyId: string
  operation: 'add' | 'cut' | 'intersect'
  /** Leave the other body on screen as well, rather than consuming it. */
  keepOther: boolean
}

export type Feature =
  | SketchFeature
  | CombineFeature
  | ExtrudeFeature
  | RevolveFeature
  | BoxFeature
  | CylinderFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | HoleFeature
  | StandoffFeature
  | PortCutoutFeature

export type FeatureKind = Feature['kind']

export interface Body {
  id: string
  name: string
  visible: boolean
  colour: string
  features: Feature[]
}

/** An instance of a catalogue part positioned in the document. */
export interface Placement {
  id: string
  partId: string
  name: string
  /** Position of the part's origin corner, in world mm. */
  position: Vec3
  /** Rotation about the vertical axis, in degrees. */
  rotation: number
  /** Flip upside down, e.g. to hang a board under a plate. */
  flipped: boolean
  visible: boolean
  /** Overrides for parametric parts, e.g. extrusion length. */
  overrides?: Record<string, number>
}

export interface OkcDocument {
  version: 1
  name: string
  units: 'mm'
  parameters: Parameter[]
  bodies: Body[]
  placements: Placement[]
}

export function emptyDocument(name = 'Untitled'): OkcDocument {
  return {
    version: 1,
    name,
    units: 'mm',
    parameters: [],
    bodies: [],
    placements: [],
  }
}

/** Human labels for the feature tree. Plain English, not CAD jargon. */
export const FEATURE_LABEL: Record<FeatureKind, string> = {
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  box: 'Box',
  cylinder: 'Cylinder',
  fillet: 'Round edges',
  chamfer: 'Bevel edges',
  shell: 'Hollow out',
  hole: 'Holes',
  standoff: 'Standoffs',
  portCutout: 'Port openings',
  combine: 'Combine',
}

export const FEATURE_ICON: Record<FeatureKind, string> = {
  sketch: '✎',
  extrude: '⬛',
  revolve: '◑',
  box: '▢',
  cylinder: '○',
  fillet: '◜',
  chamfer: '◢',
  shell: '▣',
  hole: '⊙',
  standoff: '║',
  portCutout: '⬚',
  combine: '◍',
}
