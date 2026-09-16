import { makeFrame, NAMED_FRAMES, v3, type Frame, type Vec2 } from '../../../core/math'
import { findBody, findFeature } from '../../../doc/model'
import { frameFromPlaneRefLocal } from '../../../doc/planes'
import { useStore } from '../../../doc/store'
import type { BodyOperation, OkcDocument, PlaneRef, SketchFeature } from '../../../doc/types'
import { sketchLoopSummary } from '../../../kernel/profile'
import { entityPointIds } from '../../../sketch/curves'
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

export function sketchFrame(sketch: SketchFeature): Frame | null {
  return frameFromPlaneRefLocal(sketch.plane, useStore.getState().planes.get(sketch.id))
}

export function profileCentre(sketch: SketchFeature): Vec2 {
  const used = new Set(
    sketch.sketch.entities
      .filter((entity) => !entity.construction)
      .flatMap((entity) => entityPointIds(entity)),
  )
  const points = sketch.sketch.points.filter((point) => used.has(point.id))
  if (!points.length) return [0, 0]
  return [
    points.reduce((sum, point) => sum + point.x, 0) / points.length,
    points.reduce((sum, point) => sum + point.y, 0) / points.length,
  ]
}

export function pickedFrame(picks: readonly SelectionPick[], featureId?: string): Frame | null {
  const pick = picks[0]
  if (!pick) return NAMED_FRAMES.XY
  if (pick.face) {
    if (pick.point && pick.normal) {
      const normal = v3.norm(pick.normal)
      return makeFrame(v3.scale(normal, v3.dot(pick.point, normal)), normal)
    }
    return featureId ? (useStore.getState().planes.get(featureId) ?? null) : null
  }
  return pick.plane ? frameFromPlaneRefLocal(pick.plane, undefined) : NAMED_FRAMES.XY
}
