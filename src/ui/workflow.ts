import { newId, useStore } from '../doc/store'
import { objectActions, type ObjectAction } from './ObjectMenu'
import { sketchLoopSummary } from '../kernel/profile'

export function selectedObjectActions() {
  const state = useStore.getState()
  const selection = state.selection.kind === 'feature' && state.selection.bodyId
    ? { kind: 'body' as const, id: state.selection.bodyId } : state.selection
  const face = state.subSelection.find((p) => p.kind === 'face' && p.bodyId === selection.id && p.normal)
  return objectActions(selection, face?.normal ? { bodyId: face.bodyId, point: face.point, normal: face.normal } : null)
}

/** A closed sketch can become a solid both during editing and after Finish sketch. */
export function extrusionAction(revolve = false): ObjectAction | null {
  const state = useStore.getState()
  const active = state.activeSketch ?? (state.selection.kind === 'feature'
    ? { bodyId: state.selection.bodyId!, featureId: state.selection.id! } : null)
  const body = state.doc.bodies.find((b) => b.id === active?.bodyId)
  const feature = body?.features.find((f) => f.id === active?.featureId)
  if (!body || feature?.kind !== 'sketch' || !sketchLoopSummary(feature.sketch).closedLoops) return null
  const hasSolid = body.features.some((f) => f.kind !== 'sketch')
  return {
    id: revolve ? 'create-revolve' : 'create-extrude',
    label: revolve ? 'Revolve sketch' : 'Extrude sketch',
    group: 'Make a solid',
    hint: revolve ? 'Spin the profile around its horizontal sketch axis.' : 'Give the closed outline a precise thickness.',
    prompt: { label: revolve ? 'Angle' : 'Thickness', initial: revolve ? 360 : 3, unit: revolve ? '°' : 'mm', min: 0.01, max: revolve ? 360 : undefined },
    choice: { label: 'Result', initial: hasSolid ? 'add' : 'new', options: hasSolid
      ? [{ value: 'add', label: 'Add material' }, { value: 'cut', label: 'Cut material' }]
      : [{ value: 'new', label: 'New solid' }] },
    run: (value, _b, _c, choice) => {
      const store = useStore.getState()
      const operation = choice === 'cut' ? 'cut' : hasSolid ? 'add' : 'new'
      const id = newId(revolve ? 'revolve' : 'extrude')
      if (revolve) store.addFeature(body.id, { id, kind: 'revolve', name: 'Revolve', sketchId: feature.id, angle: value, axis: 'x', operation })
      else store.addFeature(body.id, { id, kind: 'extrude', name: 'Extrude', sketchId: feature.id, distance: value, symmetric: false, reverse: false, operation })
      store.closeSketch()
      store.select({ kind: 'feature', bodyId: body.id, id })
      window.dispatchEvent(new CustomEvent('okc:fit'))
    },
  }
}
