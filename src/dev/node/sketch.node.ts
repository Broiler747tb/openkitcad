import { runSketchTest } from '../sketchtest'

const results = runSketchTest()
for (const result of results) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} :: ${result.detail}`)
}
const failed = results.filter((result) => !result.pass).length
console.log(`${failed ? 'FAIL' : 'PASS'} ${results.length - failed}/${results.length}`)
