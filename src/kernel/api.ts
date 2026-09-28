import * as Comlink from 'comlink'
import { create } from 'zustand'
import { getMeshData, meshDataIds } from '../doc/meshData'
import type { Feature, OkcDocument } from '../doc/types'
import type { EvaluateResult, KernelApi, PreviewRequest } from './types'

let worker: Worker | null = null
let proxy: Comlink.Remote<KernelApi> | null = null
let generation = 0

export interface KernelActivity {
  kind: 'build' | 'preview'
  since: number
  step: string | null
}

export const useKernelActivity = create<{ activity: KernelActivity | null }>(() => ({
  activity: null,
}))

function onMessage(event: MessageEvent): void {
  const data = event.data as { okcProgress?: unknown } | null
  if (!data || typeof data !== 'object' || typeof data.okcProgress !== 'string') return
  const activity = useKernelActivity.getState().activity
  if (activity && activity.step !== data.okcProgress) {
    useKernelActivity.setState({ activity: { ...activity, step: data.okcProgress } })
  }
}

export function kernel(): Comlink.Remote<KernelApi> {
  if (!proxy) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', onMessage)
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

type Job = BuildJob | PreviewJob

let running: Job | null = null
const sentMeshData = new Set<string>()

function withMeshData(doc: OkcDocument, extra: readonly Feature[] = []): OkcDocument {
  const missing = meshDataIds(doc, extra).filter((id) => !sentMeshData.has(id) && getMeshData(id))
  if (!missing.length) return doc
  for (const id of missing) sentMeshData.add(id)
  return { ...doc, meshData: Object.fromEntries(missing.map((id) => [id, getMeshData(id)!])) }
}
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

export function failedResult(error: unknown, hint?: string): EvaluateResult {
  return {
    meshes: [],
    instances: [],
    errors: [
      {
        featureId: '',
        severity: 'error',
        message: (error as Error)?.message ?? 'The geometry kernel stopped responding.',
        hint: hint ?? 'Reloading the page usually clears this. Your work is saved automatically.',
      },
    ],
    elapsedMs: 0,
    cache: { hits: 0, misses: 0, entries: 0 },
    planes: [],
  }
}

async function pump() {
  if (running) return
  const job: Job | null = pendingBuild ?? pendingPreview
  if (!job) return
  if (job.kind === 'build') pendingBuild = null
  else pendingPreview = null
  running = job
  const mine = generation
  useKernelActivity.setState({
    activity: { kind: job.kind, since: performance.now(), step: null },
  })
  let result: EvaluateResult
  try {
    result =
      job.kind === 'build'
        ? await kernel().evaluate(withMeshData(job.doc), keysOf(job.known))
        : await kernel().preview(
            { ...job.request, doc: withMeshData(job.request.doc, job.request.features) },
            keysOf(job.known),
          )
  } catch (e) {
    result = failedResult(e)
  }
  if (mine !== generation) return
  running = null
  useKernelActivity.setState({ activity: null })
  job.resolve(result)
  if (pendingBuild || pendingPreview) pump()
}

export function isBuilding(): boolean {
  return running !== null
}

export function stopKernel(): { kind: Job['kind']; step: string | null; seconds: number } | null {
  const job = running
  const activity = useKernelActivity.getState().activity
  if (!job) return null
  generation++
  worker?.terminate()
  worker = null
  proxy = null
  sentMeshData.clear()
  running = null
  useKernelActivity.setState({ activity: null })
  const seconds = activity ? Math.round((performance.now() - activity.since) / 1000) : 0
  job.resolve(
    failedResult(
      new Error(`Stopped after ${seconds} s because it was taking too long.`),
      job.kind === 'preview'
        ? 'Try smaller or simpler values.'
        : 'The step it was working on has been turned off.',
    ),
  )
  pump()
  return { kind: job.kind, step: activity?.step ?? null, seconds }
}
