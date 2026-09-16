import { findBody, findFeature } from '../../../doc/model'
import type { BodyOperation, OkcDocument, PlaneRef, SketchFeature } from '../../../doc/types'
import { sketchLoopSummary } from '../../../kernel/profile'
import { bodyPick, planePick } from '../picks'
import type { CommandContext, LooseCommandValues, SelectionPick } from '../types'

export const OPERATIONS = [
  { value: 'newBody', label: 'New Body', hint: 'The result becomes a body of its own.' },
  { value: 'join', label: 'Join', hint: 'Adds material to the body you pick.' },
  { value: 'cut', label: 'Cut', hint: 'Removes material from the bodies you pick.' },
  {
    value: 'intersect',
    label: 'Intersect',
    hint: 'Keeps only the part the new shape shares with the bodies you pick.',
  },
] as const

export type OperationValue = (typeof OPERATIONS)[number]['value']

export const XY_PLANE: PlaneRef = { kind: 'named', name: 'XY', offset: 0 }

export function bodyIdsOf(picks: readonly SelectionPick[]): string[] {
  return picks.map((pick) => pick.bodyId ?? pick.id)
}

export function resultOf(
  operation: OperationValue,
  bodies: readonly SelectionPick[],
  context: CommandContext,
): BodyOperation {
  const ids = bodyIdsOf(bodies)
  if (operation === 'newBody') return { kind: 'newBody', bodyId: context.id('body') }
  if (operation === 'join') return { kind: 'join', bodyId: ids[0] }
  return { kind: operation, bodyIds: ids }
}

export function operationValues(doc: OkcDocument, result: BodyOperation) {
  const ids =
    result.kind === 'newBody' ? [] : result.kind === 'join' ? [result.bodyId] : result.bodyIds
  return {
    operation: result.kind,
    bodies: ids.flatMap((id) => bodyPick(doc, id) ?? []),
  }
}

export function resultIds(result: BodyOperation): Record<string, string> {
  return result.kind === 'newBody' ? { body: result.bodyId } : {}
}

export function operationProblem(values: LooseCommandValues): Record<string, string> | null {
  const bodies = values.bodies as readonly SelectionPick[]
  if (values.operation === 'join' && bodies.length > 1) {
    return { bodies: 'Join adds to one body. Pick just one.' }
  }
  return null
}

export function sketchOf(doc: OkcDocument, picks: readonly SelectionPick[]): SketchFeature | null {
  const feature = picks[0] ? findFeature(doc, picks[0].id) : undefined
  return feature?.kind === 'sketch' ? feature : null
}

export function profileProblem(
  doc: OkcDocument,
  picks: readonly SelectionPick[],
): Record<string, string> | null {
  const sketch = sketchOf(doc, picks)
  if (!sketch) return { profile: 'Pick a sketch.' }
  if (!sketchLoopSummary(sketch.sketch).closedLoops) {
    return { profile: 'That sketch has no closed shape yet.' }
  }
  return null
}

export function planeOf(picks: readonly SelectionPick[]): PlaneRef {
  const pick = picks[0]
  if (pick?.face) return { kind: 'face', face: pick.face, offset: 0 }
  return pick?.plane ?? XY_PLANE
}

export function planeValues(doc: OkcDocument, plane: PlaneRef): SelectionPick[] {
  const pick = planePick(doc, plane)
  return pick ? [pick] : []
}

export function singleBody(
  doc: OkcDocument,
  picks: readonly SelectionPick[],
  input: string,
): Record<string, string> | null {
  const bodies = new Set(bodyIdsOf(picks))
  if (bodies.size > 1) return { [input]: 'Everything picked has to be on the same body.' }
  const [bodyId] = bodies
  if (bodyId && !findBody(doc, bodyId)) return { [input]: 'That body no longer exists.' }
  return null
}

export function componentOfBody(doc: OkcDocument, bodyId: string, fallback: string): string {
  return findBody(doc, bodyId)?.component.id ?? fallback
}

export function placementComponent(
  context: CommandContext,
  picks: readonly SelectionPick[],
): string {
  const face = picks[0]?.face
  if (context.editing) return context.editing.componentId
  return face ? componentOfBody(context.doc, face.bodyId, context.componentId) : context.componentId
}
