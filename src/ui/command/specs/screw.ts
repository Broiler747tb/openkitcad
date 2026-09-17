import { findBody } from '../../../doc/model'
import { FIT_CLASSES, isFitClass, linkFitClass } from '../../../doc/fits'
import type { FitClass, ScrewLidFeature, ThreadProfile } from '../../../doc/types'
import { classGap } from './fit'
import { componentOfBody } from './shared'
import { defineCommand } from '../types'

export const THREAD_PROFILES = [
  { value: 'trapezoid', label: 'Flat Top', hint: 'A blunt thread that prints strong.' },
  { value: 'triangle', label: 'Vee', hint: 'A pointed thread, like a bolt.' },
] as const

const FIT_OPTIONS = [
  ...FIT_CLASSES.map((entry) => ({ value: entry.value, label: entry.label, hint: entry.hint })),
  { value: 'custom', label: 'Custom', hint: 'Type the gap yourself.' },
]

export const screwLidCommand = defineCommand({
  id: 'screwLid',
  label: 'Screw Lid',
  hint: 'Cuts a thread on a round opening and makes the cap that screws onto it.',
  icon: '⊚',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Round Face',
      hint: 'The round side of the opening. Click it near the end the cap goes on.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Select a round face',
    },
    {
      id: 'pitch',
      kind: 'length',
      label: 'Pitch',
      hint: 'How far the thread climbs in one turn. Two to three times the printed layer is usual.',
      default: 3,
      min: 0,
      exclusiveMin: true,
      field: 'pitch',
    },
    { id: 'turns', kind: 'integer', label: 'Turns', default: 3, min: 1, max: 30 },
    {
      id: 'profile',
      kind: 'choice',
      label: 'Thread Shape',
      options: THREAD_PROFILES,
      default: 'trapezoid',
      display: 'buttons',
    },
    {
      id: 'fit',
      kind: 'choice',
      label: 'Fit',
      options: FIT_OPTIONS,
      default: 'sliding',
      display: 'buttons',
    },
    {
      id: 'gap',
      kind: 'length',
      label: 'Gap',
      hint: 'Room between the two threads. Threads need more of it than a plain hole.',
      default: 0.3,
      min: 0,
      field: 'gap',
    },
    {
      id: 'wall',
      kind: 'length',
      label: 'Cap Wall',
      hint: 'How thick the side of the cap is around the thread.',
      default: 2,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    {
      id: 'top',
      kind: 'length',
      label: 'Cap Top',
      hint: 'How thick the flat top of the cap is.',
      default: 3,
      min: 0,
      exclusiveMin: true,
    },
    {
      id: 'grip',
      kind: 'toggle',
      label: 'Ribbed Grip',
      hint: 'Ribs round the edge of the cap, so fingers can turn it.',
      default: true,
    },
    {
      id: 'flipEnd',
      kind: 'toggle',
      label: 'Other End',
      hint: 'Thread the far end of the face instead of the one you picked.',
    },
  ],
  validate(values) {
    if (!values.face[0]?.face) return { face: 'Pick the round side of the opening.' }
    if (values.gap >= values.pitch / 4) {
      return { gap: 'That gap is wider than the thread is deep. Use a smaller gap.' }
    }
    return null
  },
  derive(values, changed, context) {
    if (changed !== 'fit') return null
    if (!isFitClass(values.fit)) return null
    return { gap: classGap(context.doc, values.fit) }
  },
  build(values, context) {
    const face = values.face[0].face!
    const editing = context.editing?.kind === 'screwLid' ? context.editing : null
    const feature: ScrewLidFeature = {
      id: editing?.id ?? context.id('screwLid'),
      kind: 'screwLid',
      name: editing?.name ?? 'Screw Lid',
      componentId: componentOfBody(context.doc, face.bodyId, context.componentId),
      face,
      anchor: values.face[0].point ?? editing?.anchor ?? [0, 0, 0],
      flipEnd: values.flipEnd,
      pitch: values.pitch,
      turns: values.turns,
      profile: values.profile as ThreadProfile,
      gap: values.gap,
      wall: values.wall,
      top: values.top,
      grip: values.grip,
      capBodyId: context.id('cap'),
      ...(isFitClass(values.fit) ? { fitClass: values.fit as FitClass } : {}),
    }
    return [feature]
  },
  adjust(doc, features, _context, values) {
    const feature = features.find((candidate) => candidate.kind === 'screwLid')
    if (!feature) return
    const found = findBody(doc, feature.capBodyId)
    if (found) {
      const taken = new Set(
        doc.components.flatMap((component) =>
          component.bodies.filter((body) => body.id !== feature.capBodyId).map((body) => body.name),
        ),
      )
      let name = 'Cap'
      for (let n = 2; taken.has(name); n++) name = `Cap ${n}`
      found.body.name = name
    }
    linkFitClass(
      doc,
      feature.id,
      isFitClass(values.fit) ? (values.fit as FitClass) : undefined,
      values.gap,
    )
  },
})
