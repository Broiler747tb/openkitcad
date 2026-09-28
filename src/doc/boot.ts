import { kernel } from '../kernel/api'
import {
  adoptCustomParts,
  adoptionNote,
  discardOldAutosave,
  loadAutosave,
  readShareLink,
  restoreAutosave,
  setAsideAutosave,
  tidyMeshStore,
} from './persist'
import { useStore } from './store'
import type { OkcDocument } from './types'

let booting: Promise<void> | null = null

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasWork(doc: OkcDocument | undefined): boolean {
  return !!doc && (doc.timeline.length > 0 || doc.occurrences.length > 0)
}

export function bootOnce(): Promise<void> {
  booting ??= boot()
  return booting
}

async function boot(): Promise<void> {
  discardOldAutosave()
  try {
    await kernel().ready()
  } catch (error) {
    useStore.getState().setKernelError(reason(error))
    return
  }
  useStore.getState().setKernelReady(true)
  const notes = await restoreDesign(location.hash)
  if (/[#&]d=/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search)
  }
  useStore.getState().setAutosaving(true)
  if (notes.length) useStore.getState().setStatus(notes.join(' '))
  void tidyMeshStore(useStore.getState().doc)
}

export async function restoreDesign(
  hash: string,
  replaceWork: () => boolean = () =>
    confirm(
      'Open the shared design? It replaces the design you were working on. Save that one first to keep it.',
    ),
): Promise<string[]> {
  const notes: string[] = []
  let shared: OkcDocument | null = null
  try {
    shared = readShareLink(hash)
  } catch (error) {
    notes.push(reason(error))
  }
  if (shared && (!hasWork(loadAutosave()?.doc) || replaceWork())) {
    try {
      const note = adoptionNote(adoptCustomParts(shared))
      useStore.getState().setDoc(shared)
      if (note) notes.push(note)
      return notes
    } catch (error) {
      notes.push(`That link could not be opened: ${reason(error)}`)
    }
  }
  const saved = await restoreAutosave()
  if (!saved || !hasWork(saved.doc)) return notes
  try {
    useStore.getState().setDoc(saved.doc)
  } catch (error) {
    setAsideAutosave()
    notes.push(
      `The design saved in this browser could not be opened (${reason(error)}), so it was kept aside and a new one was started.`,
    )
  }
  return notes
}
