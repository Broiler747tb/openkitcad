import type { OkcDocument } from './types'
import { useStore } from './store'
import { adoptCustomParts, adoptionNote, lastAdoptedParts } from './persist'
import { useCommand } from '../ui/command/session'
import { ask } from '../ui/Confirm'

/** Open only after the user has had a chance to keep their current work. */
export async function replaceDesign(
  doc: OkcDocument,
  confirmReplacement: () => boolean | Promise<boolean> = () =>
    ask({
      title: `Open ${doc.name}?`,
      message: 'It replaces the design you are working on. Save that one first to keep it.',
      confirm: 'Open',
      danger: true,
    }),
): Promise<boolean> {
  const store = useStore.getState()
  const working = store.doc.timeline.length > 0 || store.doc.occurrences.length > 0
  if (working && !(await confirmReplacement())) return false
  adoptCustomParts(doc)
  const note = adoptionNote()
  if (lastAdoptedParts().unsaved.length) throw new Error(note ?? 'Could not save custom parts.')
  useCommand.getState().cancel()
  store.setDoc(doc)
  if (note) store.setStatus(note)
  return true
}
