import { makeFrame, NAMED_FRAMES, v3, type Frame, type Vec2 } from '../../../core/math'
import { findBody, findFeature } from '../../../doc/model'
import { frameFromPlaneRefLocal } from '../../../doc/planes'
import { useStore } from '../../../doc/store'
import type { BodyOperation, OkcDocument, PlaneRef, SketchFeature } from '../../../doc/types'
import { cachedRegions } from '../../../sketch/regions'
import { cachedTextProfiles } from '../../../sketch/text'
import { bodyPick, pickSketchId, planePick, profilePick } from '../picks'
import type { CommandContext, CommandValue, LooseCommandValues, SelectionPick } from '../types'

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

export function autoCut(
  doc: OkcDocument,
  bodyId: string | undefined,
  inward: boolean,
  values: LooseCommandValues,
): Record<string, CommandValue> | null {
  const target = bodyId ? bodyPick(doc, bodyId) : null
  if (!target) return null
  const bodies = values.bodies as readonly SelectionPick[]
  if (inward && (values.operation === 'join' || values.operation === 'newBody')) {
    return { operation: 'cut', bodies: [target] }
  }
  const onTarget = bodyIdsOf(bodies).every((id) => id === bodyId)
  if (!inward && values.operation === 'cut' && bodies.length <= 1 && onTarget) {
    return { operation: 'join', bodies: [target] }
  }
  return null
}

export function sketchOf(doc: OkcDocument, picks: readonly SelectionPick[]): SketchFeature | null {
  const feature = picks[0] ? findFeature(doc, pickSketchId(picks[0])) : undefined
  return feature?.kind === 'sketch' ? feature : null
}

export function profileKeys(picks: readonly SelectionPick[]): string[] | undefined {
  if (!picks.length || picks.some((pick) => !pick.profile)) return undefined
  return picks.map((pick) => pick.profile!.key)
}

export function hasProfiles(sketch: SketchFeature): boolean {
  return (
    cachedRegions(sketch.sketch).regions.some((region) => region.solid) ||
    cachedTextProfiles(sketch.sketch).length > 0
  )
}

export function solidProfileKeys(sketch: SketchFeature): string[] {
  return [
    ...cachedRegions(sketch.sketch)
      .regions.filter((region) => region.solid)
      .map((region) => region.key),
    ...cachedTextProfiles(sketch.sketch).map((text) => text.key),
  ]
}

export function profileProblem(
  doc: OkcDocument,
  picks: readonly SelectionPick[],
): Record<string, string> | null {
  const sketch = sketchOf(doc, picks)
  if (!sketch) return { profile: 'Pick a profile.' }
  if (new Set(picks.map(pickSketchId)).size > 1) {
    return { profile: 'Pick profiles from one sketch.' }
  }
  const keys = profileKeys(picks)
  if (!keys) {
    return hasProfiles(sketch) ? null : { profile: 'That sketch has no closed shape yet.' }
  }
  const known = new Set([
    ...cachedRegions(sketch.sketch).regions.map((region) => region.key),
    ...cachedTextProfiles(sketch.sketch).map((text) => text.key),
  ])
  if (keys.some((key) => !known.has(key))) {
    return { profile: 'A picked profile is gone from the sketch. Pick it again.' }
  }
  return null
}

export function mergeProfilePicks(
  current: readonly SelectionPick[],
  pick: SelectionPick,
): SelectionPick[] | null {
  const sketchId = pickSketchId(pick)
  const own = current.filter((candidate) => pickSketchId(candidate) === sketchId)
  if (pick.kind === 'sketch')
    return own.some((candidate) => candidate.kind === 'sketch') ? [] : [pick]
  if (!pick.profile) return null
  const doc = useStore.getState().doc
  const sketch = findFeature(doc, sketchId)
  let picks = own
  if (own.some((candidate) => candidate.kind === 'sketch') && sketch?.kind === 'sketch') {
    picks = solidProfileKeys(sketch).flatMap((key) => profilePick(doc, sketchId, key) ?? [])
  }
  return picks.some((candidate) => candidate.id === pick.id)
    ? picks.filter((candidate) => candidate.id !== pick.id)
    : [...picks, pick]
}

export function profilePicksOf(
  doc: OkcDocument,
  sketchId: string,
  profiles: readonly string[] | undefined,
): SelectionPick[] {
  if (!profiles) {
    const sketch = findFeature(doc, sketchId)
    return sketch?.kind === 'sketch'
      ? [{ kind: 'sketch', id: sketch.id, label: sketch.name || 'Sketch' }]
      : []
  }
  return profiles.flatMap((key) => profilePick(doc, sketchId, key) ?? [])
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

export function profileCentre(sketch: SketchFeature, keys?: readonly string[]): Vec2 {
  const areas = [
    ...cachedRegions(sketch.sketch)
      .regions.filter((region) => (keys ? keys.includes(region.key) : region.solid))
      .map((region) => ({ at: region.inside, area: Math.abs(region.area) })),
    ...cachedTextProfiles(sketch.sketch)
      .filter((text) => !keys || keys.includes(text.key))
      .map((text) => ({ at: text.centre, area: Math.max(text.area, 1e-9) })),
  ]
  const total = areas.reduce((sum, entry) => sum + entry.area, 0)
  if (!areas.length || total <= 0) return [0, 0]
  return [
    areas.reduce((sum, entry) => sum + entry.at[0] * entry.area, 0) / total,
    areas.reduce((sum, entry) => sum + entry.at[1] * entry.area, 0) / total,
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
  return pick.plane
    ? frameFromPlaneRefLocal(pick.plane, undefined, useStore.getState().planes)
    : NAMED_FRAMES.XY
}
