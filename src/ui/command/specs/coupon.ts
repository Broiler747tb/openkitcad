import type { FitCouponFeature } from '../../../doc/types'
import { defineCommand } from '../types'
import { placementComponent, planeOf } from './shared'

const PLANE = {
  id: 'plane',
  kind: 'selection',
  label: 'Plane',
  hint: 'A flat face or an origin plane to lay the cards on. Leave it empty to use the XY plane.',
  filter: ['face', 'plane'],
  min: 0,
  max: 1,
  prompt: 'XY plane',
} as const

export const fitCouponCommand = defineCommand({
  id: 'fitCoupon',
  label: 'Fit Test Coupon',
  hint: 'Two small cards to print: a row of pins and a row of holes, each rung a step looser, numbered in hundredths of a millimetre.',
  icon: '⌗',
  inputs: [
    PLANE,
    {
      id: 'diameter',
      kind: 'length',
      label: 'Pin Size',
      hint: 'The nominal pin diameter. Every pin is this size; the holes grow by the gap.',
      default: 5,
      min: 0,
      exclusiveMin: true,
      field: 'diameter',
    },
    {
      id: 'start',
      kind: 'length',
      label: 'First Gap',
      hint: 'The gap per side on the first rung.',
      default: 0.1,
      min: 0,
      field: 'gap',
    },
    {
      id: 'step',
      kind: 'length',
      label: 'Step',
      hint: 'How much looser each rung gets.',
      default: 0.05,
      min: 0,
      exclusiveMin: true,
    },
    { id: 'count', kind: 'integer', label: 'Rungs', default: 7, min: 2, max: 12 },
    {
      id: 'thickness',
      kind: 'length',
      label: 'Card Thickness',
      default: 3,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Pin Height',
      default: 6,
      min: 0,
      exclusiveMin: true,
      field: 'height',
    },
  ],
  validate(values) {
    const last = values.start + (values.count - 1) * values.step
    if (last >= values.diameter / 2) {
      return { step: 'The last rung is looser than the pin is wide. Use a smaller step.' }
    }
    return null
  },
  build(values, context) {
    const feature: FitCouponFeature = {
      id: context.editing?.id ?? context.id('fitCoupon'),
      kind: 'fitCoupon',
      name: context.editing?.name ?? 'Fit Test Coupon',
      componentId: placementComponent(context, values.plane),
      plane: planeOf(values.plane),
      origin: [0, 0],
      diameter: values.diameter,
      start: values.start,
      step: values.step,
      count: values.count,
      thickness: values.thickness,
      height: values.height,
      pinBodyId: context.id('pins'),
      holeBodyId: context.id('holes'),
    }
    return [feature]
  },
})
