import { findFeature } from '../../../doc/model'
import type {
  BodyPatternFeature,
  CoilFeature,
  Feature,
  LoftFeature,
  MirrorFeature,
  PatchFeature,
  PipeFeature,
  PlaneRef,
  ReverseNormalFeature,
  ScaleFeature,
  SplitBodyFeature,
  StitchFeature,
  SurfaceOffsetFeature,
  SweepFeature,
  ThickenFeature,
  UnstitchFeature,
} from '../../../doc/types'
import { pickSketchId } from '../picks'
import {
  defineCommand,
  type AnyCommandSpec,
  type LooseCommandValues,
  type SelectionPick,
} from '../types'
import { bodyMeshOf } from './mesh'
import { extrudeCommand, OPERATION_INPUTS, revolveCommand, SURFACE_INPUT } from './sketchBased'
import {
  bodyIdsOf,
  componentOfBody,
  mergeProfilePicks,
  operationProblem,
  planeOf,
  profileKeys,
  profileProblem,
  resultOf,
  sketchOf,
} from './shared'

function surfaceVariant(command: unknown, label: string, hint: string): AnyCommandSpec {
  const spec = command as AnyCommandSpec
  return {
    ...spec,
    id: `${spec.id}Surface`,
    label,
    hint,
    inputs: spec.inputs.map((input) =>
      input.id === 'surface' && input.kind === 'toggle' ? { ...input, default: true } : input,
    ),
  }
}

const ORIGIN_PLANES = [
  { value: 'XY', label: 'XY' },
  { value: 'XZ', label: 'XZ' },
  { value: 'YZ', label: 'YZ' },
] as const

const PLANE_INPUTS = [
  {
    id: 'plane',
    kind: 'selection',
    label: 'Plane',
    hint: 'A flat face to use. Leave it empty to use an origin plane.',
    filter: ['face', 'plane'],
    min: 0,
    max: 1,
    prompt: 'Origin plane',
  },
  {
    id: 'origin',
    kind: 'choice',
    label: 'Origin Plane',
    options: ORIGIN_PLANES,
    default: 'XY',
    display: 'buttons',
    visible: (values: LooseCommandValues) => !(values.plane as SelectionPick[]).length,
  },
  { id: 'offset', kind: 'length', label: 'Offset', default: 0 },
] as const

function chosenPlane(values: LooseCommandValues): PlaneRef {
  const picks = values.plane as SelectionPick[]
  if (picks.length) return { ...planeOf(picks), offset: values.offset as number }
  return {
    kind: 'named',
    name: values.origin as 'XY' | 'XZ' | 'YZ',
    offset: values.offset as number,
  }
}

function kindProblem(
  picks: readonly SelectionPick[],
  input: string,
  want: 'surface' | 'brep',
): Record<string, string> | null {
  for (const id of bodyIdsOf(picks)) {
    const kind = bodyMeshOf(id)?.kind
    if (!kind) continue
    if (kind === 'mesh') return { [input]: 'That is a mesh body. Convert it to a solid first.' }
    if (want === 'surface' && kind !== 'surface') {
      return { [input]: 'Pick a surface body.' }
    }
  }
  return null
}

function reusedIds(
  editing: readonly string[] | undefined,
  count: number,
  make: (index: number) => string,
): string[] {
  return Array.from({ length: count }, (_, index) => editing?.[index] ?? make(index))
}

const BODIES = {
  id: 'bodies',
  kind: 'selection',
  label: 'Bodies',
  filter: ['body'],
  min: 1,
  prompt: 'Select bodies',
} as const

const BODY = {
  id: 'body',
  kind: 'selection',
  label: 'Body',
  filter: ['body'],
  min: 1,
  max: 1,
  prompt: 'Select a body',
} as const

export const loftCommand = defineCommand({
  id: 'loft',
  label: 'Loft',
  hint: 'Blends one profile into the next, in the order you pick them.',
  icon: '◭',
  inputs: [
    {
      id: 'sections',
      kind: 'selection',
      label: 'Profiles',
      hint: 'Pick a closed area in each sketch, in order.',
      filter: ['profile', 'sketch'],
      min: 2,
      prompt: 'Select profiles',
    },
    {
      id: 'ruled',
      kind: 'toggle',
      label: 'Straight Sides',
      hint: 'Joins the profiles with straight lines instead of a smooth blend.',
    },
    SURFACE_INPUT,
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    const sketches = values.sections.map((pick) => pickSketchId(pick))
    if (new Set(sketches).size !== sketches.length) {
      return { sections: 'Pick one profile from each sketch.' }
    }
    for (const pick of values.sections) {
      const problem = profileProblem(context.doc, [pick])
      if (problem) return { sections: problem.profile }
    }
    return values.surface ? null : operationProblem(values)
  },
  build(values, context) {
    const first = sketchOf(context.doc, values.sections)!
    const editing = context.editing?.kind === 'loft' ? context.editing : null
    const feature: LoftFeature = {
      id: editing?.id ?? context.id('loft'),
      kind: 'loft',
      name: editing?.name ?? (values.surface ? 'Loft Surface' : 'Loft'),
      componentId: first.componentId,
      sections: values.sections.map((pick) => ({
        sketchId: pickSketchId(pick),
        ...(pick.profile ? { profiles: [pick.profile.key] } : {}),
      })),
      ruled: values.ruled,
      surface: values.surface,
      result: values.surface
        ? { kind: 'newBody', bodyId: context.id('body') }
        : resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const sweepCommand = defineCommand({
  id: 'sweep',
  label: 'Sweep',
  hint: 'Carries a profile along a path drawn in another sketch.',
  icon: '⤳',
  inputs: [
    {
      id: 'profile',
      kind: 'selection',
      label: 'Profile',
      filter: ['profile', 'sketch'],
      min: 1,
      prompt: 'Select a profile',
      merge: mergeProfilePicks,
    },
    {
      id: 'path',
      kind: 'selection',
      label: 'Path',
      hint: 'A sketch of connected curves. Pick it in the Browser or timeline.',
      filter: ['sketch'],
      min: 1,
      max: 1,
      prompt: 'Select a path sketch',
    },
    SURFACE_INPUT,
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    const profile = sketchOf(context.doc, values.profile)
    if (profile && values.path[0]?.id === profile.id) {
      return { path: 'The path has to be in a different sketch from the profile.' }
    }
    return (
      profileProblem(context.doc, values.profile) ??
      (values.surface ? null : operationProblem(values))
    )
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const editing = context.editing?.kind === 'sweep' ? context.editing : null
    const keys = profileKeys(values.profile)
    const feature: SweepFeature = {
      id: editing?.id ?? context.id('sweep'),
      kind: 'sweep',
      name: editing?.name ?? (values.surface ? 'Sweep Surface' : 'Sweep'),
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(keys ? { profiles: keys } : {}),
      pathSketchId: values.path[0].id,
      surface: values.surface,
      result: values.surface
        ? { kind: 'newBody', bodyId: context.id('body') }
        : resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const coilCommand = defineCommand({
  id: 'coil',
  label: 'Coil',
  hint: 'A spring or thread-like helix of a round, square or triangular wire.',
  icon: '➰',
  inputs: [
    ...PLANE_INPUTS,
    { id: 'x', kind: 'length', label: 'Center X', default: 0 },
    { id: 'y', kind: 'length', label: 'Center Y', default: 0 },
    { id: 'diameter', kind: 'length', label: 'Diameter', default: 20, min: 0, exclusiveMin: true },
    {
      id: 'revolutions',
      kind: 'number',
      label: 'Revolutions',
      default: 5,
      min: 0,
      max: 500,
      exclusiveMin: true,
    },
    { id: 'height', kind: 'length', label: 'Height', default: 30, min: 0, exclusiveMin: true },
    {
      id: 'section',
      kind: 'choice',
      label: 'Section',
      options: [
        { value: 'circular', label: 'Circular' },
        { value: 'square', label: 'Square' },
        { value: 'triangleOutside', label: 'Triangular (External)' },
        { value: 'triangleInside', label: 'Triangular (Internal)' },
      ],
      default: 'circular',
    },
    {
      id: 'sectionSize',
      kind: 'length',
      label: 'Section Size',
      default: 2,
      min: 0,
      exclusiveMin: true,
    },
    { id: 'clockwise', kind: 'toggle', label: 'Clockwise' },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    if (values.sectionSize >= values.diameter) {
      return { sectionSize: 'The section has to be smaller than the diameter.' }
    }
    return operationProblem(values)
  },
  build(values, context) {
    const editing = context.editing?.kind === 'coil' ? context.editing : null
    const feature: CoilFeature = {
      id: editing?.id ?? context.id('coil'),
      kind: 'coil',
      name: editing?.name ?? 'Coil',
      componentId: editing?.componentId ?? context.componentId,
      plane: chosenPlane(values as LooseCommandValues),
      centre: [values.x, values.y],
      diameter: values.diameter,
      revolutions: values.revolutions,
      height: values.height,
      section: values.section,
      sectionSize: values.sectionSize,
      clockwise: values.clockwise,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const pipeCommand = defineCommand({
  id: 'pipe',
  label: 'Pipe',
  hint: 'A round, square or triangular tube along a path sketch.',
  icon: '◯',
  inputs: [
    {
      id: 'path',
      kind: 'selection',
      label: 'Path',
      hint: 'A sketch of connected curves. Pick it in the Browser or timeline.',
      filter: ['sketch'],
      min: 1,
      max: 1,
      prompt: 'Select a path sketch',
    },
    {
      id: 'section',
      kind: 'choice',
      label: 'Section',
      options: [
        { value: 'circular', label: 'Circular' },
        { value: 'square', label: 'Square' },
        { value: 'triangular', label: 'Triangular' },
      ],
      default: 'circular',
    },
    { id: 'size', kind: 'length', label: 'Section Size', default: 5, min: 0, exclusiveMin: true },
    { id: 'hollow', kind: 'toggle', label: 'Hollow' },
    {
      id: 'thickness',
      kind: 'length',
      label: 'Section Thickness',
      default: 1,
      min: 0,
      exclusiveMin: true,
      visible: (values) => values.hollow === true,
    },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    if (values.hollow && values.thickness * 2 >= values.size) {
      return { thickness: 'The wall is too thick for the section.' }
    }
    return operationProblem(values)
  },
  build(values, context) {
    const path = findFeature(context.doc, values.path[0].id)
    const editing = context.editing?.kind === 'pipe' ? context.editing : null
    const feature: PipeFeature = {
      id: editing?.id ?? context.id('pipe'),
      kind: 'pipe',
      name: editing?.name ?? 'Pipe',
      componentId: path?.componentId ?? context.componentId,
      pathSketchId: values.path[0].id,
      section: values.section,
      size: values.size,
      hollow: values.hollow,
      thickness: values.thickness,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const thickenCommand = defineCommand({
  id: 'thicken',
  label: 'Thicken',
  hint: 'Gives a surface a thickness so it becomes a solid.',
  icon: '▰',
  inputs: [
    { ...BODY, label: 'Surface', prompt: 'Select a surface body' },
    { id: 'thickness', kind: 'length', label: 'Thickness', default: 2, min: 0, exclusiveMin: true },
    {
      id: 'direction',
      kind: 'choice',
      label: 'Direction',
      options: [
        { value: 'one', label: 'One Side' },
        { value: 'symmetric', label: 'Symmetric' },
      ],
      default: 'one',
    },
    ...OPERATION_INPUTS,
  ],
  validate(values) {
    return kindProblem(values.body, 'body', 'surface') ?? operationProblem(values)
  },
  build(values, context) {
    const source = bodyIdsOf(values.body)[0]
    const editing = context.editing?.kind === 'thicken' ? context.editing : null
    const feature: ThickenFeature = {
      id: editing?.id ?? context.id('thicken'),
      kind: 'thicken',
      name: editing?.name ?? 'Thicken',
      componentId: componentOfBody(context.doc, source, context.componentId),
      sourceBodyId: source,
      thickness: values.thickness,
      symmetric: values.direction === 'symmetric',
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const patchCommand = defineCommand({
  id: 'patch',
  label: 'Patch',
  hint: 'Fills a closed sketch outline with a surface.',
  icon: '▭',
  inputs: [
    {
      id: 'profile',
      kind: 'selection',
      label: 'Boundary',
      filter: ['profile', 'sketch'],
      min: 1,
      prompt: 'Select a closed outline',
      merge: mergeProfilePicks,
    },
  ],
  validate(values, context) {
    return profileProblem(context.doc, values.profile)
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const editing = context.editing?.kind === 'patch' ? context.editing : null
    const keys = profileKeys(values.profile)
    const feature: PatchFeature = {
      id: editing?.id ?? context.id('patch'),
      kind: 'patch',
      name: editing?.name ?? 'Patch',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(keys ? { profiles: keys } : {}),
      bodyId: editing?.bodyId ?? context.id('body'),
    }
    return [feature]
  },
})

const AXES = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
] as const

function patternCopies(values: LooseCommandValues): number {
  if (values.pattern === 'circular') return Math.max(1, values.count as number) - 1
  return Math.max(1, values.countOne as number) * Math.max(1, values.countTwo as number) - 1
}

export const patternCommand = defineCommand({
  id: 'bodyPattern',
  label: 'Pattern',
  hint: 'Copies bodies in rows and columns, or around an axis.',
  icon: '⁂',
  inputs: [
    BODIES,
    {
      id: 'pattern',
      kind: 'choice',
      label: 'Pattern Type',
      options: [
        { value: 'rectangular', label: 'Rectangular' },
        { value: 'circular', label: 'Circular' },
      ],
      default: 'rectangular',
      display: 'buttons',
    },
    {
      id: 'axisOne',
      kind: 'choice',
      label: 'Direction 1',
      options: AXES,
      default: 'x',
      display: 'buttons',
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'countOne',
      kind: 'integer',
      label: 'Quantity',
      default: 3,
      min: 1,
      max: 200,
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'spacingOne',
      kind: 'length',
      label: 'Spacing',
      default: 20,
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'axisTwo',
      kind: 'choice',
      label: 'Direction 2',
      options: AXES,
      default: 'y',
      display: 'buttons',
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'countTwo',
      kind: 'integer',
      label: 'Quantity',
      default: 1,
      min: 1,
      max: 200,
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'spacingTwo',
      kind: 'length',
      label: 'Spacing',
      default: 20,
      visible: (values) => values.pattern !== 'circular',
    },
    {
      id: 'axis',
      kind: 'choice',
      label: 'Axis',
      options: AXES,
      default: 'z',
      display: 'buttons',
      visible: (values) => values.pattern === 'circular',
    },
    {
      id: 'count',
      kind: 'integer',
      label: 'Quantity',
      default: 6,
      min: 1,
      max: 360,
      visible: (values) => values.pattern === 'circular',
    },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Total Angle',
      default: 360,
      min: 0,
      max: 360,
      exclusiveMin: true,
      visible: (values) => values.pattern === 'circular',
    },
  ],
  validate(values) {
    if (values.pattern !== 'circular' && values.axisOne === values.axisTwo && values.countTwo > 1) {
      return { axisTwo: 'Pick a different direction for the second row.' }
    }
    if (!patternCopies(values as LooseCommandValues)) return 'Set a quantity above one.'
    if (patternCopies(values as LooseCommandValues) * values.bodies.length > 500) {
      return 'That makes more than 500 bodies.'
    }
    return kindProblem(values.bodies, 'bodies', 'brep')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = context.editing?.kind === 'bodyPattern' ? context.editing : null
    const copies = patternCopies(values as LooseCommandValues) * bodyIds.length
    const feature: BodyPatternFeature = {
      id: editing?.id ?? context.id('bodyPattern'),
      kind: 'bodyPattern',
      name: editing?.name ?? 'Pattern',
      componentId: componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
      pattern: values.pattern,
      axisOne: values.axisOne,
      countOne: values.countOne,
      spacingOne: values.spacingOne,
      axisTwo: values.axisTwo,
      countTwo: values.countTwo,
      spacingTwo: values.spacingTwo,
      axis: values.axis,
      count: values.count,
      angle: values.angle,
      newBodyIds: reusedIds(editing?.newBodyIds, copies, (index) => context.id(`copy${index}`)),
    }
    return [feature]
  },
})

export const mirrorCommand = defineCommand({
  id: 'mirror',
  label: 'Mirror',
  hint: 'Makes mirror images of bodies across a plane.',
  icon: '⧓',
  inputs: [BODIES, ...PLANE_INPUTS],
  validate(values) {
    return kindProblem(values.bodies, 'bodies', 'brep')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = context.editing?.kind === 'mirror' ? context.editing : null
    const feature: MirrorFeature = {
      id: editing?.id ?? context.id('mirror'),
      kind: 'mirror',
      name: editing?.name ?? 'Mirror',
      componentId: componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
      plane: chosenPlane(values as LooseCommandValues),
      newBodyIds: reusedIds(editing?.newBodyIds, bodyIds.length, (index) =>
        context.id(`mirror${index}`),
      ),
    }
    return [feature]
  },
})

export const splitBodyCommand = defineCommand({
  id: 'splitBody',
  label: 'Split Body',
  hint: 'Cuts a body in two along a plane.',
  icon: '⊘',
  inputs: [{ ...BODY, label: 'Body to Split' }, ...PLANE_INPUTS],
  validate(values) {
    return kindProblem(values.body, 'body', 'brep')
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = context.editing?.kind === 'splitBody' ? context.editing : null
    const feature: SplitBodyFeature = {
      id: editing?.id ?? context.id('splitBody'),
      kind: 'splitBody',
      name: editing?.name ?? 'Split Body',
      componentId: componentOfBody(context.doc, bodyId, context.componentId),
      bodyId,
      plane: chosenPlane(values as LooseCommandValues),
      newBodyId: editing?.newBodyId ?? context.id('split'),
    }
    return [feature]
  },
})

export const scaleCommand = defineCommand({
  id: 'scale',
  label: 'Scale',
  hint: 'Makes bodies bigger or smaller about their middle.',
  icon: '⤢',
  inputs: [
    BODIES,
    { id: 'factor', kind: 'number', label: 'Scale Factor', default: 1, min: 0, exclusiveMin: true },
  ],
  validate(values) {
    return kindProblem(values.bodies, 'bodies', 'brep')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = context.editing?.kind === 'scale' ? context.editing : null
    const feature: ScaleFeature = {
      id: editing?.id ?? context.id('scale'),
      kind: 'scale',
      name: editing?.name ?? 'Scale',
      componentId: componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
      factor: values.factor,
    }
    return [feature]
  },
})

export const stitchCommand = defineCommand({
  id: 'stitch',
  label: 'Stitch',
  hint: 'Joins surfaces along their edges, and closes them into a solid when they meet all round.',
  icon: '⧢',
  inputs: [
    { ...BODIES, label: 'Surfaces', min: 2, prompt: 'Select surface bodies' },
    {
      id: 'tolerance',
      kind: 'length',
      label: 'Tolerance',
      hint: 'How far apart two edges can be and still join.',
      default: 0.01,
      min: 0,
      exclusiveMin: true,
    },
  ],
  validate(values) {
    return kindProblem(values.bodies, 'bodies', 'brep')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = context.editing?.kind === 'stitch' ? context.editing : null
    const feature: StitchFeature = {
      id: editing?.id ?? context.id('stitch'),
      kind: 'stitch',
      name: editing?.name ?? 'Stitch',
      componentId: componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
      tolerance: values.tolerance,
    }
    return [feature]
  },
})

function faceCount(bodyId: string | undefined, editing?: Feature): number | undefined {
  if (!bodyId) return undefined
  if (editing?.kind === 'unstitch' && editing.bodyId === bodyId) {
    const slots = [editing.bodyId, ...editing.newBodyIds]
    const known = slots.reduce((sum, id) => sum + (bodyMeshOf(id)?.mesh.faceGroups.length ?? 0), 0)
    return known || slots.length
  }
  return bodyMeshOf(bodyId)?.mesh.faceGroups.length
}

export const unstitchCommand = defineCommand({
  id: 'unstitch',
  label: 'Unstitch',
  hint: 'Breaks a body into one surface body for each face.',
  icon: '⧣',
  inputs: [BODY],
  validate(values, context) {
    const problem = kindProblem(values.body, 'body', 'brep')
    if (problem) return problem
    const faces = faceCount(bodyIdsOf(values.body)[0], context.editing)
    if (faces !== undefined && faces < 2) return { body: 'That body has a single face already.' }
    if (faces !== undefined && faces > 500) return { body: 'That body has more than 500 faces.' }
    return null
  },
  build(values, context) {
    const bodyId = bodyIdsOf(values.body)[0]
    const editing = context.editing?.kind === 'unstitch' ? context.editing : null
    const faces = Math.max(2, faceCount(bodyId, context.editing) ?? 2)
    const feature: UnstitchFeature = {
      id: editing?.id ?? context.id('unstitch'),
      kind: 'unstitch',
      name: editing?.name ?? 'Unstitch',
      componentId: componentOfBody(context.doc, bodyId, context.componentId),
      bodyId,
      newBodyIds: reusedIds(editing?.newBodyIds, faces - 1, (index) => context.id(`face${index}`)),
    }
    return [feature]
  },
})

export const surfaceOffsetCommand = defineCommand({
  id: 'surfaceOffset',
  label: 'Offset',
  hint: 'A new surface a set distance away from another.',
  icon: '⧈',
  inputs: [
    { ...BODY, label: 'Surface', prompt: 'Select a surface body' },
    { id: 'distance', kind: 'length', label: 'Offset Distance', default: 2 },
  ],
  validate(values) {
    if (!values.distance) return { distance: 'This cannot be zero.' }
    return kindProblem(values.body, 'body', 'brep')
  },
  build(values, context) {
    const source = bodyIdsOf(values.body)[0]
    const editing = context.editing?.kind === 'surfaceOffset' ? context.editing : null
    const feature: SurfaceOffsetFeature = {
      id: editing?.id ?? context.id('surfaceOffset'),
      kind: 'surfaceOffset',
      name: editing?.name ?? 'Offset Surface',
      componentId: componentOfBody(context.doc, source, context.componentId),
      sourceBodyId: source,
      distance: values.distance,
      bodyId: editing?.bodyId ?? context.id('offset'),
    }
    return [feature]
  },
})

export const reverseNormalCommand = defineCommand({
  id: 'reverseNormal',
  label: 'Reverse Normal',
  hint: 'Turns surfaces inside out.',
  icon: '⇵',
  inputs: [{ ...BODIES, label: 'Surfaces', prompt: 'Select surface bodies' }],
  validate(values) {
    return kindProblem(values.bodies, 'bodies', 'surface')
  },
  build(values, context) {
    const bodyIds = [...new Set(bodyIdsOf(values.bodies))]
    const editing = context.editing?.kind === 'reverseNormal' ? context.editing : null
    const feature: ReverseNormalFeature = {
      id: editing?.id ?? context.id('reverseNormal'),
      kind: 'reverseNormal',
      name: editing?.name ?? 'Reverse Normal',
      componentId: componentOfBody(context.doc, bodyIds[0], context.componentId),
      bodyIds,
    }
    return [feature]
  },
})

export const extrudeSurfaceCommand = surfaceVariant(
  extrudeCommand,
  'Extrude Surface',
  'Pulls the curves of a sketch into a thin wall with no thickness.',
)

export const revolveSurfaceCommand = surfaceVariant(
  revolveCommand,
  'Revolve Surface',
  'Spins the curves of a sketch around an axis into a thin shell.',
)

export const loftSurfaceCommand = surfaceVariant(
  loftCommand,
  'Loft Surface',
  'Blends one outline into the next as a skin with no thickness.',
)

export const sweepSurfaceCommand = surfaceVariant(
  sweepCommand,
  'Sweep Surface',
  'Carries an outline along a path as a skin with no thickness.',
)
