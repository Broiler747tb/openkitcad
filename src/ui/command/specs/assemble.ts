import { applyAssemblyResult, solveDocument } from '../../../assembly/fromDocument'
import { motionDofs } from '../../../assembly/motion'
import type { DofName, JointMotion } from '../../../assembly/types'
import {
  findFeature,
  findOccurrence,
  invertRigidMatrix,
  multiplyMatrices,
  parseInstanceId,
  pathKey,
  pathMatrix,
} from '../../../doc/model'
import { occurrencePathOf, useStore } from '../../../doc/store'
import type {
  Feature,
  JointFeature,
  JointSide,
  Matrix4,
  MotionLinkFeature,
  OkcDocument,
  RigidGroupFeature,
} from '../../../doc/types'
import {
  defineCommand,
  type CommandContext,
  type LooseCommandValues,
  type SelectionPick,
} from '../types'

export const MOTION_OPTIONS = [
  { value: 'rigid', label: 'Rigid', hint: 'No motion: the two stay locked together.' },
  { value: 'revolute', label: 'Revolute', hint: 'Turns about one axis, like a hinge.' },
  { value: 'slider', label: 'Slider', hint: 'Slides along one axis, like a drawer.' },
  { value: 'cylindrical', label: 'Cylindrical', hint: 'Turns about and slides along one axis.' },
  { value: 'pinSlot', label: 'Pin-slot', hint: 'Turns about one axis and slides along another.' },
  { value: 'planar', label: 'Planar', hint: 'Slides anywhere on a plane and turns in it.' },
  { value: 'ball', label: 'Ball', hint: 'Turns freely about a point.' },
] as const

export type MotionName = (typeof MOTION_OPTIONS)[number]['value']

export function motionOf(name: string): JointMotion {
  switch (name) {
    case 'revolute':
      return { kind: 'revolute', axis: 'z' }
    case 'slider':
      return { kind: 'slider', axis: 'z' }
    case 'cylindrical':
      return { kind: 'cylindrical', axis: 'z' }
    case 'pinSlot':
      return { kind: 'pinSlot', axis: 'z', slide: 'x' }
    case 'planar':
      return { kind: 'planar', normal: 'z' }
    case 'ball':
      return { kind: 'ball' }
    default:
      return { kind: 'rigid' }
  }
}

export function occurrencePathOfPick(doc: OkcDocument, pick: SelectionPick): string[] | null {
  if (pick.joint) return pick.joint.occurrencePath
  if (pick.kind === 'occurrence') return occurrencePathOf(doc, pick.id, pick.instanceId)
  if (pick.instanceId) return parseInstanceId(pick.instanceId).path
  if (pick.kind === 'body') {
    const instance = useStore
      .getState()
      .instances.find((candidate) => candidate.bodyId === pick.id && !candidate.previewTool)
    return instance ? instance.path : []
  }
  return null
}

export function isFixed(doc: OkcDocument, path: string[]): boolean {
  return !path.length || !!findOccurrence(doc, path[path.length - 1])?.grounded
}

const SNAP_INPUT = {
  kind: 'selection',
  filter: ['jointSnap'],
  min: 1,
  max: 1,
  prompt: 'Select a snap point',
} as const

function solvedPlacement(doc: OkcDocument, features: Feature[]) {
  const joint = features.find((feature): feature is JointFeature => feature.kind === 'joint')
  if (!joint) return
  const one = joint.one.occurrencePath
  const two = joint.two.occurrencePath
  const anchor = isFixed(doc, one) && !isFixed(doc, two) ? one : two
  applyAssemblyResult(doc, solveDocument(doc, { ground: [anchor] }))
}

function sideOf(pick: SelectionPick): JointSide {
  const joint = pick.joint!
  return {
    occurrencePath: joint.occurrencePath,
    snap: { ref: joint.ref, keypoint: joint.keypoint },
    frame: joint.frame,
  }
}

function keptValues(context: CommandContext, motion: JointMotion): number[] {
  const editing = context.editing
  const dofs = motionDofs(motion)
  if (editing?.kind === 'joint' && editing.motion.kind === motion.kind) {
    return dofs.map((_, index) => editing.values[index] ?? 0)
  }
  return dofs.map(() => 0)
}

function keptLimits(context: CommandContext, motion: JointMotion) {
  const editing = context.editing
  return editing?.kind === 'joint' && editing.motion.kind === motion.kind ? editing.limits : []
}

export const jointCommand = defineCommand({
  id: 'joint',
  label: 'Joint',
  hint: 'Moves one component onto a snap point of another and sets how they can still move.',
  icon: '⚭',
  inputs: [
    {
      ...SNAP_INPUT,
      id: 'one',
      label: 'Component 1',
      hint: 'A point on the component that moves.',
    },
    { ...SNAP_INPUT, id: 'two', label: 'Component 2', hint: 'The point it moves to.' },
    {
      id: 'motion',
      kind: 'choice',
      label: 'Motion',
      options: MOTION_OPTIONS,
      default: 'rigid',
    },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Angle',
      hint: 'Turns component 1 about the joint.',
      default: 0,
      field: 'angle',
    },
    {
      id: 'offset',
      kind: 'length',
      label: 'Offset Z',
      hint: 'Lifts component 1 along the joint axis.',
      default: 0,
      field: 'offset',
    },
    { id: 'flip', kind: 'toggle', label: 'Flip', hint: 'Turns component 1 over.' },
  ],
  validate(values, context) {
    const one = values.one[0]?.joint
    const two = values.two[0]?.joint
    if (one && two && pathKey(one.occurrencePath) === pathKey(two.occurrencePath)) {
      return { two: 'Pick a point on a different component.' }
    }
    if (
      one &&
      two &&
      isFixed(context.doc, one.occurrencePath) &&
      isFixed(context.doc, two.occurrencePath)
    ) {
      return 'Neither component can move: both are grounded or part of the top design. Unground one first.'
    }
    return null
  },
  build(values, context) {
    const motion = motionOf(values.motion)
    const feature: JointFeature = {
      id: context.editing?.id ?? context.id('joint'),
      kind: 'joint',
      name: context.editing?.name ?? 'Joint',
      componentId: context.doc.rootComponentId,
      asBuilt: false,
      one: sideOf(values.one[0]),
      two: sideOf(values.two[0]),
      motion,
      flip: values.flip,
      angle: values.angle,
      offset: values.offset,
      values: keptValues(context, motion),
      limits: keptLimits(context, motion),
    }
    return [feature]
  },
  adjust: solvedPlacement,
})

export const asBuiltJointCommand = defineCommand({
  id: 'asBuiltJoint',
  label: 'As-built Joint',
  hint: 'Joins two components where they already sit, without moving either.',
  icon: '⚭',
  inputs: [
    {
      id: 'one',
      kind: 'selection',
      label: 'Component 1',
      filter: ['occurrence', 'body'],
      min: 1,
      max: 1,
      prompt: 'Select a component',
    },
    {
      id: 'two',
      kind: 'selection',
      label: 'Component 2',
      filter: ['occurrence', 'body'],
      min: 1,
      max: 1,
      prompt: 'Select a component',
    },
    { ...SNAP_INPUT, id: 'position', label: 'Position', hint: 'Where the joint sits.' },
    {
      id: 'motion',
      kind: 'choice',
      label: 'Motion',
      options: MOTION_OPTIONS,
      default: 'revolute',
    },
  ],
  validate(values, context) {
    const one = values.one[0] && occurrencePathOfPick(context.doc, values.one[0])
    const two = values.two[0] && occurrencePathOfPick(context.doc, values.two[0])
    if (one && two && pathKey(one) === pathKey(two)) {
      return { two: 'Pick a different component.' }
    }
    return null
  },
  build(values, context) {
    const onePath = occurrencePathOfPick(context.doc, values.one[0]) ?? []
    const twoPath = occurrencePathOfPick(context.doc, values.two[0]) ?? []
    const position = values.position[0].joint!
    const world = multiplyMatrices(
      pathMatrix(context.doc, position.occurrencePath) ?? position.frame,
      position.frame,
    )
    const local = (path: string[]): Matrix4 =>
      multiplyMatrices(invertRigidMatrix(pathMatrix(context.doc, path) ?? world), world)
    const snap = { ref: position.ref, keypoint: position.keypoint }
    const motion = motionOf(values.motion)
    const feature: JointFeature = {
      id: context.editing?.id ?? context.id('joint'),
      kind: 'joint',
      name: context.editing?.name ?? 'As-built Joint',
      componentId: context.doc.rootComponentId,
      asBuilt: true,
      one: { occurrencePath: onePath, snap, frame: local(onePath) },
      two: { occurrencePath: twoPath, snap, frame: local(twoPath) },
      motion,
      flip: false,
      angle: 0,
      offset: 0,
      values: motionDofs(motion).map(() => 0),
      limits: keptLimits(context, motion),
    }
    return [feature]
  },
})

function pathsOf(doc: OkcDocument, picks: readonly SelectionPick[]): string[][] {
  const paths = picks.flatMap((pick) => {
    const path = occurrencePathOfPick(doc, pick)
    return path ? [path] : []
  })
  return [...new Map(paths.map((path) => [pathKey(path), path])).values()]
}

export const rigidGroupCommand = defineCommand({
  id: 'rigidGroup',
  label: 'Rigid Group',
  hint: 'Locks the picked components together so they move as one.',
  icon: '⛓',
  inputs: [
    {
      id: 'members',
      kind: 'selection',
      label: 'Components',
      filter: ['occurrence', 'body'],
      min: 2,
      prompt: 'Select components',
    },
  ],
  validate(values, context) {
    if (!values.members.length) return null
    return pathsOf(context.doc, values.members).length >= 2
      ? null
      : { members: 'Pick at least two different components.' }
  },
  build(values, context) {
    const feature: RigidGroupFeature = {
      id: context.editing?.id ?? context.id('rigidGroup'),
      kind: 'rigidGroup',
      name: context.editing?.name ?? 'Rigid Group',
      componentId: context.doc.rootComponentId,
      members: pathsOf(context.doc, values.members),
    }
    return [feature]
  },
})

export function jointOfPicks(
  doc: OkcDocument,
  picks: readonly SelectionPick[] | undefined,
): JointFeature | null {
  const feature = picks?.[0] ? findFeature(doc, picks[0].id) : undefined
  return feature?.kind === 'joint' ? feature : null
}

function firstDofIsRotation(values: LooseCommandValues, id: string): boolean {
  const joint = jointOfPicks(useStore.getState().doc, values[id] as SelectionPick[])
  return joint ? motionDofs(joint.motion)[0]?.kind === 'rotate' : true
}

export const motionLinkCommand = defineCommand({
  id: 'motionLink',
  label: 'Motion Link',
  hint: 'Ties the motion of one joint to another, like gears or a rack and pinion.',
  icon: '⟲',
  inputs: [
    {
      id: 'a',
      kind: 'selection',
      label: 'Joint 1',
      filter: ['feature'],
      min: 1,
      max: 1,
      prompt: 'Select a joint in the Browser or timeline',
    },
    {
      id: 'aAngle',
      kind: 'angle',
      label: 'Angle 1',
      default: 360,
      visible: (values) => firstDofIsRotation(values, 'a'),
    },
    {
      id: 'aDistance',
      kind: 'length',
      label: 'Distance 1',
      default: 10,
      visible: (values) => !firstDofIsRotation(values, 'a'),
    },
    {
      id: 'b',
      kind: 'selection',
      label: 'Joint 2',
      filter: ['feature'],
      min: 1,
      max: 1,
      prompt: 'Select a joint in the Browser or timeline',
    },
    {
      id: 'bAngle',
      kind: 'angle',
      label: 'Angle 2',
      default: 360,
      visible: (values) => firstDofIsRotation(values, 'b'),
    },
    {
      id: 'bDistance',
      kind: 'length',
      label: 'Distance 2',
      default: 10,
      visible: (values) => !firstDofIsRotation(values, 'b'),
    },
    {
      id: 'reverse',
      kind: 'toggle',
      label: 'Reverse',
      hint: 'Turns the second joint the other way.',
    },
  ],
  validate(values, context) {
    const a = jointOfPicks(context.doc, values.a)
    const b = jointOfPicks(context.doc, values.b)
    if (values.a.length && !a) return { a: 'Pick a joint.' }
    if (values.b.length && !b) return { b: 'Pick a joint.' }
    if (a && !motionDofs(a.motion).length) return { a: 'A rigid joint has no motion to link.' }
    if (b && !motionDofs(b.motion).length) return { b: 'A rigid joint has no motion to link.' }
    if (a && b && a.id === b.id) return { b: 'Pick a different joint.' }
    return null
  },
  build(values, context) {
    const a = jointOfPicks(context.doc, values.a)!
    const b = jointOfPicks(context.doc, values.b)!
    const aRotation = motionDofs(a.motion)[0]?.kind === 'rotate'
    const bRotation = motionDofs(b.motion)[0]?.kind === 'rotate'
    const aAmount = aRotation ? values.aAngle : values.aDistance
    const bAmount = bRotation ? values.bAngle : values.bDistance
    const feature: MotionLinkFeature = {
      id: context.editing?.id ?? context.id('motionLink'),
      kind: 'motionLink',
      name: context.editing?.name ?? 'Motion Link',
      componentId: context.doc.rootComponentId,
      a: { jointId: a.id, dof: 0 },
      b: { jointId: b.id, dof: 0 },
      ratio: ((values.reverse ? -1 : 1) * bAmount) / (aAmount || 1),
      offset: 0,
    }
    return [feature]
  },
})

export const DOF_LABEL: Record<DofName, string> = {
  rotation: 'Rotation',
  slide: 'Slide',
  primarySlide: 'Primary Slide',
  secondarySlide: 'Secondary Slide',
  pitch: 'Pitch',
  yaw: 'Yaw',
  roll: 'Roll',
}

function hasDof(values: LooseCommandValues, name: DofName): boolean {
  const joint = jointOfPicks(useStore.getState().doc, values.joint as SelectionPick[])
  return !!joint && motionDofs(joint.motion).some((dof) => dof.name === name)
}

const DRIVE_ANGLE = (id: DofName) =>
  ({
    id,
    kind: 'angle',
    label: DOF_LABEL[id],
    default: 0,
    visible: (values: LooseCommandValues) => hasDof(values, id),
  }) as const

const DRIVE_LENGTH = (id: DofName) =>
  ({
    id,
    kind: 'length',
    label: DOF_LABEL[id],
    default: 0,
    visible: (values: LooseCommandValues) => hasDof(values, id),
  }) as const

export function driveTargets(joint: JointFeature, values: LooseCommandValues) {
  return motionDofs(joint.motion).map((dof, index) => {
    const value = values[dof.name]
    return {
      jointId: joint.id,
      dof: index,
      value: typeof value === 'number' ? value : (joint.values[index] ?? 0),
    }
  })
}

export const driveJointsCommand = defineCommand({
  id: 'driveJoints',
  label: 'Drive Joints',
  hint: 'Moves a joint to an exact position, carrying everything tied to it.',
  icon: '⟳',
  inputs: [
    {
      id: 'joint',
      kind: 'selection',
      label: 'Joint',
      filter: ['feature'],
      min: 1,
      max: 1,
      prompt: 'Select a joint in the Browser or timeline',
      fills: (pick) => {
        const joint = jointOfPicks(useStore.getState().doc, [pick])
        if (!joint) return {}
        return Object.fromEntries(
          motionDofs(joint.motion).map((dof, index) => [dof.name, joint.values[index] ?? 0]),
        )
      },
    },
    DRIVE_ANGLE('rotation'),
    DRIVE_LENGTH('slide'),
    DRIVE_LENGTH('primarySlide'),
    DRIVE_LENGTH('secondarySlide'),
    DRIVE_ANGLE('pitch'),
    DRIVE_ANGLE('yaw'),
    DRIVE_ANGLE('roll'),
  ],
  validate(values, context) {
    if (!values.joint.length) return null
    const joint = jointOfPicks(context.doc, values.joint)
    if (!joint) return { joint: 'Pick a joint.' }
    if (!motionDofs(joint.motion).length) return { joint: 'A rigid joint has no motion to drive.' }
    if (joint.locked) return { joint: 'This joint is locked. Unlock it to drive it.' }
    return null
  },
  build() {
    return []
  },
  adjust(doc, _features, _context, values) {
    const joint = jointOfPicks(doc, values.joint)
    if (!joint) return
    const result = solveDocument(doc, { drive: driveTargets(joint, values) })
    if (result.conflictingJoints.includes(joint.id)) throw new Error(BLOCKED)
    applyAssemblyResult(doc, result)
  },
})

const BLOCKED = 'The other joints and links do not allow that position.'

export function updateJoint(
  jointId: string,
  patch: Partial<Pick<JointFeature, 'locked' | 'limits' | 'name'>>,
  drive?: number[],
): string | null {
  const store = useStore.getState()
  const trial = structuredClone(store.doc)
  const joint = findFeature(trial, jointId)
  if (joint?.kind !== 'joint') return 'Pick a joint.'
  Object.assign(joint, patch)
  const result = solveDocument(trial, {
    drive: drive?.map((value, dof) => ({ jointId, dof, value })),
  })
  if (result.conflictingJoints.includes(jointId)) return BLOCKED
  const locked = result.issues.find((issue) => issue.id === jointId && drive)
  if (locked) return locked.message
  store.commit((doc) => {
    const target = findFeature(doc, jointId)
    if (target?.kind === 'joint') Object.assign(target, patch)
    applyAssemblyResult(doc, result)
  })
  return null
}

export function driveJoint(jointId: string, values: number[]): string | null {
  return updateJoint(jointId, {}, values)
}

export function setGrounded(occurrenceId: string, grounded: boolean) {
  const store = useStore.getState()
  const occurrence = findOccurrence(store.doc, occurrenceId)
  if (!occurrence || occurrence.grounded === grounded) return
  store.updateOccurrence(occurrenceId, { grounded })
}
