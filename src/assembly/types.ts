import type { Vec3 } from '../core/math'
import type { Matrix4 } from '../doc/types'

export type OccurrencePath = string[]

export type JointAxis = 'x' | 'y' | 'z'

export type SnapReference = unknown

export interface JointOrigin {
  id: string
  name: string
  occurrencePath: OccurrencePath
  frame: Matrix4
  snap: SnapReference
}

export type JointAnchor =
  | { kind: 'geometry'; occurrencePath: OccurrencePath; frame: Matrix4; snap: SnapReference }
  | { kind: 'origin'; originId: string }

export type JointMotion =
  | { kind: 'rigid' }
  | { kind: 'revolute'; axis: JointAxis }
  | { kind: 'slider'; axis: JointAxis }
  | { kind: 'cylindrical'; axis: JointAxis }
  | { kind: 'pinSlot'; axis: JointAxis; slide: JointAxis }
  | { kind: 'planar'; normal: JointAxis }
  | { kind: 'ball' }

export type JointMotionKind = JointMotion['kind']

export type DofName =
  'rotation' | 'slide' | 'primarySlide' | 'secondarySlide' | 'pitch' | 'yaw' | 'roll'

export type DofKind = 'rotate' | 'slide'

export interface DofSpec {
  name: DofName
  kind: DofKind
  axis: JointAxis
}

export interface DofLimits {
  min?: number
  max?: number
  rest?: number
}

export interface Joint {
  id: string
  name: string
  one: JointAnchor
  two: JointAnchor
  motion: JointMotion
  flip: boolean
  angle: number
  offset: number
  values: number[]
  limits: DofLimits[]
  locked?: boolean
  suppressed?: boolean
}

export interface AsBuiltJoint {
  id: string
  name: string
  one: OccurrencePath
  two: OccurrencePath
  frame: Matrix4
  twoFrame: Matrix4
  snap: SnapReference
  motion: JointMotion
  values: number[]
  limits: DofLimits[]
  locked?: boolean
  suppressed?: boolean
}

export interface RigidGroup {
  id: string
  name: string
  members: OccurrencePath[]
  suppressed?: boolean
}

export interface DofReference {
  jointId: string
  dof: number
}

export interface MotionLink {
  id: string
  name: string
  a: DofReference
  b: DofReference
  ratio: number
  offset: number
  suppressed?: boolean
}

export interface ContactSet {
  id: string
  name: string
  members: OccurrencePath[]
  enabled: boolean
}

export interface AssemblyData {
  origins: JointOrigin[]
  joints: Joint[]
  asBuiltJoints: AsBuiltJoint[]
  rigidGroups: RigidGroup[]
  motionLinks: MotionLink[]
  contactSets: ContactSet[]
}

export function emptyAssemblyData(): AssemblyData {
  return {
    origins: [],
    joints: [],
    asBuiltJoints: [],
    rigidGroups: [],
    motionLinks: [],
    contactSets: [],
  }
}

export interface AssemblyOccurrence {
  path: OccurrencePath
  transform: Matrix4
  grounded: boolean
}

export interface AssemblySolveInput extends Partial<AssemblyData> {
  occurrences: AssemblyOccurrence[]
}

export interface JointDrive {
  jointId: string
  dof?: number
  value: number
}

export type AssemblyDrag =
  | { kind: 'pose'; path: OccurrencePath; target: Matrix4 }
  | { kind: 'point'; path: OccurrencePath; point: Vec3; target: Vec3 }

export interface AssemblySolveOptions {
  drive?: JointDrive[]
  drag?: AssemblyDrag
  applyRest?: boolean
  maxIterations?: number
}

export interface OccurrenceFreedom {
  dof: number
  rotations: number
  translations: number
}

export type ConflictSource = 'joint' | 'asBuiltJoint' | 'rigidGroup' | 'motionLink'

export interface JointConflict {
  source: ConflictSource
  id: string
  jointIds: string[]
  rigidGroupIds: string[]
  translationError: number
  angleError: number
}

export interface AssemblyIssue {
  id: string
  message: string
}

export interface AssemblySolveResult {
  transforms: Record<string, Matrix4>
  moved: string[]
  jointValues: Record<string, number[]>
  freedom: Record<string, OccurrenceFreedom>
  mechanismDof: number
  conflicts: JointConflict[]
  conflictingJoints: string[]
  converged: boolean
  iterations: number
  issues: AssemblyIssue[]
}

export interface MeasuredJoint {
  values: number[]
  translationError: number
  angleError: number
}

export interface AsBuiltJointSpec {
  id: string
  name: string
  one: OccurrencePath
  two: OccurrencePath
  motion: JointMotion
  worldFrame: Matrix4
  snap?: SnapReference
  limits?: DofLimits[]
}
