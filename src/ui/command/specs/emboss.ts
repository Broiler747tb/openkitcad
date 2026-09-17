import type { EmbossEffect, EmbossFeature } from '../../../doc/types'
import { defineCommand } from '../types'
import { componentOfBody, mergeProfilePicks, profileKeys, profileProblem, sketchOf } from './shared'

export const EMBOSS_EFFECTS = [
  { value: 'emboss', label: 'Emboss', hint: 'Stands up from the face.' },
  { value: 'deboss', label: 'Deboss', hint: 'Sinks into the face.' },
] as const

export const embossCommand = defineCommand({
  id: 'emboss',
  label: 'Emboss',
  hint: 'Raise or sink sketch text and shapes on a flat face or the round side of a cylinder.',
  icon: 'Ⓐ',
  inputs: [
    {
      id: 'profile',
      kind: 'selection',
      label: 'Profile',
      hint: 'Text or closed areas of a sketch. On a round face the sketch has to run along it.',
      filter: ['profile', 'sketch'],
      min: 1,
      prompt: 'Select text or profiles',
      merge: mergeProfilePicks,
    },
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The flat face, or the round side of a cylinder, to put the shape on.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Select a flat or round face',
    },
    {
      id: 'effect',
      kind: 'choice',
      label: 'Effect',
      options: EMBOSS_EFFECTS,
      default: 'emboss',
      display: 'buttons',
    },
    {
      id: 'depth',
      kind: 'length',
      label: 'Depth',
      hint: 'How far the shape stands up, or sinks in.',
      default: 1,
      min: 0,
      exclusiveMin: true,
      field: 'depth',
    },
  ],
  validate(values, context) {
    return (
      profileProblem(context.doc, values.profile) ??
      (values.face[0]?.face ? null : { face: 'Pick the face to put it on.' })
    )
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const face = values.face[0].face!
    const keys = profileKeys(values.profile)
    const feature: EmbossFeature = {
      id: context.editing?.id ?? context.id('emboss'),
      kind: 'emboss',
      name: context.editing?.name ?? 'Emboss',
      componentId: componentOfBody(context.doc, face.bodyId, sketch.componentId),
      sketchId: sketch.id,
      ...(keys ? { profiles: keys } : {}),
      face,
      depth: values.depth,
      effect: values.effect as EmbossEffect,
    }
    return [feature]
  },
})
