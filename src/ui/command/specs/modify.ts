import type {
  ChamferFeature,
  CombineFeature,
  Feature,
  FilletFeature,
  LidFit,
  MoveFeature,
  ShellFeature,
} from '../../../doc/types'
import { defineCommand, type CommandContext, type SelectionPick } from '../types'
import { bodyIdsOf, componentOfBody, singleBody } from './shared'

const EDGES_INPUT = {
  id: 'edges',
  kind: 'selection',
  label: 'Edges',
  hint: 'The edges to change. Pick a whole body to change every edge on it.',
  filter: ['edge', 'body'],
  min: 1,
  prompt: 'Select edges',
} as const

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
})
