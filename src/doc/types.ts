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
import type { FastenerKind, ThreadSize } from '../fasteners'

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
  /**
   * Which fastener this was made for, when it came from the screws and pillars
   * menu. Carried only so the viewport can draw a ghost of the thing that is
   * going in; nothing geometric reads it.
   */
  fastener?: { kind: FastenerKind; size: ThreadSize }
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
  /**
   * Which fastener this was made for, when it came from the screws and pillars
   * menu. Carried only so the viewport can draw a ghost of the thing that is
   * going in; nothing geometric reads it.
   */
  fastener?: { kind: FastenerKind; size: ThreadSize }
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

/** A ball, or half a ball sitting flat on its plane. */
export interface SphereFeature extends FeatureBase {
  kind: 'sphere'
  plane: PlaneRef
  centre: Vec2
  radius: number
  /** Cut in half, flat side down on the plane. */
  half: boolean
  operation: BooleanOp
}

/**
 * A grid of holes for ventilation.
 *
 * `margin` is the solid border left round the outside - the thing you actually
 * care about, since a vent grille that runs off the edge of a panel leaves
 * paper-thin slivers that break off.
 */
/**
 * Hole shapes for a vent.
 *
 * All of them tile without leaving slivers, which is the thing that actually
 * matters: a pattern whose webs pinch to nothing somewhere prints as a row of
 * loose threads.
 */
export type VentShape =
  | 'hex'
  | 'round'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'slot'
  | 'cross'
  | 'gyroid'

export interface VentFeature extends FeatureBase {
  kind: 'vent'
  plane: PlaneRef
  shape: VentShape
  /**
   * Across the flats for a hexagon, diameter for a circle, side for a square
   * or diamond, arm span for a cross, length for a slot. For the gyroid it is
   * the size of one repeat of the pattern, since that shape has no single hole
   * to measure.
   */
  size: number
  /** Material left between neighbouring holes. */
  spacing: number
  /** Solid border round the edge of the face. */
  margin: number
  depth: 'through' | number
}

/**
 * How a lid is held on.
 *
 * All three drop straight down into the opening - none needs the lid turned,
 * slid or threaded, because a beginner printing their first enclosure should
 * not have to get a bayonet to line up.
 */
export type LidFit =
  /** Held by friction alone. Simplest, and comes off with a fingernail. */
  | 'friction'
  /** Rests on a step cut into the wall, so it cannot drop through. */
  | 'ledge'
  /** A skirt with a bead round it that clicks into a groove in the wall. */
  | 'snap'

/** A cap for the opening left by hollowing something out. */
export interface LidFeature extends FeatureBase {
  kind: 'lid'
  /** The hollowed body this caps. */
  sourceBodyId: string
  /** The shell feature whose opening is being capped. */
  shellFeatureId: string
  thickness: number
  /**
   * Gap left all round between the lid and the walls it drops between, so that
   * a printed one goes in. Zero gives a lid that is exactly the size of the
   * hole, which is right on screen and wrong on a print bed.
   *
   * Optional because documents saved before this existed had no gap; they keep
   * behaving as they did rather than silently changing size on load.
   */
  clearance?: number
  /** Optional for the same reason: anything saved before this is a plain fit. */
  fit?: LidFit
}

/**
 * The other half of a lid: whatever has to be cut into the box for the lid to
 * fit it - a step for the lid to rest on, a groove for its bead to click into.
 *
 * It lives in the box's own history rather than the lid's, because that is the
 * part it removes material from, and the two have to be built in that order.
 * It holds no numbers of its own: it reads them off the lid feature it names,
 * so the two halves cannot drift apart when one of them is edited.
 */
export interface LidSocketFeature extends FeatureBase {
  kind: 'lidSocket'
  /** The body holding the lid feature. */
  lidBodyId: string
  lidFeatureId: string
}

/**
 * Move and turn a body.
 *
 * A step in the history rather than a field on the body, which matters because
 * a sketch drawn on a face records where that face was at the time. Put the
 * move in the history and anything drawn before it stays put relative to the
 * shape, while anything drawn afterwards sees the shape where it now is. A
 * body-level transform would silently strand every face-anchored sketch the
 * moment the part was nudged.
 */
export interface MoveFeature extends FeatureBase {
  kind: 'move'
  /** How far to shift it, in mm. */
  offset: Vec3
  /** Turn about the body's own centre, degrees per axis, X then Y then Z. */
  rotation: Vec3
}

export type Feature =
  | MoveFeature
  | LidSocketFeature
  | SketchFeature
  | CombineFeature
  | SphereFeature
  | VentFeature
  | LidFeature
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
  /**
   * Treat this as a hole rather than material: it is cut out of every other
   * part instead of being one.
   *
   * A flag rather than a combine step on each part it should cut, because the
   * thing a beginner wants to say is "this block is a hole" - once, about the
   * block - not "subtract this from that" once per part it passes through.
   */
  negative?: boolean
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
  /**
   * Cut this part's own shape out of everything around it.
   *
   * The point is the pocket, not the board: dropping a Pi in, saying "make it a
   * hole" and getting a Pi-shaped recess is how you build a case around one.
   */
  negative?: boolean
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
  move: 'Move and turn',
  sphere: 'Ball',
  vent: 'Vent holes',
  lid: 'Lid',
  lidSocket: 'Lid seat',
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
  move: '✚',
  sphere: '●',
  vent: '⁙',
  lid: '▭',
  lidSocket: '⊓',
}
