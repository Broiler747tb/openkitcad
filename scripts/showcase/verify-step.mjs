import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setOC, importSTEP, measureVolume } from 'replicad'
import { output } from './runtime.mjs'

const require = createRequire(import.meta.url)
const initPath = require.resolve('replicad-opencascadejs/src/replicad_single.js')
const runtime = resolve(output, 'oc-runtime.cjs')
writeFileSync(
  runtime,
  readFileSync(initPath, 'utf8').replace('export default Module;', 'module.exports = Module;'),
)
setOC(
  await require(runtime)({
    wasmBinary: readFileSync(initPath.replace(/\.js$/, '.wasm')),
    print: () => {},
    printErr: console.error,
  }),
)
const shape = await importSTEP(
  new Blob([readFileSync(resolve(output, 'OpenKitCAD-3D-printer.step'))]),
)
const volume = measureVolume(shape)
if (!Number.isFinite(volume) || volume <= 0)
  throw new Error('STEP contains no measurable solid geometry')
const report = { roundTrip: true, volumeMm3: volume, bounds: shape.boundingBox.bounds }
writeFileSync(resolve(output, 'step-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
