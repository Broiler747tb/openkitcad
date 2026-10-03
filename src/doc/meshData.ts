import { encodeMesh, meshDataId, type EncodedMesh } from '../mesh/blob'
import type { TriMesh } from '../mesh/types'
import type { Feature, OkcDocument } from './types'
import { isKept, keepMesh } from './meshVault'

const store = new Map<string, EncodedMesh>()

export function putMeshData(mesh: TriMesh): string {
  const encoded = encodeMesh(mesh)
  const id = meshDataId(encoded)
  if (!store.has(id)) {
    store.set(id, encoded)
    void keepMesh(id, encoded)
  }
  return id
}

export function getMeshData(id: string): EncodedMesh | undefined {
  return store.get(id)
}

export function meshDataIds(doc: OkcDocument, extra: readonly Feature[] = []): string[] {
  const ids = new Set<string>()
  for (const feature of [...doc.timeline, ...extra]) {
    if (feature.kind === 'meshInsert') ids.add(feature.dataId)
  }
  return [...ids]
}

export function referencedMeshData(doc: OkcDocument): Record<string, EncodedMesh> {
  const out: Record<string, EncodedMesh> = {}
  for (const id of meshDataIds(doc)) {
    const data = store.get(id)
    if (data) out[id] = data
  }
  return out
}

export function unkeptMeshData(doc: OkcDocument): Record<string, EncodedMesh> {
  const out: Record<string, EncodedMesh> = {}
  for (const id of meshDataIds(doc)) {
    const data = store.get(id)
    if (data && !isKept(id)) out[id] = data
  }
  return out
}

export function missingMeshData(doc: OkcDocument): string[] {
  return meshDataIds(doc).filter((id) => !store.has(id))
}

export function absorbMeshData(data: Record<string, EncodedMesh> | undefined): void {
  if (!data) return
  for (const [id, encoded] of Object.entries(data)) {
    if (store.has(id)) continue
    store.set(id, encoded)
    void keepMesh(id, encoded)
  }
}
