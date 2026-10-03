import type { EncodedMesh } from '../mesh/blob'

const DATABASE = 'openkitcad'
const MESHES = 'meshes'
const GRACE_MS = 24 * 60 * 60 * 1000

interface StoredMesh {
  encoded: EncodedMesh
  at: number
}

let opening: Promise<IDBDatabase | null> | null = null
const kept = new Set<string>()
const writing = new Map<string, Promise<boolean>>()

function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(MESHES)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function finished(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true)
    transaction.onerror = () => resolve(false)
    transaction.onabort = () => resolve(false)
  })
}

export function isKept(id: string): boolean {
  return kept.has(id)
}

export function keepMesh(id: string, encoded: EncodedMesh): Promise<boolean> {
  if (kept.has(id)) return Promise.resolve(true)
  const pending = writing.get(id)
  if (pending) return pending
  const write = (async () => {
    const db = await database()
    if (!db) return false
    try {
      const transaction = db.transaction(MESHES, 'readwrite')
      transaction.objectStore(MESHES).put({ encoded, at: Date.now() } satisfies StoredMesh, id)
      const ok = await finished(transaction)
      if (ok) kept.add(id)
      return ok
    } catch {
      return false
    } finally {
      writing.delete(id)
    }
  })()
  writing.set(id, write)
  return write
}

export async function recallMeshes(ids: readonly string[]): Promise<Record<string, EncodedMesh>> {
  const found: Record<string, EncodedMesh> = {}
  if (!ids.length) return found
  const db = await database()
  if (!db) return found
  try {
    const store = db.transaction(MESHES, 'readonly').objectStore(MESHES)
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const request = store.get(id)
            request.onsuccess = () => {
              const value = request.result as StoredMesh | undefined
              if (value?.encoded) {
                found[id] = value.encoded
                kept.add(id)
              }
              resolve()
            }
            request.onerror = () => resolve()
          }),
      ),
    )
  } catch {
    return found
  }
  return found
}

export async function forgetMeshesExcept(wanted: ReadonlySet<string>): Promise<number> {
  const db = await database()
  if (!db) return 0
  const cutoff = Date.now() - GRACE_MS
  let removed = 0
  try {
    const transaction = db.transaction(MESHES, 'readwrite')
    const request = transaction.objectStore(MESHES).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const id = String(cursor.key)
      const value = cursor.value as StoredMesh | undefined
      if (!wanted.has(id) && (value?.at ?? 0) < cutoff) {
        cursor.delete()
        kept.delete(id)
        removed++
      }
      cursor.continue()
    }
    await finished(transaction)
  } catch {
    return removed
  }
  return removed
}
