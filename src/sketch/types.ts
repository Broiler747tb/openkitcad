/**
 * The 2D sketch model.
 *
 * A sketch is a bag of points, entities that reference those points by id, and
 * constraints that reference both. Keeping geometry point-indexed (rather than
 * each line owning its own coordinates) is what makes coincidence free: two
 * lines that share a corner literally share one point, so dragging one drags
 * the other with no solving required.
 */

export type PointId = string
export type EntityId = string
export type ConstraintId = string

export interface SketchPoint {
  id: PointId
  x: number
  y: number
}

export interface LineEntity {
  id: EntityId
  kind: 'line'
  p1: PointId
  p2: PointId
  construction: boolean
}

export interface CircleEntity {
  id: EntityId
  kind: 'circle'
  c: PointId
  /** Radius is a solver variable in its own right. */
  r: number
  construction: boolean
}

export interface ArcEntity {
  id: EntityId
  kind: 'arc'
  c: PointId
  p1: PointId
  p2: PointId
  /** Sweep direction from p1 to p2. */
  ccw: boolean
  construction: boolean
}

export type SketchEntity = LineEntity | CircleEntity | ArcEntity

/**
 * Constraint vocabulary. Deliberately small: every one of these can be
 * explained to a beginner in a short sentence, and together they cover
 * everything the auto-constrainer needs to infer.
 */
export type Constraint =
  | { id: ConstraintId; kind: 'coincident'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'fix'; p: PointId; x: number; y: number }
  | { id: ConstraintId; kind: 'horizontal'; e: EntityId }
  | { id: ConstraintId; kind: 'vertical'; e: EntityId }
  | { id: ConstraintId; kind: 'parallel'; a: EntityId; b: EntityId }
  | { id: ConstraintId; kind: 'perpendicular'; a: EntityId; b: EntityId }
  | { id: ConstraintId; kind: 'equal'; a: EntityId; b: EntityId }
  | { id: ConstraintId; kind: 'pointOnLine'; p: PointId; e: EntityId }
  | { id: ConstraintId; kind: 'pointOnCircle'; p: PointId; e: EntityId }
  | { id: ConstraintId; kind: 'midpoint'; p: PointId; e: EntityId }
  | { id: ConstraintId; kind: 'tangent'; line: EntityId; circle: EntityId; side: 1 | -1 }
  /**
   * Two arcs or circles touching. `side` is +1 when they sit outside each other
   * and -1 when the second is nested inside the first. Needed so that rounding
   * a corner where one side is already curved stays as defined as it was.
   */
  | { id: ConstraintId; kind: 'tangentArcs'; a: EntityId; b: EntityId; side: 1 | -1 }
  | { id: ConstraintId; kind: 'symmetric'; a: PointId; b: PointId; line: EntityId }
  | { id: ConstraintId; kind: 'distance'; a: PointId; b: PointId; value: number }
  | { id: ConstraintId; kind: 'distanceX'; a: PointId; b: PointId; value: number }
  | { id: ConstraintId; kind: 'distanceY'; a: PointId; b: PointId; value: number }
  | { id: ConstraintId; kind: 'radius'; e: EntityId; value: number }
  | { id: ConstraintId; kind: 'diameter'; e: EntityId; value: number }
  /** Angle between two lines, in degrees. */
  | { id: ConstraintId; kind: 'angle'; a: EntityId; b: EntityId; value: number }

export type ConstraintKind = Constraint['kind']

/**
 * A constraint before it has been given an id.
 *
 * Plain `Omit<Constraint, 'id'>` does not work here: applied to a union, Omit
 * collapses it to only the keys every member shares, which is just `kind`.
 * Distributing over the union first keeps each variant's own fields.
 */
export type NewConstraint = Constraint extends infer T
  ? T extends { id: string }
    ? Omit<T, 'id'>
    : never
  : never

/** Constraints the user types a number into; these show as editable labels. */
export const DIMENSION_KINDS: ConstraintKind[] = [
  'distance',
  'distanceX',
  'distanceY',
  'radius',
  'diameter',
  'angle',
]

export function isDimension(c: Constraint): boolean {
  return DIMENSION_KINDS.includes(c.kind)
}

export interface Sketch2D {
  points: SketchPoint[]
  entities: SketchEntity[]
  constraints: Constraint[]
}

export function emptySketch(): Sketch2D {
  // Every sketch owns a fixed origin. Without it a sketch can slide freely in
  // the plane and the solver has two permanent degrees of freedom that no
  // amount of user dimensioning will ever remove.
  return {
    points: [{ id: 'origin', x: 0, y: 0 }],
    entities: [],
    constraints: [{ id: 'c-origin', kind: 'fix', p: 'origin', x: 0, y: 0 }],
  }
}

/** Plain-English names, shown in the constraint chips and tooltips. */
export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  coincident: 'Joined',
  fix: 'Pinned',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Square',
  equal: 'Same size',
  pointOnLine: 'On the line',
  pointOnCircle: 'On the circle',
  midpoint: 'At the middle',
  tangent: 'Smooth join',
  tangentArcs: 'Smooth join',
  symmetric: 'Mirrored',
  distance: 'Length',
  distanceX: 'Across',
  distanceY: 'Up',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
}
