import { frameToWorld, v3 } from '../../../core/math'
import type { ExtrudeFeature, RevolveFeature } from '../../../doc/types'
import {
  defineCommand,
  type CommandHandle,
  type LooseCommandValues,
  type SelectionPick,
} from '../types'
import {
  autoCut,
  mergeProfilePicks,
  OPERATIONS,
  operationProblem,
  planeOf,
  profileCentre,
  profileKeys,
  profileProblem,
  resultOf,
  sketchFrame,
  sketchOf,
  targetOf,
} from './shared'

export const SURFACE_INPUT = {
  id: 'surface',
  kind: 'toggle',
  label: 'Surface',
  visible: () => false,
} as const

export const OPERATION_INPUTS = [
  {
    id: 'operation',
    kind: 'choice',
    label: 'Operation',
    options: OPERATIONS,
    default: 'newBody',
    visible: (values: LooseCommandValues) => values.surface !== true,
  },
  {
    id: 'bodies',
    kind: 'selection',
    label: 'Objects',
    hint: 'The bodies this joins to, cuts or intersects.',
    filter: ['body'],
    min: 1,
    prompt: 'Select bodies',
    visible: (values: LooseCommandValues) =>
      values.surface !== true && values.operation !== 'newBody',
  },
] as const

const PROFILE_INPUT = {
  id: 'profile',
  kind: 'selection',
  label: 'Profile',
  hint: 'Click the closed areas of a sketch to use. Picking a sketch in the Browser takes all of them.',
  filter: ['profile', 'sketch'],
  min: 1,
  prompt: 'Select profiles',
  merge: mergeProfilePicks,
} as const

const EXTENTS = [
  { value: 'distance', label: 'Distance', hint: 'A set distance.' },
  { value: 'to', label: 'To Object', hint: 'Up to a face, a plane or a body.' },
  { value: 'all', label: 'All', hint: 'Through everything in the way.' },
] as const

const DIRECTIONS = [
  { value: 'one', label: 'One Side', hint: 'Grows away from the sketch plane.' },
  { value: 'two', label: 'Two Sides', hint: 'Grows both ways, each side set on its own.' },
  { value: 'symmetric', label: 'Symmetric', hint: 'Grows the same distance both ways.' },
] as const

const solidOnly = (values: LooseCommandValues) => values.surface !== true
const twoSides = (values: LooseCommandValues) => values.direction === 'two'

export const extrudeCommand = defineCommand({
  id: 'extrude',
  label: 'Extrude',
  hint: 'Give a closed sketch depth, to make a solid or cut one.',
  icon: '⇧',
  inputs: [
    PROFILE_INPUT,
    {
      id: 'start',
      kind: 'choice',
      label: 'Start',
      options: [
        { value: 'profile', label: 'Profile Plane', hint: 'Starts on the sketch.' },
        { value: 'offset', label: 'Offset', hint: 'Starts a set distance off the sketch.' },
        {
          value: 'object',
          label: 'Object',
          hint: 'Starts on a face or plane parallel to the sketch.',
        },
      ],
      default: 'profile',
      visible: solidOnly,
    },
    {
      id: 'startOffset',
      kind: 'length',
      label: 'Offset',
      hint: 'How far off the sketch plane it starts.',
      default: 0,
      field: 'startOffset',
      visible: (values) => values.surface !== true && values.start === 'offset',
    },
    {
      id: 'startObject',
      kind: 'selection',
      label: 'Start Object',
      hint: 'A flat face or a plane parallel to the sketch.',
      filter: ['face', 'plane'],
      min: 1,
      max: 1,
      prompt: 'Select a face or plane',
      visible: (values) => values.surface !== true && values.start === 'object',
    },
    { id: 'direction', kind: 'choice', label: 'Direction', options: DIRECTIONS, default: 'one' },
    {
      id: 'measure',
      kind: 'choice',
      label: 'Measurement',
      options: [
        { value: 'whole', label: 'Whole Length', hint: 'The distance is the whole length.' },
        { value: 'half', label: 'Half Length', hint: 'The distance goes each way.' },
      ],
      default: 'whole',
      visible: (values) => values.direction === 'symmetric',
    },
    {
      id: 'extent',
      kind: 'choice',
      label: 'Extent Type',
      options: EXTENTS,
      default: 'distance',
      visible: solidOnly,
    },
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance',
      hint: 'How far the profile is pushed. A negative distance goes the other way, and into a body it cuts.',
      default: 10,
      field: 'distance',
      visible: (values) => values.surface === true || values.extent === 'distance',
    },
    {
      id: 'object',
      kind: 'selection',
      label: 'Object',
      hint: 'The face, plane or body the extrusion stops at.',
      filter: ['face', 'plane', 'body'],
      min: 1,
      max: 1,
      prompt: 'Select a face, plane or body',
      visible: (values) => values.surface !== true && values.extent === 'to',
    },
    {
      id: 'flip',
      kind: 'toggle',
      label: 'Flip',
      hint: 'Extrude to the other side of the sketch plane.',
      visible: (values) => values.direction !== 'symmetric',
    },
    {
      id: 'taper',
      kind: 'angle',
      label: 'Taper Angle',
      hint: 'Tilts the sides. A positive angle opens out, a negative one closes in.',
      default: 0,
      min: -89,
      max: 89,
      field: 'draftAngle',
      visible: solidOnly,
    },
    {
      id: 'extentTwo',
      kind: 'choice',
      label: 'Side 2 Extent',
      options: EXTENTS,
      default: 'distance',
      visible: (values) => values.surface !== true && twoSides(values),
    },
    {
      id: 'distanceTwo',
      kind: 'length',
      label: 'Side 2 Distance',
      default: 5,
      field: 'secondDistance',
      visible: (values) =>
        twoSides(values) && (values.surface === true || values.extentTwo === 'distance'),
    },
    {
      id: 'objectTwo',
      kind: 'selection',
      label: 'Side 2 Object',
      hint: 'The face, plane or body the second side stops at.',
      filter: ['face', 'plane', 'body'],
      min: 1,
      max: 1,
      prompt: 'Select a face, plane or body',
      visible: (values) => values.surface !== true && twoSides(values) && values.extentTwo === 'to',
    },
    {
      id: 'taperTwo',
      kind: 'angle',
      label: 'Side 2 Taper',
      default: 0,
      min: -89,
      max: 89,
      field: 'secondDraftAngle',
      visible: (values) => values.surface !== true && twoSides(values),
    },
    SURFACE_INPUT,
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    const measured = values.surface || values.extent === 'distance'
    if (measured && !values.distance) return { distance: 'The distance cannot be zero.' }
    if (twoSides(values) && (values.surface || values.extentTwo === 'distance')) {
      if (!values.distanceTwo) return { distanceTwo: 'The distance cannot be zero.' }
    }
    if (values.surface)
      return sketchOf(context.doc, values.profile) ? null : { profile: 'Pick a sketch.' }
    if (values.direction === 'symmetric' && values.extent === 'to') {
      return { extent: 'A symmetric extrude goes a distance, or through all.' }
    }
    return profileProblem(context.doc, values.profile) ?? operationProblem(values)
  },
  derive(values, changed, context) {
    if (changed !== 'distance' && changed !== 'flip') return null
    if (values.surface || values.direction !== 'one' || values.extent !== 'distance') return null
    if (!values.distance) return null
    const sketch = sketchOf(context.doc, values.profile)
    if (sketch?.plane.kind !== 'face') return null
    return autoCut(
      context.doc,
      sketch.plane.face.bodyId,
      values.distance < 0 !== values.flip,
      values,
    )
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const direction = {
      symmetric: values.direction === 'symmetric',
      reverse: values.direction !== 'symmetric' && values.flip,
      ...(values.direction === 'symmetric' && values.measure === 'half'
        ? { halfLength: true }
        : {}),
    }
    if (values.surface) {
      const surface: ExtrudeFeature = {
        id: context.editing?.id ?? context.id('extrude'),
        kind: 'extrude',
        name: context.editing?.name ?? 'Extrude Surface',
        componentId: sketch.componentId,
        sketchId: sketch.id,
        distance: values.distance,
        ...direction,
        ...(twoSides(values) ? { twoSided: true, secondDistance: values.distanceTwo } : {}),
        surface: true,
        result: { kind: 'newBody', bodyId: context.id('body') },
      }
      return [surface]
    }
    const to = values.extent === 'to' ? targetOf(values.object) : undefined
    const secondTo =
      twoSides(values) && values.extentTwo === 'to' ? targetOf(values.objectTwo) : undefined
    const feature: ExtrudeFeature = {
      id: context.editing?.id ?? context.id('extrude'),
      kind: 'extrude',
      name: context.editing?.name ?? 'Extrude',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(profileKeys(values.profile) ? { profiles: profileKeys(values.profile) } : {}),
      distance: values.distance,
      ...direction,
      ...(values.extent !== 'distance' ? { extent: values.extent } : {}),
      ...(to ? { to } : {}),
      ...(values.taper ? { draftAngle: values.taper } : {}),
      ...(twoSides(values)
        ? {
            twoSided: true,
            secondDistance: values.distanceTwo,
            ...(values.extentTwo !== 'distance' ? { secondExtent: values.extentTwo } : {}),
            ...(secondTo ? { secondTo } : {}),
            ...(values.taperTwo ? { secondDraftAngle: values.taperTwo } : {}),
          }
        : {}),
      ...(values.start === 'offset' ? { start: 'offset', startOffset: values.startOffset } : {}),
      ...(values.start === 'object'
        ? { start: 'object', startPlane: planeOf(values.startObject) }
        : {}),
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const sketch = sketchOf(context.doc, values.profile)
    const frame = sketch && sketchFrame(sketch)
    if (!sketch || !frame) return []
    const symmetric = values.direction === 'symmetric'
    const along = !symmetric && values.flip ? v3.scale(frame.normal, -1) : frame.normal
    const shift = values.surface !== true && values.start === 'offset' ? values.startOffset : 0
    const point = v3.add(
      frameToWorld(frame, profileCentre(sketch, profileKeys(values.profile))),
      v3.scale(frame.normal, shift),
    )
    const handles: CommandHandle[] = []
    if (values.surface || values.extent === 'distance') {
      handles.push({
        kind: 'arrow',
        input: 'distance',
        componentId: sketch.componentId,
        anchor: { point, direction: along },
        scale: symmetric && values.measure !== 'half' ? 0.5 : 1,
      })
    }
    if (twoSides(values) && (values.surface || values.extentTwo === 'distance')) {
      handles.push({
        kind: 'arrow',
        input: 'distanceTwo',
        componentId: sketch.componentId,
        anchor: { point, direction: v3.scale(along, -1) },
      })
    }
    return handles
  },
})

export const revolveCommand = defineCommand({
  id: 'revolve',
  label: 'Revolve',
  hint: 'Spin a closed sketch around a line drawn in it, or around one of its axes.',
  icon: '⟳',
  inputs: [
    PROFILE_INPUT,
    {
      id: 'axisLine',
      kind: 'selection',
      label: 'Axis',
      hint: 'A straight line in the same sketch to spin around. Leave it empty to use a sketch axis.',
      filter: ['sketchCurve'],
      min: 0,
      max: 1,
      prompt: 'Sketch axis below',
    },
    {
      id: 'axis',
      kind: 'choice',
      label: 'Sketch Axis',
      options: [
        { value: 'x', label: 'Sketch X Axis', hint: 'The horizontal axis through the origin.' },
        { value: 'y', label: 'Sketch Y Axis', hint: 'The vertical axis through the origin.' },
      ],
      default: 'x',
      visible: (values: LooseCommandValues) => !(values.axisLine as SelectionPick[]).length,
    },
    { id: 'direction', kind: 'choice', label: 'Direction', options: DIRECTIONS, default: 'one' },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Angle',
      hint: 'How far round it goes. 360 makes a full turn.',
      default: 360,
      min: 0,
      max: 360,
      exclusiveMin: true,
      field: 'angle',
    },
    {
      id: 'angleTwo',
      kind: 'angle',
      label: 'Side 2 Angle',
      default: 90,
      min: 0,
      max: 360,
      field: 'secondAngle',
      visible: twoSides,
    },
    {
      id: 'flip',
      kind: 'toggle',
      label: 'Flip',
      hint: 'Spin the other way round.',
      visible: (values) => values.direction === 'one',
    },
    SURFACE_INPUT,
    ...OPERATION_INPUTS,
  ],
  validate(values, context) {
    const line = values.axisLine[0]?.curve
    const sketch = sketchOf(context.doc, values.profile)
    if (line && sketch) {
      const entity = sketch.sketch.entities.find((candidate) => candidate.id === line.entityId)
      if (line.sketchId !== sketch.id) {
        return { axisLine: 'Pick a line in the same sketch as the profile.' }
      }
      if (entity?.kind !== 'line') return { axisLine: 'Pick a straight line.' }
    }
    if (values.surface) return sketch ? null : { profile: 'Pick a sketch.' }
    return profileProblem(context.doc, values.profile) ?? operationProblem(values)
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const axisLine = values.axisLine[0]?.curve?.entityId
    const sweep = {
      ...(values.direction === 'symmetric' ? { symmetric: true } : {}),
      ...(values.direction === 'two' ? { twoSided: true, secondAngle: values.angleTwo } : {}),
      ...(values.direction === 'one' && values.flip ? { reverse: true } : {}),
    }
    if (values.surface) {
      const surface: RevolveFeature = {
        id: context.editing?.id ?? context.id('revolve'),
        kind: 'revolve',
        name: context.editing?.name ?? 'Revolve Surface',
        componentId: sketch.componentId,
        sketchId: sketch.id,
        angle: values.angle,
        axis: values.axis,
        ...(axisLine ? { axisLine } : {}),
        ...sweep,
        surface: true,
        result: { kind: 'newBody', bodyId: context.id('body') },
      }
      return [surface]
    }
    const feature: RevolveFeature = {
      id: context.editing?.id ?? context.id('revolve'),
      kind: 'revolve',
      name: context.editing?.name ?? 'Revolve',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      ...(profileKeys(values.profile) ? { profiles: profileKeys(values.profile) } : {}),
      angle: values.angle,
      axis: values.axis,
      ...(axisLine ? { axisLine } : {}),
      ...sweep,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
  handles(values, context) {
    const sketch = sketchOf(context.doc, values.profile)
    const frame = sketch && sketchFrame(sketch)
    if (!sketch || !frame) return []
    const [u, v] = profileCentre(sketch, profileKeys(values.profile))
    const line = sketch.sketch.entities.find(
      (entity) => entity.id === values.axisLine[0]?.curve?.entityId,
    )
    if (line?.kind === 'line') {
      const p1 = sketch.sketch.points.find((point) => point.id === line.p1)
      const p2 = sketch.sketch.points.find((point) => point.id === line.p2)
      if (p1 && p2 && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-9) {
        const a = frameToWorld(frame, [p1.x, p1.y])
        const direction = v3.norm(v3.sub(frameToWorld(frame, [p2.x, p2.y]), a))
        const centre = frameToWorld(frame, [u, v])
        const foot = v3.add(a, v3.scale(direction, v3.dot(v3.sub(centre, a), direction)))
        const radial = v3.sub(centre, foot)
        const radius = v3.len(radial)
        return [
          {
            kind: 'arc',
            input: 'angle',
            componentId: sketch.componentId,
            centre: foot,
            axis: direction,
            start: radius > 1e-9 ? v3.scale(radial, 1 / radius) : frame.normal,
            radius: radius || 10,
          },
        ]
      }
    }
    const alongX = values.axis === 'x'
    const offset = alongX ? v : u
    const radial = alongX ? frame.yDir : frame.xDir
    return [
      {
        kind: 'arc',
        input: 'angle',
        componentId: sketch.componentId,
        centre: frameToWorld(frame, alongX ? [u, 0] : [0, v]),
        axis: alongX ? frame.xDir : frame.yDir,
        start: v3.scale(radial, offset < 0 ? -1 : 1),
        radius: Math.abs(offset) || 10,
      },
    ]
  },
})
