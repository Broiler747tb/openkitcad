import type {
  ChamferFeature,
  CombineFeature,
  DraftFeature,
  Feature,
  FilletFeature,
  LidFit,
  MoveFeature,
  OffsetFaceFeature,
  ShellFeature,
} from '../../../doc/types'
import { v3 } from '../../../core/math'
import { findBody } from '../../../doc/model'
import { useStore } from '../../../doc/store'
import {
  defineCommand,
  type AnyCommandSpec,
  type CommandContext,
  type CommandHandle,
  type SelectionPick,
} from '../types'
import { bodyIdsOf, componentOfBody, planeOf, singleBody } from './shared'

const EDGES_INPUT = {
  id: 'edges',
  kind: 'selection',
  label: 'Edges',
  hint: 'The edges to change. Pick a whole body to change every edge on it.',
  filter: ['edge', 'body'],
  min: 1,
  prompt: 'Select edges',
} as const

function edgeHandles(
  context: CommandContext,
  picks: readonly SelectionPick[],
  input: string,
): CommandHandle[] {
  const edge = picks.find((pick) => pick.edge)?.edge
  if (!edge) return []
  return [
    {
      kind: 'arrow',
      input,
      componentId: componentOfBody(context.doc, edge.bodyId, context.componentId),
      anchor: { edge },
    },
  ]
}

function edgeTarget(context: CommandContext, picks: readonly SelectionPick[]) {
  const bodyId = bodyIdsOf(picks)[0]
  return {
    bodyId,
    componentId:
      context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
    edges: picks.some((pick) => pick.kind === 'body')
      ? []
      : picks.flatMap((pick) => pick.edge ?? []),
  }
}

export const filletCommand = defineCommand({
  id: 'fillet',
  label: 'Fillet',
  hint: 'Round off edges with a constant radius.',
  icon: '◜',
  inputs: [
    EDGES_INPUT,
    {
      id: 'radius',
      kind: 'length',
      label: 'Radius',
      default: 2,
      min: 0,
      exclusiveMin: true,
      field: 'radius',
    },
  ],
  validate(values, context) {
    return singleBody(context.doc, values.edges, 'edges')
  },
  build(values, context) {
    const target = edgeTarget(context, values.edges)
    const feature: FilletFeature = {
      id: context.editing?.id ?? context.id('fillet'),
      kind: 'fillet',
      name: context.editing?.name ?? 'Fillet',
      radius: values.radius,
      ...target,
    }
    return [feature]
  },
  handles(values, context) {
    return edgeHandles(context, values.edges, 'radius')
  },
})

export const chamferCommand = defineCommand({
  id: 'chamfer',
  label: 'Chamfer',
  hint: 'Cut a flat bevel along edges.',
  icon: '◸',
  inputs: [
    EDGES_INPUT,
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance',
      default: 1,
      min: 0,
      exclusiveMin: true,
      field: 'distance',
    },
  ],
  validate(values, context) {
    return singleBody(context.doc, values.edges, 'edges')
  },
  build(values, context) {
    const target = edgeTarget(context, values.edges)
    const feature: ChamferFeature = {
      id: context.editing?.id ?? context.id('chamfer'),
      kind: 'chamfer',
      name: context.editing?.name ?? 'Chamfer',
      distance: values.distance,
      ...target,
    }
    return [feature]
  },
  handles(values, context) {
    return edgeHandles(context, values.edges, 'distance')
  },
})

const FACES_INPUT = {
  id: 'faces',
  kind: 'selection',
  label: 'Faces',
  hint: 'The faces to remove, which leave the openings.',
  filter: ['face'],
  min: 1,
  prompt: 'Select faces',
} as const

const THICKNESS_INPUT = {
  id: 'thickness',
  kind: 'length',
  label: 'Inside Thickness',
  hint: 'How thick the walls are.',
  default: 2,
  min: 0,
  exclusiveMin: true,
  field: 'thickness',
} as const

function thicknessHandles(
  context: CommandContext,
  picks: readonly SelectionPick[],
): CommandHandle[] {
  const face = picks.find((pick) => pick.face && pick.point && pick.normal)
  if (!face?.face || !face.point || !face.normal) return []
  return [
    {
      kind: 'arrow',
      input: 'thickness',
      componentId: componentOfBody(context.doc, face.face.bodyId, context.componentId),
      anchor: { point: face.point, direction: v3.scale(v3.norm(face.normal), -1) },
    },
  ]
}

function shellFeature(
  values: { faces: readonly SelectionPick[]; thickness: number },
  context: CommandContext,
): ShellFeature {
  const bodyId = bodyIdsOf(values.faces)[0]
  return {
    id: context.editing?.id ?? context.id('shell'),
    kind: 'shell',
    name: context.editing?.name ?? 'Shell',
    componentId:
      context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
    bodyId,
    thickness: values.thickness,
    openFaces: values.faces.flatMap((pick) => pick.face ?? []),
  }
}

export const shellCommand = defineCommand({
  id: 'shell',
  label: 'Shell',
  hint: 'Hollow a body out, leaving walls of an even thickness and openings where faces were.',
  icon: '▢',
  inputs: [
    FACES_INPUT,
    THICKNESS_INPUT,
    {
      id: 'lid',
      kind: 'toggle',
      label: 'Make a Lid',
      hint: 'Also make a separate lid that closes the first opening.',
    },
    {
      id: 'fit',
      kind: 'choice',
      label: 'Lid Fit',
      options: [
        {
          value: 'ledge',
          label: 'Rests on a ledge',
          hint: 'A step is cut into the wall so the lid sits on it and cannot fall through.',
        },
        {
          value: 'snap',
          label: 'Snaps in',
          hint: 'A thin skirt with a ridge clicks into a groove in the wall. Needs walls of about 2 mm.',
        },
        {
          value: 'friction',
          label: 'Just drops in',
          hint: 'Nothing holds it but the fit. It lifts straight out.',
        },
      ],
      default: 'ledge',
      visible: (values) => values.lid === true,
    },
    {
      id: 'clearance',
      kind: 'length',
      label: 'Lid Gap',
      hint: 'The gap left all round the lid so it fits.',
      default: 0.2,
      min: 0,
      visible: (values) => values.lid === true,
    },
  ],
  validate(values, context) {
    return singleBody(context.doc, values.faces, 'faces')
  },
  build(values, context) {
    const shell = shellFeature(values, context)
    const features: Feature[] = [shell]
    if (!values.lid) return features
    const lidId = context.id('lid')
    const fit = values.fit as LidFit
    features.push({
      id: lidId,
      kind: 'lid',
      name: 'Lid',
      componentId: shell.componentId,
      sourceBodyId: shell.bodyId,
      shellFeatureId: shell.id,
      thickness: values.thickness,
      clearance: values.clearance,
      fit,
      result: { kind: 'newBody', bodyId: context.id('lidBody') },
    })
    if (fit !== 'friction') {
      features.push({
        id: context.id('seat'),
        kind: 'lidSocket',
        name: fit === 'ledge' ? 'Ledge for the lid' : 'Groove for the lid',
        componentId: shell.componentId,
        bodyId: shell.bodyId,
        lidFeatureId: lidId,
      })
    }
    return features
  },
  handles(values, context) {
    return thicknessHandles(context, values.faces)
  },
})

export const shellEditCommand = defineCommand({
  id: 'shell',
  label: 'Shell',
  hint: shellCommand.hint,
  icon: shellCommand.icon,
  inputs: [FACES_INPUT, THICKNESS_INPUT],
  validate(values, context) {
    return singleBody(context.doc, values.faces, 'faces')
  },
  build(values, context) {
    return [shellFeature(values, context)]
  },
  handles(values, context) {
    return thicknessHandles(context, values.faces)
  },
})

export const combineCommand = defineCommand({
  id: 'combine',
  label: 'Combine',
  hint: 'Join, cut or intersect bodies with each other.',
  icon: '⊕',
  inputs: [
    {
      id: 'target',
      kind: 'selection',
      label: 'Target Body',
      hint: 'The body that is kept and changed.',
      filter: ['body'],
      min: 1,
      max: 1,
      prompt: 'Select a body',
    },
    {
      id: 'tools',
      kind: 'selection',
      label: 'Tool Bodies',
      hint: 'The bodies used to change it.',
      filter: ['body'],
      min: 1,
      prompt: 'Select bodies',
    },
    {
      id: 'operation',
      kind: 'choice',
      label: 'Operation',
      options: [
        { value: 'join', label: 'Join', hint: 'Fuse them into one body.' },
        { value: 'cut', label: 'Cut', hint: 'Remove the tool bodies from the target.' },
        { value: 'intersect', label: 'Intersect', hint: 'Keep only where they overlap.' },
      ],
      default: 'join',
    },
    {
      id: 'keepTools',
      kind: 'toggle',
      label: 'Keep Tools',
      hint: 'Leave the tool bodies in place afterwards.',
    },
  ],
  validate(values) {
    const target = bodyIdsOf(values.target)[0]
    if (bodyIdsOf(values.tools).includes(target)) {
      return { tools: 'A body cannot be combined with itself.' }
    }
    return null
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.target)[0]
    const feature: CombineFeature = {
      id: context.editing?.id ?? context.id('combine'),
      kind: 'combine',
      name: context.editing?.name ?? 'Combine',
      componentId:
        context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
      bodyId,
      toolBodyIds: bodyIdsOf(values.tools),
      operation: values.operation,
      keepTools: values.keepTools,
    }
    return [feature]
  },
})

export const moveCommand = defineCommand({
  id: 'move',
  label: 'Move/Copy',
  hint: 'Move bodies by an exact distance and turn them about their centre.',
  icon: '✥',
  inputs: [
    {
      id: 'bodies',
      kind: 'selection',
      label: 'Objects',
      hint: 'The bodies to move.',
      filter: ['body'],
      min: 1,
      prompt: 'Select bodies',
    },
    { id: 'dx', kind: 'length', label: 'X Distance', default: 0 },
    { id: 'dy', kind: 'length', label: 'Y Distance', default: 0 },
    { id: 'dz', kind: 'length', label: 'Z Distance', default: 0 },
    { id: 'rx', kind: 'angle', label: 'X Angle', default: 0 },
    { id: 'ry', kind: 'angle', label: 'Y Angle', default: 0 },
    { id: 'rz', kind: 'angle', label: 'Z Angle', default: 0 },
  ],
  validate(values, context) {
    const components = new Set(
      bodyIdsOf(values.bodies).map((id) => componentOfBody(context.doc, id, '')),
    )
    if (components.size > 1) return { bodies: 'Move bodies from one component at a time.' }
    const still = [values.dx, values.dy, values.dz, values.rx, values.ry, values.rz].every(
      (value) => value === 0,
    )
    return still ? 'Enter a distance or an angle to move by.' : null
  },
  build(values, context) {
    const bodyIds = bodyIdsOf(values.bodies)
    const feature: MoveFeature = {
      id: context.editing?.id ?? context.id('move'),
      kind: 'move',
      name: context.editing?.name ?? 'Move',
      componentId:
        context.editing?.componentId ??
        componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
      offset: [values.dx, values.dy, values.dz],
      rotation: [values.rx, values.ry, values.rz],
    }
    return [feature]
  },
  handles(values, context) {
    const bodyId = bodyIdsOf(values.bodies)[0]
    const found = bodyId ? findBody(context.doc, bodyId) : undefined
    if (!found) return []
    const state = useStore.getState()
    const instance = state.instances.find((candidate) => candidate.bodyId === bodyId)
    const bounds = instance ? state.meshes.get(instance.meshKey)?.bounds : undefined
    if (!bounds) return []
    const point: [number, number, number] = [
      (bounds[0] + bounds[3]) / 2,
      (bounds[1] + bounds[4]) / 2,
      (bounds[2] + bounds[5]) / 2,
    ]
    const axes: Array<[string, [number, number, number]]> = [
      ['dx', [1, 0, 0]],
      ['dy', [0, 1, 0]],
      ['dz', [0, 0, 1]],
    ]
    return axes.map(([input, direction]) => ({
      kind: 'arrow',
      input,
      componentId: found.component.id,
      anchor: { point, direction },
    }))
  },
})

const MOVED_FACES_INPUT = {
  id: 'faces',
  kind: 'selection',
  label: 'Faces',
  hint: 'Flat faces on one body.',
  filter: ['face'],
  min: 1,
  prompt: 'Select faces',
} as const

export const offsetFaceCommand = defineCommand({
  id: 'offsetFace',
  label: 'Offset Face',
  hint: 'Moves flat faces in or out, stretching the faces around them.',
  icon: '⇱',
  inputs: [MOVED_FACES_INPUT, { id: 'distance', kind: 'length', label: 'Distance', default: 1 }],
  validate(values, context) {
    if (!values.distance) return { distance: 'This cannot be zero.' }
    return singleBody(context.doc, values.faces, 'faces')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.faces)[0]
    const feature: OffsetFaceFeature = {
      id: context.editing?.id ?? context.id('offsetFace'),
      kind: 'offsetFace',
      name: context.editing?.name ?? 'Offset Face',
      componentId:
        context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
      bodyId,
      faces: values.faces.flatMap((pick) => pick.face ?? []),
      distance: values.distance,
    }
    return [feature]
  },
  handles(values, context) {
    const face = values.faces.find((pick) => pick.face && pick.point && pick.normal)
    if (!face?.face || !face.point || !face.normal) return []
    return [
      {
        kind: 'arrow',
        input: 'distance',
        componentId: componentOfBody(context.doc, face.face.bodyId, context.componentId),
        anchor: { point: face.point, direction: v3.norm(face.normal) },
      },
    ]
  },
})

export const pressPullCommand: AnyCommandSpec = {
  ...(offsetFaceCommand as unknown as AnyCommandSpec),
  id: 'pressPull',
  label: 'Press Pull',
  hint: 'Pulls a face out or pushes it in. With edges picked it rounds them, and on a sketch it extrudes.',
}

export const draftCommand = defineCommand({
  id: 'draft',
  label: 'Draft',
  hint: 'Tilts faces by an angle so a moulded or cast part slides out cleanly.',
  icon: '◿',
  inputs: [
    {
      id: 'plane',
      kind: 'selection',
      label: 'Plane',
      hint: 'The faces pivot where they meet this plane and lean away from its normal.',
      filter: ['face', 'plane'],
      min: 1,
      max: 1,
      prompt: 'Select a plane',
    },
    MOVED_FACES_INPUT,
    { id: 'flip', kind: 'toggle', label: 'Flip Pull Direction' },
    { id: 'angle', kind: 'angle', label: 'Angle', default: 5, min: -60, max: 60 },
  ],
  validate(values, context) {
    if (!values.angle) return { angle: 'This cannot be zero.' }
    return singleBody(context.doc, values.faces, 'faces')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.faces)[0]
    const feature: DraftFeature = {
      id: context.editing?.id ?? context.id('draft'),
      kind: 'draft',
      name: context.editing?.name ?? 'Draft',
      componentId:
        context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
      bodyId,
      faces: values.faces.flatMap((pick) => pick.face ?? []),
      plane: planeOf(values.plane),
      angle: values.angle,
      flip: values.flip,
    }
    return [feature]
  },
})
