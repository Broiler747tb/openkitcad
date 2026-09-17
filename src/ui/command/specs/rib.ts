import type { RibFeature, WallDepth, WebFeature } from '../../../doc/types'
import { defineCommand, type LooseCommandValues, type SelectionPick } from '../types'
import { componentOfBody, singleBody } from './shared'
import { findFeature } from '../../../doc/model'
import type { OkcDocument } from '../../../doc/types'

export const WALL_DEPTHS = [
  { value: 'toNext', label: 'To the Part', hint: 'Grows until it lands on the body.' },
  { value: 'finite', label: 'Distance', hint: 'Grows exactly as far as you say.' },
] as const

export const WALL_SIDES = [
  { value: 'both', label: 'Both Sides', hint: 'The line is the middle of the wall.' },
  { value: 'one', label: 'One Side', hint: 'The wall grows to one side of the line.' },
] as const

const CURVES = {
  id: 'curves',
  kind: 'selection',
  label: 'Lines',
  filter: ['sketchCurve'],
  min: 1,
  prompt: 'Select the sketch lines',
} as const

const BODY = {
  id: 'body',
  kind: 'selection',
  label: 'Body',
  hint: 'The part the wall is joined onto and grown down to.',
  filter: ['body'],
  min: 1,
  max: 1,
  prompt: 'Select the body',
} as const

const SHAPE_INPUTS = [
  {
    id: 'thickness',
    kind: 'length',
    label: 'Thickness',
    hint: 'How thick the wall is. Two to three times the printed wall is usual.',
    default: 2,
    min: 0,
    exclusiveMin: true,
    field: 'thickness',
  },
  {
    id: 'sides',
    kind: 'choice',
    label: 'Thickness Sides',
    options: WALL_SIDES,
    default: 'both',
    display: 'buttons',
  },
  {
    id: 'flipSide',
    kind: 'toggle',
    label: 'Other Side',
    hint: 'Put the thickness on the other side of the line.',
    visible: (values: LooseCommandValues) => values.sides === 'one',
  },
  {
    id: 'depth',
    kind: 'choice',
    label: 'Depth',
    options: WALL_DEPTHS,
    default: 'toNext',
    display: 'buttons',
  },
  {
    id: 'distance',
    kind: 'length',
    label: 'Distance',
    hint: 'How far the wall grows from the line.',
    default: 10,
    min: 0,
    exclusiveMin: true,
    field: 'distance',
    visible: (values: LooseCommandValues) => values.depth === 'finite',
  },
  {
    id: 'flip',
    kind: 'toggle',
    label: 'Flip',
    hint: 'Grow the wall the other way along the sketch.',
  },
] as const

export function curveSketchId(picks: readonly SelectionPick[]): string | null {
  const ids = [...new Set(picks.map((pick) => pick.curve?.sketchId).filter(Boolean))]
  return ids.length === 1 ? (ids[0] as string) : null
}

function wallProblem(
  doc: OkcDocument,
  values: { curves: readonly SelectionPick[]; body: readonly SelectionPick[] },
): Record<string, string> | null {
  const sketchId = curveSketchId(values.curves)
  if (!sketchId) return { curves: 'Pick lines from one sketch.' }
  if (findFeature(doc, sketchId)?.kind !== 'sketch') return { curves: 'That sketch is gone.' }
  return singleBody(doc, values.body, 'body')
}

function wallFeature(
  kind: 'rib' | 'web',
  values: {
    curves: readonly SelectionPick[]
    body: readonly SelectionPick[]
    thickness: number
    sides: string
    flipSide: boolean
    depth: string
    distance: number
    flip: boolean
  },
  context: {
    doc: OkcDocument
    componentId: string
    editing?: { id: string; name: string }
    id: (role: string) => string
  },
): RibFeature | WebFeature {
  const sketchId = curveSketchId(values.curves)!
  const bodyId = values.body[0].id
  const sketch = findFeature(context.doc, sketchId)
  return {
    id: context.editing?.id ?? context.id(kind),
    kind,
    name: context.editing?.name ?? (kind === 'rib' ? 'Rib' : 'Web'),
    componentId: componentOfBody(context.doc, bodyId, sketch?.componentId ?? context.componentId),
    sketchId,
    curves: values.curves.map((pick) => pick.curve!.entityId),
    bodyId,
    thickness: values.thickness,
    sides: values.sides === 'one' ? 'one' : 'both',
    flipSide: values.flipSide,
    depth: values.depth === 'finite' ? 'finite' : ('toNext' as WallDepth),
    distance: values.distance,
    flip: values.flip,
  } as RibFeature | WebFeature
}

export const ribCommand = defineCommand({
  id: 'rib',
  label: 'Rib',
  hint: 'A thin wall along one run of sketch lines, grown down onto the part to brace it.',
  icon: '◺',
  inputs: [CURVES, BODY, ...SHAPE_INPUTS],
  validate: (values, context) => wallProblem(context.doc, values),
  build: (values, context) => [wallFeature('rib', values, context)],
})

export const webCommand = defineCommand({
  id: 'web',
  label: 'Web',
  hint: 'Thin walls along a set of sketch lines, grown down onto the part and joined where they cross.',
  icon: '⋕',
  inputs: [
    { ...CURVES, hint: 'Lines that cross each other become walls that meet.' },
    BODY,
    ...SHAPE_INPUTS,
  ],
  validate: (values, context) => wallProblem(context.doc, values),
  build: (values, context) => [wallFeature('web', values, context)],
})
