import { putMeshData } from '../doc/meshData'
import { useStore } from '../doc/store'
import { importMeshFile } from '../mesh/import'
import { meshBounds, triangleCount } from '../mesh/types'
import { startCommand } from './command/commands'
import { setPendingMeshes, type PendingMesh } from './command/specs/mesh'

export function readMeshFile(name: string, bytes: Uint8Array): PendingMesh[] {
  return importMeshFile(name, bytes).flatMap(({ name: bodyName, mesh }) => {
    if (!triangleCount(mesh)) return []
    const { min, max } = meshBounds(mesh)
    return [{ name: bodyName, dataId: putMeshData(mesh), min, max, triangles: triangleCount(mesh) }]
  })
}

export function insertMeshFile(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.stl,.obj,.3mf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(false)
      const store = useStore.getState()
      store.setBusy(`Reading ${file.name}`)
      try {
        const meshes = readMeshFile(file.name, new Uint8Array(await file.arrayBuffer()))
        if (!meshes.length) throw new Error(`${file.name} has no triangles in it.`)
        setPendingMeshes(meshes)
        resolve(startCommand('meshInsert'))
      } catch (error) {
        store.setStatus((error as Error).message)
        resolve(false)
      } finally {
        useStore.getState().setBusy(null)
      }
    }
    input.oncancel = () => resolve(false)
    input.click()
  })
}
