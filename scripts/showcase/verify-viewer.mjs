import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { output, browserOptions } from './runtime.mjs'

const data = JSON.parse(readFileSync(resolve(output, 'printer-scene.json'), 'utf8'))
for (const [id, g] of Object.entries(data.geometries)) {
  if (
    !g.positions.every(Number.isFinite) ||
    !g.normals.every(Number.isFinite) ||
    g.normals.length !== g.positions.length ||
    !g.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < g.positions.length / 3)
  ) {
    throw new Error('Invalid mesh: ' + id)
  }
}
const glb = readFileSync(resolve(output, 'OpenKitCAD-3D-printer.glb'))
if (
  glb.toString('ascii', 0, 4) !== 'glTF' ||
  glb.readUInt32LE(4) !== 2 ||
  glb.readUInt32LE(8) !== glb.length
)
  throw new Error('Invalid GLB container')
const browser = await chromium.launch(browserOptions)
try {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1600, height: 1400 },
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(pathToFileURL(resolve(output, 'OpenKitCAD-3D-printer.html')).href)
  await page.waitForFunction(() => window.printerReady, null, { timeout: 90000 })
  const parts = await page.evaluate(() => window.printer.data.instances.length)
  if (parts !== data.instances.length) throw new Error('Viewer lost instances')
  await page.getByRole('button', { name: 'Toolhead', exact: true }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve(output, 'printer-toolhead-viewer.png') })
  await page.getByRole('button', { name: 'Back ¾', exact: true }).click()
  await page.waitForTimeout(1000)
  if (errors.length) throw new Error(errors.join('\n'))
  const report = {
    offlineViewer: true,
    cameraButtons: true,
    parts,
    geometries: Object.keys(data.geometries).length,
    glbBytes: glb.length,
    errors,
  }
  writeFileSync(resolve(output, 'viewer-verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await browser.close()
}
