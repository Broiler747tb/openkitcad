import { CABLE_ENTRIES, GLANDS, glandFor, TIES, type CableEntryKind } from '../../../doc/cables'
import type { CableEntryFeature } from '../../../doc/types'
import type { ThreadSize } from '../../../fasteners'
import { pointOnFace } from './placed'
import { componentOfBody } from './shared'
import { defineCommand, type LooseCommandValues } from '../types'

const SCREWS = [
  { value: 'M2.5', label: 'M2.5' },
  { value: 'M3', label: 'M3' },
  { value: 'M4', label: 'M4' },
] as const

const isHole = (values: LooseCommandValues) =>
  values.entry === 'grommet' || values.entry === 'gland'

export const cableEntryCommand = defineCommand({
  id: 'cableEntry',
  label: 'Cable Entry',
  hint: 'A way for a cable to leave the box: a rounded hole, a gland, a zip-tie anchor or a screwed clamp.',
  icon: '⌁',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The wall the cable passes through, or sits against. Click where it should go.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Click the wall for the cable',
      fills: pointOnFace,
    },
    {
      id: 'entry',
      kind: 'choice',
      label: 'Kind',
      options: CABLE_ENTRIES.map((entry) => ({
        value: entry.value,
        label: entry.label,
        hint: entry.hint,
      })),
      default: 'grommet',
    },
    { id: 'x', kind: 'length', label: 'Position X', hint: 'Along the face.', default: 0 },
    { id: 'y', kind: 'length', label: 'Position Y', hint: 'Across the face.', default: 0 },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Direction',
      hint: 'Which way the cable runs across the face.',
      default: 0,
      visible: (values) => !isHole(values),
    },
    {
      id: 'cable',
      kind: 'length',
      label: 'Cable Size',
      hint: 'The diameter of the cable or its sleeve.',
      default: 6,
      min: 0,
      exclusiveMin: true,
      field: 'diameter',
    },
    {
      id: 'gland',
      kind: 'choice',
      label: 'Gland',
      options: GLANDS.map((gland) => ({
        value: gland.id,
        label: gland.label,
        hint: `Takes ${gland.cable[0]} to ${gland.cable[1]} mm cable, ${gland.hole} mm hole, ${gland.nut} mm nut.`,
      })),
      default: 'PG9',
      visible: (values) => values.entry === 'gland',
    },
    {
      id: 'nutRoom',
      kind: 'toggle',
      label: 'Room for the Nut',
      hint: 'Clears the space the lock nut needs on the inside.',
      default: true,
      visible: (values) => values.entry === 'gland',
    },
    {
      id: 'clearance',
      kind: 'length',
      label: 'Clearance',
      hint: 'Extra room around the cable or the thread.',
      default: 0.5,
      min: 0,
      field: 'gap',
      visible: isHole,
    },
    {
      id: 'tie',
      kind: 'choice',
      label: 'Zip Tie',
      options: TIES.map((tie) => ({ value: tie.id, label: tie.label })),
      default: 'large',
      display: 'buttons',
      visible: (values) => values.entry === 'tie',
    },
    {
      id: 'screw',
      kind: 'choice',
      label: 'Screws',
      options: SCREWS,
      default: 'M3',
      display: 'buttons',
      visible: (values) => values.entry === 'clamp',
    },
  ],
  validate(values) {
    if (values.entry !== 'gland') return null
    const gland = GLANDS.find((candidate) => candidate.id === values.gland)
    if (!gland) return { gland: 'Pick a gland.' }
    if (values.cable < gland.cable[0] || values.cable > gland.cable[1]) {
      const better = glandFor(values.cable)
      return {
        gland: `${gland.label} grips ${gland.cable[0]} to ${gland.cable[1]} mm cable.${
          better ? ` A ${better.label} takes ${values.cable} mm.` : ''
        }`,
      }
    }
    return null
  },
  build(values, context) {
    const face = values.face[0].face!
    const feature: CableEntryFeature = {
      id: context.editing?.id ?? context.id('cableEntry'),
      kind: 'cableEntry',
      name: context.editing?.name ?? 'Cable Entry',
      componentId: componentOfBody(context.doc, face.bodyId, context.componentId),
      entry: values.entry as CableEntryKind,
      bodyId: face.bodyId,
      plane: { kind: 'face', face, offset: 0 },
      position: [values.x, values.y],
      angle: values.angle,
      cable: values.cable,
      clearance: values.clearance,
      gland: values.gland,
      tie: values.tie,
      screw: values.screw as ThreadSize,
      nutRoom: values.nutRoom,
      ...(values.entry === 'clamp' ? { barBodyId: context.id('bar') } : {}),
    }
    return [feature]
  },
})
