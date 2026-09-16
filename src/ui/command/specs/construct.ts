import { v3 } from '../../../core/math'
import { findBody } from '../../../doc/model'
import { offsetFrame } from '../../../doc/planes'
import type { ConstructionPlaneFeature, PlaneRef } from '../../../doc/types'
import { defineCommand, type CommandContext, type SelectionPick } from '../types'
import { pickedFrame, planeOf } from './shared'

const PLANE_PICK = {
  kind: 'selection',
  filter: ['face', 'plane'],
  min: 1,
  max: 1,
} as const

function planeComponent(context: CommandContext, refs: readonly PlaneRef[]): string {
  if (context.editing) return context.editing.componentId
  for (const ref of refs) {
    if (ref.kind === 'face') {
      const owner = findBody(context.doc, ref.face.bodyId)?.component.id
      if (owner) return owner
    }
  }
  return context.componentId
}

function planeFeature(
  context: CommandContext,
  fields: Pick<
    ConstructionPlaneFeature,
    'method' | 'base' | 'second' | 'distance' | 'axis' | 'angle'
  >,
  name: string,
): ConstructionPlaneFeature {
  const editing = context.editing?.kind === 'constructionPlane' ? context.editing : null
  return {
    id: editing?.id ?? context.id('plane'),
    kind: 'constructionPlane',
    name: editing?.name ?? name,
    componentId: planeComponent(
      context,
      fields.second ? [fields.base, fields.second] : [fields.base],
    ),
    visible: editing?.visible ?? true,
    ...fields,
  }
}

function samePlane(a: readonly SelectionPick[], b: readonly SelectionPick[]): boolean {
  return !!a[0] && !!b[0] && a[0].id === b[0].id
}

export const offsetPlaneCommand = defineCommand({
  id: 'offsetPlane',
  label: 'Offset Plane',
  hint: 'A plane parallel to a face or another plane, a set distance away.',
  icon: '▭',
  inputs: [
    {
      ...PLANE_PICK,
      id: 'plane',
      label: 'Plane',
      prompt: 'Select a plane or a flat face',
    },
    { id: 'distance', kind: 'length', label: 'Distance', default: 10 },
  ],
  build(values, context) {
    return [
      planeFeature(
        context,
        {
          method: 'offset',
          base: planeOf(values.plane),
          distance: values.distance,
          axis: 'x',
          angle: 0,
        },
        'Offset Plane',
      ),
    ]
  },
  handles(values, context) {
    const pick = values.plane[0]
    const picked = pickedFrame(values.plane, context.editingFeatureId)
    if (!picked || !pick) return []
    const editing = context.editing?.kind === 'constructionPlane' ? context.editing : null
    const frame =
      pick.face && !pick.point && editing ? offsetFrame(picked, -editing.distance) : picked
    const point = pick.point ?? frame.origin
    return [
      {
        kind: 'arrow',
        input: 'distance',
        componentId: context.componentId,
        anchor: { point, direction: v3.norm(frame.normal) },
      },
    ]
  },
})

export const planeAtAngleCommand = defineCommand({
  id: 'planeAtAngle',
  label: 'Plane at Angle',
  hint: 'A plane turned about one of the origin axes.',
  icon: '⟋',
  inputs: [
    {
      id: 'axis',
      kind: 'choice',
      label: 'Axis',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
      ],
      default: 'x',
      display: 'buttons',
    },
    { id: 'angle', kind: 'angle', label: 'Angle', default: 45, min: -180, max: 180 },
  ],
  build(values, context) {
    return [
      planeFeature(
        context,
        {
          method: 'angle',
          base: { kind: 'named', name: values.axis === 'z' ? 'XZ' : 'XY', offset: 0 },
          distance: 0,
          axis: values.axis,
          angle: values.angle,
        },
        'Plane at Angle',
      ),
    ]
  },
})

export const midplaneCommand = defineCommand({
  id: 'midplane',
  label: 'Midplane',
  hint: 'A plane halfway between two faces or planes.',
  icon: '⫿',
  inputs: [
    { ...PLANE_PICK, id: 'first', label: 'First Plane', prompt: 'Select a plane or a flat face' },
    {
      ...PLANE_PICK,
      id: 'second',
      label: 'Second Plane',
      prompt: 'Select another plane or flat face',
    },
  ],
  validate(values) {
    return samePlane(values.first, values.second) ? { second: 'Pick a different plane.' } : null
  },
  build(values, context) {
    return [
      planeFeature(
        context,
        {
          method: 'midplane',
          base: planeOf(values.first),
          second: planeOf(values.second),
          distance: 0,
          axis: 'x',
          angle: 0,
        },
        'Midplane',
      ),
    ]
  },
})
