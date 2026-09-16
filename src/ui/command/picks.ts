import { findBody, findFeature } from '../../doc/model'
import type { Vec3 } from '../../core/math'
import { planeLabel } from '../../doc/planes'
import type { ElementRef, OkcDocument, PlaneRef } from '../../doc/types'
import { visibleSelections } from './state'
import { useCommand } from './session'
import type { SelectionPick } from './types'

export function sketchPick(doc: OkcDocument, sketchId: string): SelectionPick | null {
  const sketch = findFeature(doc, sketchId)
  if (sketch?.kind !== 'sketch') return null
  return { kind: 'sketch', id: sketch.id, label: sketch.name || 'Sketch' }
}

export function profilePick(doc: OkcDocument, sketchId: string, key: string): SelectionPick | null {
  const sketch = findFeature(doc, sketchId)
  if (sketch?.kind !== 'sketch') return null
  return {
    kind: 'profile',
    id: `${sketchId}|${key}`,
    label: `Profile in ${sketch.name || 'Sketch'}`,
    profile: { sketchId, key },
  }
}

export function pickSketchId(pick: SelectionPick): string {
  return pick.profile?.sketchId ?? pick.id
}

export function bodyPick(
  doc: OkcDocument,
  bodyId: string,
  instanceId?: string,
): SelectionPick | null {
  const found = findBody(doc, bodyId)
  if (!found) return null
  return { kind: 'body', id: bodyId, bodyId, instanceId, label: found.body.name }
}

export function elementPick(
  doc: OkcDocument,
  ref: ElementRef,
  instanceId?: string,
  at?: { point: Vec3; normal: Vec3 },
): SelectionPick | null {
  if (ref.kind === 'vertex' || !ref.name) return null
  const body = findBody(doc, ref.bodyId)?.body.name ?? 'body'
  return {
    kind: ref.kind,
    id: `${ref.bodyId}|${ref.name}`,
    bodyId: ref.bodyId,
    instanceId,
    name: ref.name,
    label: `${ref.kind === 'face' ? 'Face' : 'Edge'} of ${body}`,
    ...(ref.kind === 'face' ? { face: ref } : { edge: ref }),
    ...at,
  }
}

export function planePick(doc: OkcDocument, plane: PlaneRef): SelectionPick | null {
  if (plane.kind === 'face') return elementPick(doc, plane.face)
  return {
    kind: 'plane',
    id: JSON.stringify(plane),
    label: planeLabel(plane, doc.units),
    plane,
  }
}

export function offerPick(pick: SelectionPick | null): boolean {
  const session = useCommand.getState().session
  if (!pick || !session) return false
  const selections = visibleSelections(session.spec, session.state, session.context)
  const accepts = (input: (typeof selections)[number]) => input.filter.includes(pick.kind)
  const target =
    selections.find((input) => input.id === session.state.active && accepts(input)) ??
    selections.find((input) => accepts(input))
  if (!target) return false
  useCommand.getState().dispatch({ type: 'pick', pick, id: target.id })
  return true
}

export function acceptedKinds(): ReadonlySet<SelectionPick['kind']> {
  const session = useCommand.getState().session
  if (!session) return new Set()
  return new Set(
    visibleSelections(session.spec, session.state, session.context).flatMap(
      (input) => input.filter,
    ),
  )
}

export function commandPicks(): SelectionPick[] {
  const session = useCommand.getState().session
  if (!session) return []
  return Object.values(session.state.fields).flatMap((field) =>
    field.kind === 'selection' ? field.picks : [],
  )
}
