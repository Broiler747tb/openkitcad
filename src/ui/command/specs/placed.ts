import { frameToLocal, frameToWorld, makeFrame, v3 } from '../../../core/math'
import type { HoleFeature, HoleStyle, VentFeature, VentShape } from '../../../doc/types'
import { defineCommand, type CommandContext, type SelectionPick } from '../types'
import { componentOfBody, pickedFrame } from './shared'

const FACE_INPUT = {
  id: 'face',
  kind: 'selection',
  label: 'Face',
  hint: 'The flat face this goes into.',
  filter: ['face'],
  min: 1,
  max: 1,
  prompt: 'Select a face',
} as const

const EXTENT_INPUTS = [
  {
    id: 'extent',
    kind: 'choice',
    label: 'Extents',
    options: [
      { value: 'through', label: 'All', hint: 'Right through the body.' },
      { value: 'distance', label: 'Distance', hint: 'To a set depth.' },
    ],
    default: 'through',
  },
  {
    id: 'depth',
    kind: 'length',
    label: 'Depth',
    default: 5,
    min: 0,
    exclusiveMin: true,
    visible: (values: { extent?: unknown }) => values.extent === 'distance',
  },
] as const

function placement(context: CommandContext, picks: readonly SelectionPick[]) {
  const face = picks[0].face!
  return {
    bodyId: face.bodyId,
    componentId:
      context.editing?.componentId ??
      componentOfBody(context.doc, face.bodyId, context.componentId),
    plane: { kind: 'face' as const, face, offset: 0 },
  }
}

export function pointOnFace(pick: SelectionPick): Record<string, number> {
  if (!pick.point || !pick.normal) return {}
  const normal = v3.norm(pick.normal)
  const frame = makeFrame(v3.scale(normal, v3.dot(pick.point, normal)), normal)
  const [x, y] = frameToLocal(frame, pick.point)
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
}

export const holeCommand = defineCommand({
  id: 'hole',
  label: 'Hole',
  hint: 'A drilled hole into a flat face, plain, counterbored or countersunk.',
  icon: '⊙',
  inputs: [
    { ...FACE_INPUT, fills: pointOnFace },
    { id: 'x', kind: 'length', label: 'Position X', hint: 'Along the face.', default: 0 },
    { id: 'y', kind: 'length', label: 'Position Y', hint: 'Across the face.', default: 0 },
    {
      id: 'style',
      kind: 'choice',
      label: 'Hole Type',
      options: [
        { value: 'simple', label: 'Simple', hint: 'A straight hole.' },
        {
          value: 'counterbore',
          label: 'Counterbore',
          hint: 'A wider step so a screw head sits flush.',
        },
        { value: 'countersink', label: 'Countersink', hint: 'A cone for a flat-head screw.' },
      ],
      default: 'simple',
    },
    {
      id: 'diameter',
      kind: 'length',
      label: 'Diameter',
      default: 3.4,
      min: 0,
      exclusiveMin: true,
      field: 'diameter',
    },
    ...EXTENT_INPUTS,
    {
      id: 'headDiameter',
      kind: 'length',
      label: 'Head Diameter',
      hint: 'The wide part at the top.',
      default: 6.5,
      min: 0,
      exclusiveMin: true,
      field: 'counterboreDiameter',
      visible: (values) => values.style !== 'simple',
    },
    {
      id: 'headDepth',
      kind: 'length',
      label: 'Head Depth',
      default: 3.5,
      min: 0,
      exclusiveMin: true,
      field: 'counterboreDepth',
      visible: (values) => values.style === 'counterbore',
    },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Countersink Angle',
      default: 90,
      min: 0,
      max: 180,
      exclusiveMin: true,
      field: 'countersinkAngle',
      visible: (values) => values.style === 'countersink',
    },
  ],
  validate(values) {
    if (values.style !== 'simple' && values.headDiameter <= values.diameter) {
      return { headDiameter: 'The head has to be wider than the hole.' }
    }
    return null
  },
  build(values, context) {
    const style = values.style as HoleStyle
    const feature: HoleFeature = {
      id: context.editing?.id ?? context.id('hole'),
      kind: 'hole',
      name: context.editing?.name ?? 'Hole',
      ...placement(context, values.face),
      source: { kind: 'explicit', positions: [[values.x, values.y]] },
      style,
      diameter: values.diameter,
      depth: values.extent === 'through' ? 'through' : values.depth,
    }
    if (style !== 'simple') feature.counterboreDiameter = values.headDiameter
    if (style === 'counterbore') feature.counterboreDepth = values.headDepth
    if (style === 'countersink') feature.countersinkAngle = values.angle
    if (context.editing?.kind === 'hole' && context.editing.fastener) {
      feature.fastener = context.editing.fastener
    }
    return [feature]
  },
  handles(values, context) {
    const face = values.face[0]?.face
    const frame = face && pickedFrame(values.face, context.editing?.id)
    if (!face || !frame) return []
    const componentId = componentOfBody(context.doc, face.bodyId, context.componentId)
    const point = frameToWorld(frame, [values.x, values.y])
    return [
      {
        kind: 'arrow',
        input: 'diameter',
        componentId,
        anchor: { point, direction: frame.xDir },
        scale: 0.5,
      },
      ...(values.extent === 'distance'
        ? [
            {
              kind: 'arrow' as const,
              input: 'depth',
              componentId,
              anchor: { point, direction: v3.scale(frame.normal, -1) },
            },
          ]
        : []),
    ]
  },
})

export const VENT_SHAPES: ReadonlyArray<{ value: VentShape; label: string; hint: string }> = [
  { value: 'hex', label: 'Hexagons', hint: 'Honeycomb. Webs the same width in every direction.' },
  { value: 'round', label: 'Round holes', hint: 'Plain and quiet. Prints cleanly at any size.' },
  {
    value: 'square',
    label: 'Square holes',
    hint: 'A grille. Reads as deliberate on a flat panel.',
  },
  { value: 'triangle', label: 'Triangles', hint: 'Alternating rows, so the webs stay even.' },
  {
    value: 'diamond',
    label: 'Diamonds',
    hint: 'Squares on their corner. No flat overhang to sag.',
  },
  { value: 'slot', label: 'Slots', hint: 'Louvre bars with rounded ends.' },
  { value: 'cross', label: 'Crosses', hint: 'Decorative. Arms a third of the span.' },
  { value: 'gyroid', label: 'Gyroid weave', hint: 'One winding channel. Slower to work out.' },
]

export const ventCommand = defineCommand({
  id: 'vent',
  label: 'Vent',
  hint: 'A pattern of holes cut through a flat face, kept inside a border.',
  icon: '▦',
  inputs: [
    FACE_INPUT,
    {
      id: 'shape',
      kind: 'choice',
      label: 'Pattern',
      options: VENT_SHAPES,
      default: 'hex',
    },
    {
      id: 'size',
      kind: 'length',
      label: 'Hole Size',
      default: 6,
      min: 0.2,
      field: 'size',
    },
    { id: 'spacing', kind: 'length', label: 'Gap Between', default: 2, min: 0.2, field: 'spacing' },
    { id: 'margin', kind: 'length', label: 'Border', default: 3, min: 0, field: 'margin' },
    ...EXTENT_INPUTS,
  ],
  build(values, context) {
    const feature: VentFeature = {
      id: context.editing?.id ?? context.id('vent'),
      kind: 'vent',
      name: context.editing?.name ?? 'Vent',
      ...placement(context, values.face),
      shape: values.shape as VentShape,
      size: values.size,
      spacing: values.spacing,
      margin: values.margin,
      depth: values.extent === 'through' ? 'through' : values.depth,
    }
    return [feature]
  },
})
