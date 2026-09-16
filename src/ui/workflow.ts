import { selectedBodyId, useStore } from '../doc/store'
import { objectActions, type ObjectAction } from './ObjectMenu'
import { hasProfiles } from './command/specs/shared'
import { findFeature } from '../doc/model'
import { startCommand } from './command/commands'
import { sketchPick } from './command/picks'

export function selectedObjectActions() {
  const state = useStore.getState()
  const bodyId = state.selection.kind === 'feature' ? selectedBodyId(state) : undefined
  const selection =
    state.selection.kind === 'feature'
      ? bodyId
        ? { kind: 'body' as const, id: bodyId }
        : { kind: 'none' as const }
      : state.selection
  const face = state.subSelection.find(
    (p) => p.kind === 'face' && p.bodyId === selection.id && p.normal && p.name,
  )
  return objectActions(
    selection,
    face?.normal
      ? {
          bodyId: face.bodyId,
          instanceId: face.instanceId,
          name: face.name,
          point: face.point,
          normal: face.normal,
        }
      : null,
  )
}

export function extrusionAction(revolve = false): ObjectAction | null {
  const state = useStore.getState()
  const featureId =
    state.activeSketch?.featureId ??
    (state.selection.kind === 'feature' ? state.selection.id : undefined)
  const feature = featureId ? findFeature(state.doc, featureId) : undefined
  if (feature?.kind !== 'sketch' || !hasProfiles(feature)) return null
  return {
    id: revolve ? 'create-revolve' : 'create-extrude',
    label: revolve ? 'Revolve' : 'Extrude',
    group: 'Make a solid',
    hint: revolve
      ? 'Spins the profile around an axis, with a live preview.'
      : 'Gives the profile depth, with a live preview. A negative distance goes the other way and cuts into the body it sits on.',
    run: () => {
      const doc = useStore.getState().doc
      const profile = sketchPick(doc, feature.id)
      startCommand(revolve ? 'revolve' : 'extrude', profile ? { profile: [profile] } : undefined)
    },
  }
}
