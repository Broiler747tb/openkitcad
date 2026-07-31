/**
 * Main-thread client for the kernel worker.
 *
 * Rebuilds are coalesced: while the user drags a dimension slider we may be
 * asked to rebuild sixty times a second, but OpenCascade can only manage a
 * handful. Requests that arrive during a build replace each other, so the
 * kernel always works on the newest document and never queues up stale ones.
 */
import * as Comlink from 'comlink'
import type { KernelApi } from './worker'
import type { OkcDocument } from '../doc/types'
import type { EvaluateResult } from './types'

let worker: Worker | null = null
let proxy: Comlink.Remote<KernelApi> | null = null

export function kernel(): Comlink.Remote<KernelApi> {
  if (!proxy) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    proxy = Comlink.wrap<KernelApi>(worker)
  }
  return proxy
}

let building = false
let pending: { doc: OkcDocument; resolve: (r: EvaluateResult) => void } | null = null

/**
 * Ask for a rebuild. If one is already running the request is held and only the
 * most recent is honoured once the kernel frees up.
 */
export function requestBuild(doc: OkcDocument): Promise<EvaluateResult> {
  return new Promise((resolve) => {
    pending = { doc, resolve }
    pump()
  })
}

async function pump() {
  if (building || !pending) return
  const job = pending
  pending = null
  building = true
  try {
    const result = await kernel().evaluate(job.doc)
    job.resolve(result)
  } catch (e) {
    job.resolve({
      shapes: [],
      errors: [
        {
          featureId: '',
          bodyId: '',
          message: (e as Error)?.message ?? 'The geometry kernel stopped responding.',
          hint: 'Reloading the page usually clears this. Your work is saved automatically.',
        },
      ],
      elapsedMs: 0,
    })
  } finally {
    building = false
    if (pending) pump()
  }
}

export function isBuilding(): boolean {
  return building
}
