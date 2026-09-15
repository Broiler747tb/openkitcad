import * as Comlink from 'comlink'
import type { TestResult } from './selftest'

export async function runNamingTest(): Promise<TestResult[]> {
  const worker = new Worker(new URL('./namingworker.ts', import.meta.url), { type: 'module' })
  const remote = Comlink.wrap<{ run(): Promise<TestResult[]> }>(worker)
  try {
    return await remote.run()
  } finally {
    worker.terminate()
  }
}
