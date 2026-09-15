import * as Comlink from 'comlink'
import type { OkcDocument } from '../doc/types'
import type { EvaluateResult, KernelApi, PreviewRequest } from './types'

let worker: Worker | null = null
let proxy: Comlink.Remote<KernelApi> | null = null

export function kernel(): Comlink.Remote<KernelApi> {
  if (!proxy) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    proxy = Comlink.wrap<KernelApi>(worker)
  }
  return proxy
}

export type KnownMeshKeys = string[] | (() => string[])

interface BuildJob {
  kind: 'build'
  doc: OkcDocument
  known: KnownMeshKeys
  resolve: (result: EvaluateResult) => void
}

interface PreviewJob {
  kind: 'preview'
  request: PreviewRequest
  known: KnownMeshKeys
  resolve: (result: EvaluateResult) => void
}

let building = false
let pendingBuild: BuildJob | null = null
let pendingPreview: PreviewJob | null = null

export function requestBuild(
  doc: OkcDocument,
  knownMeshKeys: KnownMeshKeys,
): Promise<EvaluateResult> {
  return new Promise((resolve) => {
    pendingBuild = { kind: 'build', doc, known: knownMeshKeys, resolve }
    pump()
  })
}

export function requestPreview(
  request: PreviewRequest,
  knownMeshKeys: KnownMeshKeys,
): Promise<EvaluateResult> {
  return new Promise((resolve) => {
    pendingPreview = { kind: 'preview', request, known: knownMeshKeys, resolve }
    pump()
  })
}

export function cancelPreview(): void {
  pendingPreview = null
}

function keysOf(known: KnownMeshKeys): string[] {
  return typeof known === 'function' ? known() : known
}

export function failedResult(error: unknown): EvaluateResult {
  return {
    meshes: [],
    instances: [],
    errors: [
      {
        featureId: '',
        severity: 'error',
        message: (error as Error)?.message ?? 'The geometry kernel stopped responding.',
        hint: 'Reloading the page usually clears this. Your work is saved automatically.',
      },
    ],
    elapsedMs: 0,
    cache: { hits: 0, misses: 0, entries: 0 },
  }
}

async function pump() {
  if (building) return
  const job: BuildJob | PreviewJob | null = pendingBuild ?? pendingPreview
  if (!job) return
  if (job.kind === 'build') pendingBuild = null
  else pendingPreview = null
  building = true
  try {
    const result =
      job.kind === 'build'
        ? await kernel().evaluate(job.doc, keysOf(job.known))
        : await kernel().preview(job.request, keysOf(job.known))
    job.resolve(result)
  } catch (e) {
    job.resolve(failedResult(e))
  } finally {
    building = false
    if (pendingBuild || pendingPreview) pump()
  }
}

export function isBuilding(): boolean {
  return building
}
