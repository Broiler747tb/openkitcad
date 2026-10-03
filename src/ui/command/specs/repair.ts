import { defineCommand } from '../types'
import { planeOf } from './shared'

export const repairSketchPlaneCommand = defineCommand({
  id: 'repairSketchPlane',
  label: 'Repair sketch plane',
  hint: 'Choose a replacement plane or flat face. Sketch geometry and dependent steps are kept.',
  inputs: [
    {
      id: 'plane',
      kind: 'selection',
      label: 'Plane',
      filter: ['face', 'plane'],
      min: 1,
      max: 1,
      prompt: 'Select a plane or a flat face',
    },
    { id: 'offset', kind: 'length', label: 'Offset', default: 0 },
  ],
  build(values, context) {
    if (context.editing?.kind !== 'sketch') throw new Error('Select a sketch to repair.')
    return [{ ...context.editing, plane: { ...planeOf(values.plane), offset: values.offset } }]
  },
})
