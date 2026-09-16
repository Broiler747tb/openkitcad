import { frameToWorld, v3 } from '../../../core/math'
import type { ExtrudeFeature, RevolveFeature } from '../../../doc/types'
import { defineCommand, type LooseCommandValues } from '../types'
import {
  mergeProfilePicks,
  OPERATIONS,
  operationProblem,
  profileCentre,
  profileKeys,
  profileProblem,
  resultOf,
  sketchFrame,
  sketchOf,
} from './shared'

export const OPERATION_INPUTS = [
  {
    id: 'operation',
    kind: 'choice',
    label: 'Operation',
    options: OPERATIONS,
    default: 'newBody',
  },
  {
    id: 'bodies',
    kind: 'selection',
    label: 'Objects',
    hint: 'The bodies this joins to, cuts or intersects.',
    filter: ['body'],
    min: 1,
    prompt: 'Select bodies',
    visible: (values: LooseCommandValues) => values.operation !== 'newBody',
  },
] as const

const PROFILE_INPUT = {
  id: 'profile',
  kind: 'selection',
  label: 'Profile',
  hint: 'Click the closed areas of a sketch to use. Picking a sketch in the Browser takes all of them.',
  filter: ['profile', 'sketch'],
  min: 1,
  prompt: 'Select profiles',
  merge: mergeProfilePicks,
} as const

export const extrudeCommand = defineCommand({
  id: 'extrude',
  label: 'Extrude',
  hint: 'Give a closed sketch depth, to make a solid or cut one.',
  icon: '⇧',
  inputs: [
    PROFILE_INPUT,
    {
      id: 'direction',
      kind: 'choice',
      label: 'Direction',
      options: [
        { value: 'one', label: 'One Side', hint: 'Grows away from the sketch plane.' },
        { value: 'symmetric', label: 'Symmetric', hint: 'Grows the same distance both ways.' },
      ],
      default: 'one',
    },
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance',
      hint: 'How far the profile is pushed.',
      default: 10,
      min: 0,
      exclusiveMin: true,
      field: 'distance',
    },
    {
      id: 'flip',
      kind: 'toggle',
      label: 'Flip',
      hint: 'Extrude to the other side of the sketch plane.',
      visible: (values) => values.direction !== 'symmetric',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    return profileProblem(context.doc, values.profile) ?? operationProblem(values)
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const feature: ExtrudeFeature = {
      id: context.editing?.id ?? context.id('extrude'),
      kind: 'extrude',
      name: context.editing?.name ?? 'Extrude',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(profileKeys(values.profile) ? { profiles: profileKeys(values.profile) } : {}),
      distance: values.distance,
      symmetric: values.direction === 'symmetric',
      reverse: values.direction !== 'symmetric' && values.flip,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const sketch = sketchOf(context.doc, values.profile)
    const frame = sketch && sketchFrame(sketch)
    if (!sketch || !frame) return []
    const symmetric = values.direction === 'symmetric'
    const direction = !symmetric && values.flip ? v3.scale(frame.normal, -1) : frame.normal
    return [
      {
        kind: 'arrow',
        input: 'distance',
        componentId: sketch.componentId,
        anchor: {
          point: frameToWorld(frame, profileCentre(sketch, profileKeys(values.profile))),
          direction,
        },
        scale: symmetric ? 0.5 : 1,
      },
    ]
  },
})

export const revolveCommand = defineCommand({
  id: 'revolve',
  label: 'Revolve',
  hint: 'Spin a closed sketch around one of its axes.',
  icon: '⟳',
  inputs: [
    PROFILE_INPUT,
    {
      id: 'axis',
      kind: 'choice',
      label: 'Axis',
      options: [
        { value: 'x', label: 'Sketch X Axis', hint: 'The horizontal axis through the origin.' },
        { value: 'y', label: 'Sketch Y Axis', hint: 'The vertical axis through the origin.' },
      ],
      default: 'x',
    },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Angle',
      hint: 'How far round it goes. 360 makes a full turn.',
      default: 360,
      min: 0,
      max: 360,
      exclusiveMin: true,
      field: 'angle',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    return profileProblem(context.doc, values.profile) ?? operationProblem(values)
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const feature: RevolveFeature = {
      id: context.editing?.id ?? context.id('revolve'),
      kind: 'revolve',
      name: context.editing?.name ?? 'Revolve',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(profileKeys(values.profile) ? { profiles: profileKeys(values.profile) } : {}),
      angle: values.angle,
      axis: values.axis,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const sketch = sketchOf(context.doc, values.profile)
    const frame = sketch && sketchFrame(sketch)
    if (!sketch || !frame) return []
    const [u, v] = profileCentre(sketch, profileKeys(values.profile))
    const alongX = values.axis === 'x'
    const offset = alongX ? v : u
    const radial = alongX ? frame.yDir : frame.xDir
    return [
      {
        kind: 'arc',
        input: 'angle',
        componentId: sketch.componentId,
        centre: frameToWorld(frame, alongX ? [u, 0] : [0, v]),
        axis: alongX ? frame.xDir : frame.yDir,
        start: v3.scale(radial, offset < 0 ? -1 : 1),
        radius: Math.abs(offset) || 10,
      },
    ]
  },
})
