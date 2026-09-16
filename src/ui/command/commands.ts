import { findFeature } from '../../doc/model'
import { sketchTargetBody, useStore } from '../../doc/store'
import type {
  BodyOperation,
  ExtrudeFeature,
  Feature,
  OkcDocument,
  SketchFeature,
} from '../../doc/types'
import { sketchLoopSummary } from '../../kernel/profile'
import { bodyPick, sketchPick } from './picks'
import { useCommand, type CommandStart } from './session'
import {
  defineCommand,
  type AnyCommandSpec,
  type CommandContext,
  type SelectionPick,
} from './types'

const OPERATIONS = [
  { value: 'newBody', label: 'New Body', hint: 'The result becomes a body of its own.' },
  { value: 'join', label: 'Join', hint: 'Adds material to the body you pick.' },
  { value: 'cut', label: 'Cut', hint: 'Removes material from the bodies you pick.' },
  {
    value: 'intersect',
    label: 'Intersect',
    hint: 'Keeps only the part the new shape shares with the bodies you pick.',
  },
] as const

type OperationValue = (typeof OPERATIONS)[number]['value']

function pickedBodies(picks: readonly SelectionPick[]): string[] {
  return picks.map((pick) => pick.bodyId ?? pick.id)
}

function resultOf(
  operation: OperationValue,
  bodies: readonly SelectionPick[],
  context: CommandContext,
): BodyOperation {
  const ids = pickedBodies(bodies)
  if (operation === 'newBody') return { kind: 'newBody', bodyId: context.id('body') }
  if (operation === 'join') return { kind: 'join', bodyId: ids[0] }
  return { kind: operation, bodyIds: ids }
}

function resultPicks(doc: OkcDocument, result: BodyOperation): SelectionPick[] {
  const ids =
    result.kind === 'newBody' ? [] : result.kind === 'join' ? [result.bodyId] : result.bodyIds
  return ids.flatMap((id) => bodyPick(doc, id) ?? [])
}

function sketchOf(doc: OkcDocument, picks: readonly SelectionPick[]): SketchFeature | null {
  const feature = picks[0] ? findFeature(doc, picks[0].id) : undefined
  return feature?.kind === 'sketch' ? feature : null
}

export const extrudeCommand = defineCommand({
  id: 'extrude',
  label: 'Extrude',
  hint: 'Give a closed sketch depth, to make a solid or cut one.',
  icon: '⇧',
  inputs: [
    {
      id: 'profile',
      kind: 'selection',
      label: 'Profile',
      hint: 'The closed sketch to extrude. Pick it in the Browser or on the timeline.',
      filter: ['sketch'],
      min: 1,
      max: 1,
      prompt: 'Select a sketch',
    },
    {
      id: 'direction',
      kind: 'choice',
      label: 'Direction',
      options: [
        { value: 'one', label: 'One Side', hint: 'Grows away from the sketch plane.' },
        { value: 'symmetric', label: 'Symmetric', hint: 'Grows the same distance both ways.' },
      ],
      default: 'one',
    },
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance',
      hint: 'How far the profile is pushed.',
      default: 10,
      min: 0,
      exclusiveMin: true,
      field: 'distance',
    },
    {
      id: 'flip',
      kind: 'toggle',
      label: 'Flip',
      hint: 'Extrude to the other side of the sketch plane.',
      visible: (values) => values.direction !== 'symmetric',
    },
    {
      id: 'operation',
      kind: 'choice',
      label: 'Operation',
      options: OPERATIONS,
      default: 'newBody',
    },
    {
      id: 'bodies',
      kind: 'selection',
      label: 'Objects',
      hint: 'The bodies this joins to, cuts or intersects.',
      filter: ['body'],
      min: 1,
      prompt: 'Select bodies',
      visible: (values) => values.operation !== 'newBody',
    },
  ],
  validate(values, context) {
    const sketch = sketchOf(context.doc, values.profile)
    if (!sketch) return { profile: 'Pick a sketch.' }
    if (!sketchLoopSummary(sketch.sketch).closedLoops) {
      return { profile: 'That sketch has no closed shape to extrude yet.' }
    }
    if (values.operation === 'join' && values.bodies.length > 1) {
      return { bodies: 'Join adds to one body. Pick just one.' }
    }
    return null
  },
  build(values, context) {
    const sketch = sketchOf(context.doc, values.profile)!
    const feature: ExtrudeFeature = {
      id: context.editing?.id ?? context.id('extrude'),
      kind: 'extrude',
      name: context.editing?.name ?? 'Extrude',
      componentId: sketch.componentId,
      sketchId: sketch.id,
      distance: values.distance,
      symmetric: values.direction === 'symmetric',
      reverse: values.direction !== 'symmetric' && values.flip,
      result: resultOf(values.operation, values.bodies, context),
    }
    return [feature]
  },
})

export const COMMANDS: Readonly<Record<string, AnyCommandSpec>> = {
  extrude: extrudeCommand as unknown as AnyCommandSpec,
}

function selectedSketch(doc: OkcDocument): SketchFeature | null {
  const state = useStore.getState()
  const id =
    state.activeSketch?.featureId ??
    (state.selection.kind === 'feature' ? state.selection.id : undefined)
  const feature = id ? findFeature(doc, id) : undefined
  return feature?.kind === 'sketch' ? feature : null
}

function startOptions(id: string): CommandStart {
  const state = useStore.getState()
  const doc = state.doc
  if (id === 'extrude') {
    const sketch = selectedSketch(doc)
    const target = sketch ? sketchTargetBody(doc, sketch) : undefined
    return {
      initial: {
        profile: sketch ? [sketchPick(doc, sketch.id)!] : [],
        operation: target ? 'join' : 'newBody',
        bodies: target ? [bodyPick(doc, target)!] : [],
      },
    }
  }
  return {}
}

export function startCommand(id: string): boolean {
  const spec = COMMANDS[id]
  if (!spec) return false
  const options = startOptions(id)
  if (useStore.getState().activeSketch) useStore.getState().closeSketch()
  useCommand.getState().start(spec, options)
  return true
}

export function editFeature(feature: Feature): boolean {
  const doc = useStore.getState().doc
  if (feature.kind === 'extrude') {
    const profile = sketchPick(doc, feature.sketchId)
    useCommand.getState().start(COMMANDS.extrude, {
      editing: feature,
      initial: {
        profile: profile ? [profile] : [],
        direction: feature.symmetric ? 'symmetric' : 'one',
        distance: feature.distance,
        flip: feature.reverse,
        operation: feature.result.kind,
        bodies: resultPicks(doc, feature.result),
      },
      ids: feature.result.kind === 'newBody' ? { body: feature.result.bodyId } : {},
    })
    return true
  }
  return false
}
