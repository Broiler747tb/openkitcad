import { THREAD_CHOICES } from '../../../doc/threads'
import type { ThreadFeature } from '../../../doc/types'
import { componentOfBody } from './shared'
import { defineCommand, type LooseCommandValues } from '../types'

const SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto', hint: 'The standard size that fits the face you picked.' },
  ...THREAD_CHOICES.map((choice) => ({ value: choice.value, label: choice.value })),
]

const HANDS = [
  {
    value: 'right',
    label: 'Right Hand',
    hint: 'Tightens clockwise. Nearly every screw is right hand.',
  },
  {
    value: 'left',
    label: 'Left Hand',
    hint: 'Tightens anticlockwise, like a bike pedal on the left.',
  },
] as const

const partLength = (values: LooseCommandValues) => values.full === false

export const threadCommand = defineCommand({
  id: 'thread',
  label: 'Thread',
  hint: 'An ISO metric thread along a round face. On a peg it makes a bolt; in a hole it taps it.',
  icon: '≋',
  inputs: [
    {
      id: 'faces',
      kind: 'selection',
      label: 'Faces',
      hint: 'The side of a peg, or the inside of a hole. The thread starts at the end nearest your click.',
      filter: ['face'],
      min: 1,
      prompt: 'Select round faces',
    },
    { id: 'size', kind: 'choice', label: 'Size', options: SIZE_OPTIONS, default: 'auto' },
    {
      id: 'hand',
      kind: 'choice',
      label: 'Direction',
      options: HANDS,
      default: 'right',
      display: 'buttons',
    },
    {
      id: 'modelled',
      kind: 'toggle',
      label: 'Modelled',
      hint: 'Cut the thread into the part. Turn it off to keep the part plain and only record the size.',
      default: true,
    },
    { id: 'full', kind: 'toggle', label: 'Full Length', default: true },
    {
      id: 'length',
      kind: 'length',
      label: 'Length',
      default: 10,
      min: 0,
      exclusiveMin: true,
      visible: partLength,
    },
    {
      id: 'offset',
      kind: 'length',
      label: 'Offset',
      hint: 'How far from the end the thread starts.',
      default: 0,
      min: 0,
      visible: partLength,
    },
    {
      id: 'clearance',
      kind: 'length',
      label: 'Clearance',
      hint: 'Room added to a tapped hole so a printed bolt turns in it. Bolts are cut to size.',
      default: 0.1,
      min: 0,
      field: 'gap',
    },
  ],
  validate(values) {
    if (!values.faces.some((pick) => pick.face)) {
      return { faces: 'Pick the round side of a peg, or the inside of a hole.' }
    }
    return null
  },
  build(values, context) {
    const picked = values.faces.filter((pick) => pick.face)
    const faces = picked.map((pick) => pick.face!)
    const choice = THREAD_CHOICES.find((entry) => entry.value === values.size)
    const editing = context.editing?.kind === 'thread' ? context.editing : null
    const feature: ThreadFeature = {
      id: editing?.id ?? context.id('thread'),
      kind: 'thread',
      name: editing?.name ?? (choice ? `Thread ${choice.value}` : 'Thread'),
      componentId: componentOfBody(context.doc, faces[0].bodyId, context.componentId),
      faces,
      anchors: picked.map((pick, index) => pick.point ?? editing?.anchors[index] ?? [0, 0, 0]),
      auto: !choice,
      nominal: choice?.nominal ?? 0,
      pitch: choice?.pitch ?? 0,
      modelled: values.modelled,
      lefthand: values.hand === 'left',
      full: values.full,
      length: values.length,
      offset: values.offset,
      clearance: values.clearance,
    }
    return [feature]
  },
})
