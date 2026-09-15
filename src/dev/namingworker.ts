import * as Comlink from 'comlink'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import wasmUrl from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC } from 'replicad'
import { runNamingCases } from './namingcases'

let booted: Promise<unknown> | null = null

function boot(): Promise<unknown> {
  if (!booted) {
    booted = initOpenCascade({ locateFile: () => wasmUrl }).then((oc) => {
      setOC(oc as never)
      return oc
    })
  }
  return booted
}

Comlink.expose({
  async run() {
    return runNamingCases(await boot())
  },
})
