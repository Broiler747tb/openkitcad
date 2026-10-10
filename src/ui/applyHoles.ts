import { kernel } from '../kernel/api'
import { insertFeatures, newId, useStore } from '../doc/store'
import type { BakedBodyFeature, OkcDocument } from '../doc/types'
import { useCommand } from './command/session'

let applying = false

export async function applyAllHoles() {
  const state = useStore.getState()
  if (applying) return
  if (state.building || state.activeSketch || useCommand.getState().session) {
    state.setStatus('Finish the current action and wait for the model to build first.')
    return
  }
  if (state.doc.marker !== null && state.doc.marker < state.doc.timeline.length) {
    state.setStatus('Move the timeline to the end before applying holes.')
    return
  }
  if (state.errors.some((error) => error.severity === 'error')) {
    state.setStatus('Fix the build errors before applying holes.')
    return
  }
  applying = true
  state.setStatus('Applying holes…')
  try {
    const entries = await kernel().bakeHoles()
    if (useStore.getState().doc !== state.doc)
      throw new Error('The model changed. Apply holes again.')
    const affected = new Set(entries.map((entry) => entry.bodyId))
    const keptBodies = new Set(entries.filter((entry) => !entry.shape).map((entry) => entry.bodyId))
    const features: BakedBodyFeature[] = entries.map((entry) => ({
      id: newId('baked'),
      name: 'Applied holes',
      kind: 'bakedBody',
      componentId: entry.shape ? state.doc.rootComponentId : entry.componentId,
      bodyId: entry.shape ? newId('body') : entry.bodyId,
      shape: entry.shape,
      cutters: entry.cutters,
    }))
    const groupId = newId('group')
    const apply = (doc: OkcDocument) => {
      for (const component of doc.components) {
        component.bodies = component.bodies.filter(
          (body) => !body.negative && (!affected.has(body.id) || keptBodies.has(body.id)),
        )
      }
      doc.occurrences = doc.occurrences.filter((occurrence) => !occurrence.negative)
      insertFeatures(
        doc,
        features,
        Object.fromEntries(
          features.map((feature, i) => [
            feature.bodyId,
            { name: entries[i].name, colour: entries[i].colour, visible: entries[i].visible },
          ]),
        ),
      )
      if (features.length > 1)
        doc.groups.push({
          id: groupId,
          name: 'Applied holes',
          firstId: features[0].id,
          lastId: features.at(-1)!.id,
          collapsed: true,
        })
    }
    const trial = structuredClone(state.doc)
    apply(trial)
    const result = await kernel().preview(
      { doc: trial, features: [], insertAt: trial.timeline.length },
      [...state.meshes.keys()],
    )
    if (result.errors.some((error) => error.severity === 'error'))
      throw new Error('The permanent cut failed. The original hole objects were kept.')
    if (useStore.getState().doc !== state.doc)
      throw new Error('The model changed. Apply holes again.')
    state.commit(apply)
    useStore.getState().select({ kind: 'none' })
    useStore.getState().setStatus('All holes applied. Undo restores the hole objects.')
  } catch (error) {
    useStore.getState().setStatus(error instanceof Error ? error.message : String(error))
  } finally {
    applying = false
  }
}
