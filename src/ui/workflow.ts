import { newId, selectedBodyId, sketchTargetBody, useStore } from '../doc/store'
import { objectActions, type ObjectAction } from './ObjectMenu'
import { sketchLoopSummary } from '../kernel/profile'
import { findComponent, findFeature } from '../doc/model'
import type { BodyOperation, Feature } from '../doc/types'

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
    (p) => p.kind === 'face' && p.bodyId === selection.id && p.normal,
  )
  return objectActions(
    selection,
    face?.normal
      ? { bodyId: face.bodyId, instanceId: face.instanceId, point: face.point, normal: face.normal }
      : null,
  )
}

export function extrusionAction(revolve = false): ObjectAction | null {
  const state = useStore.getState()
  const featureId =
    state.activeSketch?.featureId ??
    (state.selection.kind === 'feature' ? state.selection.id : undefined)
  const feature = featureId ? findFeature(state.doc, featureId) : undefined
  if (feature?.kind !== 'sketch' || !sketchLoopSummary(feature.sketch).closedLoops) return null
  const component = findComponent(state.doc, feature.componentId)
  if (!component) return null
  const target = sketchTargetBody(state.doc, feature)
  const options = [
    { value: 'new', label: 'New Body', hint: 'The profile becomes a body of its own.' },
    ...component.bodies.flatMap((body) => [
      { value: `join:${body.id}`, label: `Join to ${body.name}`, hint: 'Adds material to it.' },
      { value: `cut:${body.id}`, label: `Cut ${body.name}`, hint: 'Removes material from it.' },
    ]),
  ]
  return {
    id: revolve ? 'create-revolve' : 'create-extrude',
    label: revolve ? 'Revolve sketch' : 'Extrude sketch',
    group: 'Make a solid',
    hint: revolve
      ? 'Spin the profile around its horizontal sketch axis.'
      : 'Give the closed outline a precise thickness.',
    prompt: {
      label: revolve ? 'Angle' : 'Thickness',
      initial: revolve ? 360 : 3,
      unit: revolve ? '°' : 'mm',
      min: 0.01,
      max: revolve ? 360 : undefined,
    },
    choice: {
      label: 'Operation',
      initial: target ? `join:${target}` : 'new',
      options,
    },
    run: (value, _b, _c, choice) => {
      const store = useStore.getState()
      const [kind, bodyId] = (choice ?? 'new').split(':')
      const newBodyId = newId('body')
      const result: BodyOperation =
        kind === 'join' && bodyId
          ? { kind: 'join', bodyId }
          : kind === 'cut' && bodyId
            ? { kind: 'cut', bodyIds: [bodyId] }
            : { kind: 'newBody', bodyId: newBodyId }
      const id = newId(revolve ? 'revolve' : 'extrude')
      const base = { id, componentId: feature.componentId, sketchId: feature.id, result }
      const created: Feature = revolve
        ? { ...base, kind: 'revolve', name: 'Revolve', angle: value, axis: 'x' }
        : {
            ...base,
            kind: 'extrude',
            name: 'Extrude',
            distance: value,
            symmetric: false,
            reverse: false,
          }
      store.addFeature(created)
      store.closeSketch()
      store.select({ kind: 'feature', id })
      window.dispatchEvent(new CustomEvent('okc:fit'))
    },
  }
}
