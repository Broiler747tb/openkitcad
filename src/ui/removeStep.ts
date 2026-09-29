import { useStore } from '../doc/store'
import type { Feature } from '../doc/types'
import { ask } from './Confirm'

export async function removeStep(feature: Feature) {
  if (useStore.getState().removeFeature(feature.id)) return
  const confirmed = await ask({
    title: `Delete ${feature.name} and the steps that depend on it?`,
    message: 'Undo brings them back.',
    confirm: 'Delete',
    danger: true,
  })
  if (confirmed) useStore.getState().removeFeature(feature.id, { withDependents: true })
}
