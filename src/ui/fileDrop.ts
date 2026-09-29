import { adoptCustomParts, adoptionNote, parseDesign } from '../doc/persist'
import { useStore } from '../doc/store'
import { startCommand } from './command/commands'
import { ask } from './Confirm'
import { useCommand } from './command/session'
import { setPendingMeshes } from './command/specs/mesh'
import { readKicadFile } from './KicadImport'
import { readMeshFile } from './meshImport'

export const KICAD_EVENT = 'okc:kicad'

function carriesFiles(event: DragEvent): boolean {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')
}

async function openDesign(file: File): Promise<void> {
  const doc = parseDesign(await file.text())
  const store = useStore.getState()
  const working = store.doc.timeline.length > 0 || store.doc.occurrences.length > 0
  if (
    working &&
    !(await ask({
      title: `Open ${file.name}?`,
      message: 'It replaces the design you are working on. Save that one first to keep it.',
      confirm: 'Open',
    }))
  )
    return
  useCommand.getState().cancel()
  const note = adoptionNote(adoptCustomParts(doc))
  store.setDoc(doc)
  if (note) store.setStatus(note)
}

async function insertMeshes(file: File): Promise<void> {
  const store = useStore.getState()
  store.setBusy(`Reading ${file.name}`)
  try {
    const meshes = readMeshFile(file.name, new Uint8Array(await file.arrayBuffer()))
    if (!meshes.length) throw new Error(`${file.name} has no triangles in it.`)
    setPendingMeshes(meshes)
    startCommand('meshInsert')
  } finally {
    useStore.getState().setBusy(null)
  }
}

export async function openDroppedFile(file: File): Promise<void> {
  const name = file.name.toLowerCase()
  try {
    if (/\.(stl|obj|3mf)$/.test(name)) return await insertMeshes(file)
    if (/\.(okc|json)$/.test(name)) return await openDesign(file)
    if (name.endsWith('.kicad_pcb')) {
      const board = await readKicadFile(file)
      if (board) window.dispatchEvent(new CustomEvent(KICAD_EVENT, { detail: board }))
      return
    }
    useStore
      .getState()
      .setStatus('OpenKitCAD opens .okc designs, STL, OBJ and 3MF meshes, and .kicad_pcb boards.')
  } catch (error) {
    useStore.getState().setStatus(error instanceof Error ? error.message : String(error))
  }
}

export function installFileDrop(): () => void {
  const over = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const drop = (event: DragEvent) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) void openDroppedFile(file)
  }
  window.addEventListener('dragover', over)
  window.addEventListener('drop', drop)
  return () => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('drop', drop)
  }
}
