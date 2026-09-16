import { frameToWorld, v3, type Frame } from '../../../core/math'
import type { BoxFeature, CylinderFeature, SphereFeature } from '../../../doc/types'
import { defineCommand } from '../types'
import { OPERATION_INPUTS } from './sketchBased'
import { operationProblem, pickedFrame, placementComponent, planeOf, resultOf } from './shared'

const PLANE_INPUT = {
  id: 'plane',
  kind: 'selection',
  label: 'Plane',
  hint: 'A flat face or an origin plane to build on. Leave it empty to use the XY plane.',
  filter: ['face', 'plane'],
  min: 0,
  max: 1,
  prompt: 'XY plane',
} as const

function onPlane(frame: Frame, u: number, v: number, up = 0) {
  return v3.add(frameToWorld(frame, [u, v]), v3.scale(frame.normal, up))
}

const nonZero = (value: number, input: string) =>
  value === 0 ? { [input]: 'This cannot be zero.' } : null

export const boxCommand = defineCommand({
  id: 'box',
  label: 'Box',
  hint: 'A rectangular block, placed by its corner on a plane or a flat face.',
  icon: '▣',
  inputs: [
    PLANE_INPUT,
    { id: 'x', kind: 'length', label: 'Corner X', default: 0 },
    { id: 'y', kind: 'length', label: 'Corner Y', default: 0 },
    {
      id: 'length',
      kind: 'length',
      label: 'Length',
      default: 20,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'width',
      kind: 'length',
      label: 'Width',
      default: 20,
      min: 0,
      exclusiveMin: true,
      field: 'depth',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Height',
      hint: 'Negative builds down into the plane.',
      default: 10,
      field: 'height',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    return nonZero(values.height, 'height') ?? operationProblem(values)
  },
  build(values, context) {
    const feature: BoxFeature = {
      id: context.editing?.id ?? context.id('box'),
      kind: 'box',
      name: context.editing?.name ?? 'Box',
      componentId: placementComponent(context, values.plane),
      plane: planeOf(values.plane),
      origin: [values.x, values.y],
      width: values.length,
      depth: values.width,
      height: values.height,
      result: resultOf(values.operation, values.bodies, context),
    }
    if (context.editing?.kind === 'box' && context.editing.cornerRadius) {
      feature.cornerRadius = context.editing.cornerRadius
    }
    return [feature]
  },
  handles(values, context) {
    const frame = pickedFrame(values.plane, context.editing?.id)
    if (!frame) return []
    const componentId = placementComponent(context, values.plane)
    const { x, y, length, width, height } = values
    return [
      {
        kind: 'arrow',
        input: 'height',
        componentId,
        anchor: { point: onPlane(frame, x + length / 2, y + width / 2), direction: frame.normal },
      },
      {
        kind: 'arrow',
        input: 'length',
        componentId,
        anchor: { point: onPlane(frame, x, y + width / 2, height / 2), direction: frame.xDir },
      },
      {
        kind: 'arrow',
        input: 'width',
        componentId,
        anchor: { point: onPlane(frame, x + length / 2, y, height / 2), direction: frame.yDir },
      },
    ]
  },
})

export const cylinderCommand = defineCommand({
  id: 'cylinder',
  label: 'Cylinder',
  hint: 'A round post, placed by its centre on a plane or a flat face.',
  icon: '⌭',
  inputs: [
    PLANE_INPUT,
    { id: 'x', kind: 'length', label: 'Centre X', default: 0 },
    { id: 'y', kind: 'length', label: 'Centre Y', default: 0 },
    { id: 'diameter', kind: 'length', label: 'Diameter', default: 20, min: 0, exclusiveMin: true },
    {
      id: 'height',
      kind: 'length',
      label: 'Height',
      hint: 'Negative builds down into the plane.',
      default: 10,
      field: 'height',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    return nonZero(values.height, 'height') ?? operationProblem(values)
  },
  build(values, context) {
    const feature: CylinderFeature = {
      id: context.editing?.id ?? context.id('cylinder'),
      kind: 'cylinder',
      name: context.editing?.name ?? 'Cylinder',
      componentId: placementComponent(context, values.plane),
      plane: planeOf(values.plane),
      centre: [values.x, values.y],
      radius: values.diameter / 2,
      height: values.height,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const frame = pickedFrame(values.plane, context.editing?.id)
    if (!frame) return []
    const componentId = placementComponent(context, values.plane)
    return [
      {
        kind: 'arrow',
        input: 'height',
        componentId,
        anchor: { point: onPlane(frame, values.x, values.y), direction: frame.normal },
      },
      {
        kind: 'arrow',
        input: 'diameter',
        componentId,
        anchor: {
          point: onPlane(frame, values.x, values.y, values.height / 2),
          direction: frame.xDir,
        },
        scale: 0.5,
      },
    ]
  },
})

export const sphereCommand = defineCommand({
  id: 'sphere',
  label: 'Sphere',
  hint: 'A ball, placed by its centre on a plane or a flat face.',
  icon: '◯',
  inputs: [
    PLANE_INPUT,
    { id: 'x', kind: 'length', label: 'Centre X', default: 0 },
    { id: 'y', kind: 'length', label: 'Centre Y', default: 0 },
    { id: 'diameter', kind: 'length', label: 'Diameter', default: 20, min: 0, exclusiveMin: true },
    {
      id: 'half',
      kind: 'toggle',
      label: 'Hemisphere',
      hint: 'Keep only the half above the plane.',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    return operationProblem(values)
  },
  build(values, context) {
    const feature: SphereFeature = {
      id: context.editing?.id ?? context.id('sphere'),
      kind: 'sphere',
      name: context.editing?.name ?? 'Sphere',
      componentId: placementComponent(context, values.plane),
      plane: planeOf(values.plane),
      centre: [values.x, values.y],
      radius: values.diameter / 2,
      half: values.half,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const frame = pickedFrame(values.plane, context.editing?.id)
    if (!frame) return []
    return [
      {
        kind: 'arrow',
        input: 'diameter',
        componentId: placementComponent(context, values.plane),
        anchor: { point: onPlane(frame, values.x, values.y), direction: frame.normal },
        scale: 0.5,
      },
    ]
  },
})
