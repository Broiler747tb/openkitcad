import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const ids = [
  'fastener-nut-m2',
  'fastener-nut-m25',
  'fastener-nut-m3',
  'fastener-nut-m4',
  'fastener-nut-m5',
  'fastener-nyloc-m2',
  'fastener-nyloc-m25',
  'fastener-nyloc-m3',
  'fastener-nyloc-m4',
  'fastener-nyloc-m5',
  'fastener-washer-m2',
  'fastener-washer-m25',
  'fastener-washer-m3',
  'fastener-washer-m4',
  'fastener-washer-m5',
  'magnet-disc-6x2',
  'magnet-disc-8x3',
  'magnet-disc-10x3',
  'magnet-block-10x5x2',
  'magnet-block-20x10x3',
  'fan-3010',
  'fan-4020',
  'fan-blower-5015',
  'motion-coupling-5x5',
  'motion-coupling-5x8',
  'motion-coupling-8x8',
  'motion-gt2-idler-3mm',
  'motion-gt2-idler-5mm',
  'motion-gt2-belt-6mm',
  'motion-gt2-belt-9mm',
  'motion-sk8',
  'motion-sk10',
  'motion-scs8uu',
  'motion-mgn9c',
  'motion-mgn9h',
  'motion-mgn15c',
  'motion-mgn15h',
  'control-tactile-b3f-1000',
  'control-tactile-b3f-1020',
  'control-microswitch-ss-5',
  'control-microswitch-ss-5gl',
  'control-microswitch-ss-5gl2',
  'control-panel-button-16mm',
  'control-panel-button-19mm',
  'power-cell-18650',
  'power-cell-21700',
  'power-lipo-pouch',
  'orange-pi-zero-3',
  'mcu-esp32-cam',
  'controller-btt-skr-pico-v1',
  'controller-btt-skr-mini-e3-v3',
]
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 4290, strictPort: true, open: false },
})
let browser
try {
  await server.listen()
  let launchError
  for (const channel of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      browser = await chromium.launch(channel ? { channel } : {})
      break
    } catch (error) {
      launchError = error
    }
  }
  if (!browser) throw launchError
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto('http://127.0.0.1:4290/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady && window.__okcEngine)
  const report = await page.evaluate(async (ids) => {
    const { CATALOGUE, getPart, partProblems, partBounds, effectivePart, searchEntries } =
      await import('/src/catalogue/index.ts')
    const { kernel } = await import('/src/kernel/api.ts')
    const { emptyDocument } = await import('/src/doc/types.ts')
    const { translationMatrix } = await import('/src/doc/model.ts')
    const { lookPrototype } = await import('/src/viewport/partLook.ts')
    const api = kernel()
    const doc = emptyDocument('Hardware catalogue expansion')
    const problems = []
    for (const [i, id] of ids.entries()) {
      const part = getPart(id)
      if (!part) throw new Error('Missing ' + id)
      problems.push(...partProblems(part).map((p) => id + ': ' + p))
      const look = lookPrototype(part)
      if (look.box.isEmpty() || !look.meshes.length) throw new Error('Empty preview ' + id)
      doc.components.push({
        id,
        name: part.name,
        bodies: [],
        source: { kind: 'catalogue', partId: id },
      })
      doc.occurrences.push({
        id: 'occ-' + id,
        parentComponentId: 'root',
        componentId: id,
        name: part.name,
        transform: translationMatrix([i * 200, 0, 0]),
        visible: true,
        grounded: false,
      })
    }
    const built = await api.evaluate(doc, [])
    const step = await api.exportStep(
      built.instances.map((i) => i.id),
      doc.name,
    )
    const projections = {}
    for (const [id, plane] of [
      ['fastener-washer-m3', 'XY'],
      ['motion-coupling-5x8', 'XY'],
      ['motion-sk8', 'YZ'],
      ['motion-scs8uu', 'YZ'],
      ['controller-btt-skr-mini-e3-v3', 'XY'],
    ]) {
      const instance = built.instances.find((i) => i.componentId === id)
      if (instance) projections[id] = await api.project(instance.id, plane)
    }
    const parametric = emptyDocument('Parametric hardware')
    const overrides = {
      'motion-gt2-belt-6mm': { length: 126 },
      'power-lipo-pouch': { width: 42, length: 62, thickness: 8 },
      'power-cell-18650': { length: 70 },
    }
    const dimensions = {}
    for (const [i, [id, override]] of Object.entries(overrides).entries()) {
      parametric.components.push({
        id,
        name: id,
        bodies: [],
        source: { kind: 'catalogue', partId: id, overrides: override },
      })
      parametric.occurrences.push({
        id: 'p-' + id,
        parentComponentId: 'root',
        componentId: id,
        name: id,
        transform: translationMatrix([i * 200, 0, 0]),
        visible: true,
        grounded: false,
      })
      const effective = effectivePart(getPart(id), { overrides: override })
      dimensions[id] = { bounds: partBounds(effective), keepouts: effective.keepouts }
    }
    const resized = await api.evaluate(parametric, [])
    const resizedStep = await api.exportStep(
      resized.instances.map((i) => i.id),
      parametric.name,
    )
    const { createShareLink, readSharedSnapshot } = await import('/src/doc/share.ts')
    const shared = readSharedSnapshot(new URL(createShareLink(parametric)).hash)
    const saved = JSON.parse(JSON.stringify(parametric))
    const restored = await api.evaluate(saved, [])
    return {
      count: CATALOGUE.length,
      problems,
      errors: built.errors,
      instances: built.instances.length,
      meshes: built.meshes.map((m) => ({
        id: m.bodyId,
        name: m.name,
        volume: m.volume,
        triangles: m.mesh.triangles.length,
        pieces: m.pieces,
        bounds: m.bounds,
      })),
      stepSolids: (new TextDecoder().decode(step).match(/MANIFOLD_SOLID_BREP/g) ?? []).length,
      stepBytes: step.byteLength,
      projections,
      dimensions,
      resizedErrors: resized.errors,
      resizedMeshes: resized.meshes.map((m) => ({
        name: m.name,
        bounds: m.bounds,
        volume: m.volume,
      })),
      resizedStepBytes: resizedStep.byteLength,
      restoredErrors: restored.errors,
      shareOverrides: shared.components
        .filter((c) => c.source.kind === 'catalogue')
        .map((c) => c.source.overrides),
      search: Object.fromEntries(
        ['магнит', 'муфта', 'ремень', 'концевик', 'вентилятор'].map((q) => [
          q,
          searchEntries(CATALOGUE, q).map((e) => e.id),
        ]),
      ),
    }
  }, ids)
  assert.ok(report.count >= 257)
  assert.deepEqual(report.problems, [])
  assert.deepEqual(report.errors, [])
  assert.equal(report.instances, ids.length)
  assert.equal(report.meshes.length, ids.length)
  assert.equal(report.stepSolids, ids.length)
  for (const mesh of report.meshes) {
    assert.ok(mesh.volume > 0 && Number.isFinite(mesh.volume), JSON.stringify(mesh))
    assert.ok(mesh.triangles > 0, mesh.name)
    assert.ok(mesh.bounds.every(Number.isFinite), mesh.name)
    assert.ok(mesh.pieces === undefined || mesh.pieces === 1, JSON.stringify(mesh))
  }
  const circles = (id) => report.projections[id]?.circles ?? []
  assert.ok(
    circles('fastener-washer-m3').some((c) => Math.abs(c.r - 1.6) < 1e-4),
    'M3 washer bore',
  )
  assert.ok(
    circles('motion-coupling-5x8').some((c) => Math.abs(c.r - 2.5) < 1e-4),
    '5 mm coupling end',
  )
  assert.ok(
    circles('motion-coupling-5x8').some((c) => Math.abs(c.r - 4) < 1e-4),
    '8 mm coupling end',
  )
  assert.ok(
    circles('motion-sk8').some((c) => Math.abs(c.r - 4) < 1e-4),
    'SK8 horizontal shaft channel',
  )
  assert.ok(
    circles('motion-scs8uu').some((c) => Math.abs(c.r - 4) < 1e-4),
    'SCS8UU horizontal shaft channel',
  )
  assert.ok(
    circles('controller-btt-skr-mini-e3-v3').filter((c) => Math.abs(c.r - 1.6) < 1e-4).length >= 5,
    'Five irregular controller holes',
  )
  assert.deepEqual(report.resizedErrors, [])
  assert.deepEqual(report.restoredErrors, [])
  assert.deepEqual(report.dimensions['motion-gt2-belt-6mm'].bounds, [0, 0, 0, 126, 6, 1.38])
  assert.deepEqual(report.dimensions['power-lipo-pouch'].bounds, [0, 0, 0, 42, 62, 8])
  assert.equal(report.dimensions['power-lipo-pouch'].keepouts[0].y, 62)
  assert.equal(report.dimensions['power-cell-18650'].bounds[5], 70)
  assert.deepEqual(report.shareOverrides, [
    { length: 126 },
    { width: 42, length: 62, thickness: 8 },
    { length: 70 },
  ])
  for (const [q, matches] of Object.entries(report.search)) assert.ok(matches.length, q)
  assert.ok(report.resizedStepBytes > 10000)
  const galleryIds = [
    'fastener-nut-m3',
    'fastener-nyloc-m3',
    'fastener-washer-m3',
    'magnet-disc-8x3',
    'fan-4020',
    'fan-blower-5015',
    'motion-coupling-5x8',
    'motion-gt2-belt-6mm',
    'motion-sk8',
    'motion-scs8uu',
    'motion-mgn9h',
    'control-microswitch-ss-5gl2',
    'power-cell-21700',
    'power-lipo-pouch',
    'orange-pi-zero-3',
    'controller-btt-skr-mini-e3-v3',
  ]
  const gallery = await page.evaluate(async (ids) => {
    const { getPart } = await import('/src/catalogue/index.ts')
    const { renderPart } = await import('/src/ui/parts/render.ts')
    return ids.map((id) => {
      const part = getPart(id)
      const canvas = renderPart(part, 340, 220)
      if (!canvas) throw new Error('Preview missing ' + id)
      return { id, name: part.name, image: canvas.toDataURL() }
    })
  }, galleryIds)
  await page.evaluate((gallery) => {
    document.body.innerHTML = ''
    document.body.style.cssText =
      'margin:0;padding:28px;background:#f1f3f6;color:#222;font-family:Arial,sans-serif;display:block;overflow:auto;height:auto'
    const heading = document.createElement('h1')
    heading.textContent = 'OpenKitCAD · 51 new parts · 257 total'
    document.body.append(heading)
    const grid = document.createElement('div')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px'
    document.body.append(grid)
    for (const item of gallery) {
      const card = document.createElement('div')
      card.style.cssText =
        'background:white;border-radius:12px;padding:12px;min-width:0;height:265px'
      const img = document.createElement('img')
      img.src = item.image
      img.style.cssText = 'width:100%;height:220px;object-fit:contain'
      const label = document.createElement('div')
      label.textContent = item.name
      label.style.cssText = 'font-size:15px;line-height:1.4;text-align:center'
      card.append(img, label)
      grid.append(card)
    }
  }, gallery)
  await page.screenshot({
    path: process.env.OKC_CATALOGUE_IMAGE ?? path.join(root, '../catalogue-expansion.png'),
    fullPage: true,
  })
  assert.deepEqual(pageErrors, [])
  await fs.writeFile(
    process.env.OKC_CATALOGUE_REPORT ?? path.join(root, '../catalogue-expansion-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    '51 hardware parts passed schema, solid geometry, STEP export, shaft channels, parametric dimensions, persistence and previews.',
  )
} finally {
  if (browser) await browser.close()
  await server.close()
}
