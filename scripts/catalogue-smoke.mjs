import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const PARTS = [
  'driver-drv8833',
  'driver-l298n',
  'driver-pca9685',
  'driver-tb6612fng',
  'esp32-wroom-32',
  'extrusion-2040',
  'extrusion-3030',
  'fastener-corner-bracket-2020',
  'fastener-t-nut-m5',
  'heltec-wifi-lora-32-v4',
  'mcu-arduino-uno-r4-wifi',
  'mcu-esp32-s3-devkitc-1',
  'motion-gt2-pulley-16t',
  'motion-gt2-pulley-20t',
  'motion-lead-screw-nut-t8',
  'motion-lead-screw-t8',
  'motion-mgn12c',
  'motion-mgn12h',
  'motion-smooth-rod-10mm',
  'motion-smooth-rod-8mm',
  'port-cable-gland-pg7',
  'port-cable-gland-pg9',
  'port-pushbutton-12mm',
  'port-terminal-508-3way',
  'port-terminal-508-4way',
  'port-terminal-508-5way',
  'power-fuse-holder-5x20',
  'power-relay-4ch',
  'proto-breadboard-400',
  'proto-breadboard-830',
  'proto-perfboard',
  'proto-stripboard',
]
const server = await createServer({
  server: { host: '127.0.0.1', port: 4284, strictPort: true, open: false },
})
let browser
let page
const failures = []
try {
  await server.listen()
  let launchError
  for (const executable of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      browser = await chromium.launch(
        !executable
          ? {}
          : /[\\/]/.test(executable)
            ? { executablePath: executable }
            : { channel: executable },
      )
      break
    } catch (error) {
      launchError = error
    }
  }
  if (!browser) throw launchError
  page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => failures.push(String(error)))
  await page.goto('http://127.0.0.1:4284/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady && window.__okcEngine)

  const built = await page.evaluate(async (ids) => {
    const { kernel } = await import('/src/kernel/api.ts')
    const { getPart, partProblems } = await import('/src/catalogue/index.ts')
    const { emptyDocument } = await import('/src/doc/types.ts')
    const { translationMatrix } = await import('/src/doc/model.ts')
    const api = kernel()
    await api.ready()
    const doc = emptyDocument('Catalogue smoke')
    const problems = []
    for (const [i, id] of ids.entries()) {
      const p = getPart(id)
      if (!p) throw new Error('Missing part ' + id)
      problems.push(...partProblems(p).map((problem) => id + ': ' + problem))
      doc.components.push({
        id,
        name: p.name,
        bodies: [],
        source: { kind: 'catalogue', partId: id },
      })
      doc.occurrences.push({
        id: 'occ-' + id,
        parentComponentId: 'root',
        componentId: id,
        name: p.name,
        transform: translationMatrix([i * 350, 0, 0]),
        visible: true,
        grounded: false,
      })
    }
    const result = await api.evaluate(doc, [])
    const step = await api.exportStep(
      result.instances.map((instance) => instance.id),
      doc.name,
    )
    const stepSolids = (new TextDecoder().decode(step).match(/MANIFOLD_SOLID_BREP/g) ?? []).length
    const nut = result.instances.find(
      (instance) => instance.componentId === 'motion-lead-screw-nut-t8',
    )
    const nutProjection = await api.project(nut.id, 'XY')
    const carriage = result.instances.find((instance) => instance.componentId === 'motion-mgn12h')
    const carriageProjection = await api.project(carriage.id, 'XY')
    const noHeaders = emptyDocument('Heltec without headers')
    noHeaders.components.push({
      id: 'heltec',
      name: 'Heltec',
      bodies: [],
      source: { kind: 'catalogue', partId: 'heltec-wifi-lora-32-v4', headers: false },
    })
    noHeaders.occurrences.push({
      id: 'heltec-occ',
      parentComponentId: 'root',
      componentId: 'heltec',
      name: 'Heltec',
      transform: translationMatrix([0, 0, 0]),
      visible: true,
      grounded: false,
    })
    const heltecBare = await api.evaluate(noHeaders, [])
    return {
      problems,
      errors: result.errors,
      instances: result.instances.length,
      meshes: result.meshes.map((mesh) => ({
        name: mesh.name,
        volume: mesh.volume,
        triangles: mesh.mesh.triangles.length,
        pieces: mesh.pieces,
        bounds: mesh.bounds,
      })),
      stepBytes: step.byteLength,
      stepSolids,
      nutHasBore: nutProjection.circles.some((circle) => Math.abs(circle.r - 4) < 1e-5),
      carriageBores: carriageProjection.circles.filter((circle) => Math.abs(circle.r - 1.25) < 1e-5)
        .length,
      heltecMinZ: heltecBare.meshes[0].bounds[2],
    }
  }, PARTS)
  assert.deepEqual(built.problems, [])
  assert.deepEqual(built.errors, [])
  assert.equal(built.instances, PARTS.length)
  assert.equal(built.meshes.length, PARTS.length)
  for (const mesh of built.meshes) {
    assert.ok(mesh.volume > 0 && Number.isFinite(mesh.volume), JSON.stringify(mesh))
    assert.ok(mesh.triangles > 0, mesh.name)
    assert.ok(mesh.bounds.every(Number.isFinite), mesh.name)
    assert.ok(mesh.pieces === undefined || mesh.pieces === 1, JSON.stringify(mesh))
  }
  assert.ok(built.stepBytes > 10000)
  assert.equal(built.stepSolids, PARTS.length)
  assert.ok(built.nutHasBore)
  assert.ok(built.carriageBores >= 4)
  assert.ok(built.heltecMinZ <= -3.4)
  const gallery = await page.evaluate(async (ids) => {
    const { getPart } = await import('/src/catalogue/index.ts')
    const { renderPart } = await import('/src/ui/parts/render.ts')
    return ids.map((id) => {
      const part = getPart(id)
      const canvas = renderPart(part, 300, 220)
      if (!canvas) throw new Error('Preview missing: ' + id)
      return { id, name: part.name, image: canvas.toDataURL() }
    })
  }, PARTS)
  assert.equal(gallery.length, PARTS.length)
  if (process.env.OKC_CATALOGUE_SCREENSHOT) {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.evaluate((gallery) => {
      document.body.innerHTML = ''
      document.body.style.cssText =
        'margin:0;padding:24px;background:#edf1f5;color:#253747;font:16px Arial;'
      const title = document.createElement('h1')
      title.textContent = 'OpenKitCAD · 32 new parts'
      document.body.append(title)
      const grid = document.createElement('div')
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;'
      document.body.append(grid)
      for (const part of gallery) {
        const card = document.createElement('div')
        card.style.cssText =
          'background:white;border:1px solid #d4dce4;border-radius:10px;overflow:hidden;padding:10px;'
        const image = document.createElement('img')
        image.src = part.image
        image.style.cssText = 'width:100%;display:block'
        const label = document.createElement('div')
        label.textContent = part.name
        label.style.cssText = 'min-height:42px'
        card.append(image, label)
        grid.append(card)
      }
    }, gallery)
    await page.screenshot({ path: process.env.OKC_CATALOGUE_SCREENSHOT, fullPage: true })
  }
  assert.deepEqual(failures, [])
  console.log(
    '32 new catalogue parts passed: solid build, single-piece geometry, STEP export and 3D previews.',
  )
} finally {
  await browser?.close()
  await server.close()
}

await import('./catalogue-expansion-smoke.mjs')
