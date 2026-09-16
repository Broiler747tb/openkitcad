import { runMeshTest } from '../meshtest'

const results = runMeshTest()
let passed = 0
for (const result of results) {
  if (result.pass) passed++
  else console.log(`FAIL ${result.name}: ${result.detail}`)
}
console.log(`PASS ${passed}/${results.length}`)
if (passed !== results.length) {
  ;(globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1
}
