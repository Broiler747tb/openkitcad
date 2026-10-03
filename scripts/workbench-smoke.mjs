import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { createServer } from 'vite'
import { chromium } from 'playwright'

async function launch() {
  let failure
  for (const browser of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      return await chromium.launch(
        !browser ? {} : /[\\/]/.test(browser) ? { executablePath: browser } : { channel: browser },
      )
    } catch (error) {
      failure = error
    }
  }
  throw failure
}
const server = await createServer({
  server: { host: '127.0.0.1', port: 4280, strictPort: true, open: false },
})
let browser
let page
let checked = 0
const crashes = []
const ready = async () => page.waitForFunction(() => !window.__okc.store.getState().building)
async function fixture(mode = 'print') {
  await page.evaluate(async (mode) => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const doc = emptyDocument('Workbench regression')
    doc.components[0].bodies = ['plate', 'lid'].map((id) => ({
      id,
      name: 'Крышка',
      colour: '#4783bc',
      visible: true,
    }))
    doc.timeline = ['plate', 'lid'].map((bodyId, index) => ({
      id: `box-${index}`,
      kind: 'box',
      name: `Box ${index}`,
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [index * 100, 0],
      width: 40,
      depth: 30,
      height: mode === 'repair' ? 10 : 1,
      result: { kind: 'newBody', bodyId },
    }))
    if (mode === 'repair')
      doc.timeline.push(
        {
          id: 'bad-fillet',
          kind: 'fillet',
          name: 'Broken rounding',
          componentId: 'root',
          bodyId: 'plate',
          radius: 1,
          edges: [{ bodyId: 'plate', kind: 'edge', name: 'missing-edge' }],
        },
        {
          id: 'after-rounding',
          kind: 'move',
          name: 'Dependent move',
          componentId: 'root',
          bodyIds: ['plate'],
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
        },
      )
    window.__okc.store.getState().setDoc(doc)
  }, mode)
  await ready()
  await page.evaluate(() => window.__okc.store.getState().select({ kind: 'body', id: 'plate' }))
}
try {
  await server.listen()
  browser = await launch()
  page = await browser.newPage({
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  })
  page.on('pageerror', (error) => crashes.push(String(error)))
  await page.goto('http://127.0.0.1:4280/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
  await fixture()
  await page.locator('.inspector-tabs').getByRole('button', { name: 'Checks', exact: true }).click()
  await page.getByText('Printer settings', { exact: true }).click()
  for (const [label, value] of [
    ['Nozzle diameter', '1'],
    ['Bed width', '20'],
    ['Maximum print height', '100'],
  ]) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
    await page.getByRole('textbox', { name: label, exact: true }).press('Enter')
  }
  await page.getByRole('button', { name: /^Check it will print/ }).click()
  await page
    .getByText(/Too big for the print bed/)
    .first()
    .waitFor()
  await page
    .getByText(/The thinnest wall is/)
    .first()
    .waitFor()
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('okc.print-settings.v1')),
  )
  assert.equal(settings.nozzle, 1)
  assert.deepEqual(settings.bed, [20, 220, 100])
  await page.getByRole('textbox', { name: 'Bed width', exact: true }).fill('50')
  await page.getByRole('textbox', { name: 'Bed width', exact: true }).press('Enter')
  assert.equal(await page.getByText(/Too big for the print bed/).count(), 0)
  await page.getByRole('textbox', { name: 'Nozzle diameter', exact: true }).fill('0')
  await page.getByRole('textbox', { name: 'Nozzle diameter', exact: true }).press('Enter')
  assert.equal(
    await page.getByRole('textbox', { name: 'Nozzle diameter', exact: true }).inputValue(),
    '1',
  )
  await page.reload()
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
  await ready()
  await page.evaluate(() => window.__okc.store.getState().select({ kind: 'body', id: 'plate' }))
  await page.locator('.inspector-tabs').getByRole('button', { name: 'Checks', exact: true }).click()
  await page.getByText('Printer settings', { exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Bed width', exact: true }).inputValue(),
    '50',
  )
  checked++

  await fixture()
  await page.locator('.file-menu > summary').click()
  await page.getByRole('button', { name: 'Export…', exact: true }).click()
  const exporter = page.getByRole('dialog', { name: 'Export design' })
  await exporter.getByRole('button', { name: 'Select all', exact: true }).click()
  if (process.env.OKC_WORKBENCH_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.OKC_WORKBENCH_SCREENSHOTS}-export.png` })
  assert.equal(await exporter.getByRole('checkbox').count(), 2)
  const threeMfDownload = page.waitForEvent('download')
  await exporter.getByRole('button', { name: /^3MF/ }).click()
  const threeMf = await threeMfDownload
  assert.equal(threeMf.suggestedFilename(), 'Workbench regression.3mf')
  const files = unzipSync(await readFile(await threeMf.path()))
  const xml = strFromU8(files['3D/3dmodel.model'])
  const bounds = await page.evaluate((xml) => {
    const model = new DOMParser().parseFromString(xml, 'application/xml')
    if (model.querySelector('parsererror')) throw new Error('Invalid 3MF XML')
    return [...model.querySelectorAll('object')].map((object) => ({
      id: object.getAttribute('id'),
      name: object.getAttribute('name'),
      minX: Math.min(
        ...[...object.querySelectorAll('vertex')].map((vertex) => Number(vertex.getAttribute('x'))),
      ),
    }))
  }, xml)
  assert.deepEqual(bounds, [
    { id: '1', name: 'Крышка', minX: 0 },
    { id: '2', name: 'Крышка', minX: 100 },
  ])
  const stepDownload = page.waitForEvent('download')
  await exporter.getByRole('button', { name: /^STEP/ }).click()
  const step = await stepDownload
  assert.equal(step.suggestedFilename(), 'Workbench regression.step')
  const stepText = await readFile(await step.path(), 'utf8')
  assert.match(stepText, /ISO-10303-21/)
  assert.equal((stepText.match(/MANIFOLD_SOLID_BREP\(/g) ?? []).length, 2)
  const stlDownload = page.waitForEvent('download')
  await exporter.getByRole('button', { name: /^STL/ }).click()
  const stl = await stlDownload
  assert.equal(stl.suggestedFilename(), 'Workbench regression.zip')
  const stls = unzipSync(await readFile(await stl.path()))
  assert.deepEqual(Object.keys(stls).sort(), ['Крышка (2).stl', 'Крышка.stl'])
  for (const data of Object.values(stls))
    assert.equal(
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true),
      12,
    )
  await exporter.getByRole('button', { name: 'Clear selection', exact: true }).click()
  assert.equal(await exporter.getByRole('button', { name: /^3MF/ }).isDisabled(), true)
  await exporter.getByRole('checkbox').first().check()
  const singleDownload = page.waitForEvent('download')
  await exporter.getByRole('button', { name: /^STL/ }).click()
  assert.equal((await singleDownload).suggestedFilename(), 'Крышка.stl')
  await exporter.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => {
    window.__okc.store.getState().addFeature({
      id: 'mesh-copy',
      kind: 'tessellate',
      name: 'Mesh copy',
      componentId: 'root',
      sourceBodyId: 'plate',
      bodyId: 'mesh-body',
      refinement: 'coarse',
    })
  })
  await ready()
  await page.locator('.file-menu > summary').click()
  await page.getByRole('button', { name: 'Export…', exact: true }).click()
  await exporter.getByRole('button', { name: 'Select all', exact: true }).click()
  await exporter.getByRole('button', { name: /^STEP/ }).click()
  await exporter.getByText(/^Mesh bodies cannot be written to STEP/).waitFor()
  await exporter.getByRole('button', { name: 'Close', exact: true }).click()
  checked++

  await fixture('repair')
  const problems = page.locator('.history-problems')
  await problems.getByRole('button', { name: 'Broken rounding', exact: true }).waitFor()
  assert.equal(await problems.locator('.msg.error').count(), 1)
  await problems.getByText('Dependent steps: 1', { exact: true }).click()
  await problems.getByRole('button', { name: 'Dependent move', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.__okc.store.getState().selection.id),
    'after-rounding',
  )
  const metadata = await page.evaluate(() => window.__okc.store.getState().errors)
  if (process.env.OKC_WORKBENCH_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.OKC_WORKBENCH_SCREENSHOTS}-history.png` })
  assert.equal(
    metadata.find((error) => error.featureId === 'bad-fillet').reference.name,
    'missing-edge',
  )
  await problems.getByRole('button', { name: 'Pick geometry again', exact: true }).click()
  const command = page.locator('.okc-cmd')
  await command.getByRole('button', { name: 'Clear Edges', exact: true }).click()
  await page.evaluate(async () => {
    const { useCommand } = await import('/src/ui/command/session.ts')
    const { elementPick } = await import('/src/ui/command/picks.ts')
    const state = window.__okc.store.getState()
    const mesh = [...state.meshes.values()].find((mesh) => mesh.bodyId === 'plate')
    useCommand.getState().dispatch({
      type: 'pick',
      id: 'edges',
      pick: elementPick(state.doc, {
        bodyId: 'plate',
        kind: 'edge',
        name: mesh.edges.edgeGroups[0].name,
      }),
    })
  })
  await command.getByRole('button', { name: 'OK', exact: true }).click()
  await ready()
  assert.equal(
    await page.evaluate(
      () =>
        window.__okc.store.getState().errors.filter((error) => error.severity === 'error').length,
    ),
    0,
  )
  await page.evaluate(() => window.__okc.store.getState().undo())
  await ready()
  await problems.getByRole('button', { name: 'Pick geometry again', exact: true }).waitFor()
  await page.evaluate(() => window.__okc.store.getState().redo())
  await ready()
  assert.equal(
    await page.evaluate(
      () =>
        window.__okc.store.getState().errors.filter((error) => error.severity === 'error').length,
    ),
    0,
  )
  checked++

  await fixture()
  const sketchBefore = await page.evaluate(async () => {
    const { emptySketch } = await import('/src/sketch/types.ts')
    const doc = structuredClone(window.__okc.store.getState().doc)
    const sketch = emptySketch()
    sketch.points.push(
      ...[
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ].map(([x, y], index) => ({ id: `p${index}`, x, y })),
    )
    sketch.entities.push(
      ...[0, 1, 2, 3].map((index) => ({
        id: `line${index}`,
        kind: 'line',
        p1: `p${index}`,
        p2: `p${(index + 1) % 4}`,
        construction: false,
      })),
    )
    doc.components[0].bodies.push({ id: 'cap', name: 'Cap', visible: true, colour: '#4783bc' })
    doc.timeline.push(
      {
        id: 'bad-plane',
        kind: 'sketch',
        name: 'Lost sketch plane',
        componentId: 'root',
        visible: true,
        plane: {
          kind: 'face',
          face: { kind: 'face', bodyId: 'plate', name: 'missing-face' },
          offset: 0,
        },
        sketch,
      },
      {
        id: 'cap-extrude',
        kind: 'extrude',
        name: 'Dependent extrusion',
        componentId: 'root',
        sketchId: 'bad-plane',
        distance: 3,
        reverse: false,
        symmetric: false,
        result: { kind: 'newBody', bodyId: 'cap' },
      },
    )
    window.__okc.store.getState().setDoc(doc)
    return JSON.stringify(sketch)
  })
  await ready()
  const planeProblems = page.locator('.history-problems')
  assert.equal(await planeProblems.locator('.msg.error').count(), 1)
  assert.equal(
    await page.evaluate(
      () =>
        window.__okc.store.getState().errors.find((error) => error.featureId === 'cap-extrude')
          .causeFeatureId,
    ),
    'bad-plane',
  )
  await planeProblems.getByRole('button', { name: 'Pick geometry again', exact: true }).click()
  await page.locator('.okc-cmd').waitFor()
  assert.equal(
    await page.evaluate(
      async () =>
        (await import('/src/ui/command/session.ts')).useCommand.getState().session.spec.id,
    ),
    'repairSketchPlane',
  )
  await page.evaluate(async () => {
    const { useCommand } = await import('/src/ui/command/session.ts')
    const { planePick } = await import('/src/ui/command/picks.ts')
    useCommand.getState().dispatch({
      type: 'pick',
      id: 'plane',
      pick: planePick(window.__okc.store.getState().doc, {
        kind: 'named',
        name: 'XY',
        offset: 0,
      }),
    })
  })
  await page.locator('.okc-cmd').getByRole('button', { name: 'OK', exact: true }).click()
  await ready()
  assert.deepEqual(await page.evaluate(() => window.__okc.store.getState().errors), [])
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        window.__okc.store.getState().doc.timeline.find((feature) => feature.id === 'bad-plane')
          .sketch,
      ),
    ),
    sketchBefore,
  )
  assert.equal(
    await page.evaluate(() =>
      window.__okc.store.getState().instances.some((instance) => instance.bodyId === 'cap'),
    ),
    true,
  )
  checked++

  await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const { emptySketch } = await import('/src/sketch/types.ts')
    const doc = emptyDocument('Sketch diagnostics')
    const sketch = emptySketch()
    sketch.points.push({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 })
    sketch.entities.push({ id: 'line', kind: 'line', p1: 'a', p2: 'b', construction: false })
    doc.timeline = [
      {
        id: 'sketch',
        kind: 'sketch',
        name: 'Sketch',
        componentId: 'root',
        visible: true,
        plane: { kind: 'named', name: 'XY', offset: 0 },
        sketch,
      },
    ]
    window.__okc.store.getState().setDoc(doc)
    window.__okc.store.getState().openSketch('sketch')
  })
  await page.getByRole('button', { name: 'Show free geometry', exact: true }).click()
  assert.ok(await page.evaluate(() => window.__okc.store.getState().sketchSelection.length > 0))
  await page.evaluate(() =>
    window.__okc.store.getState().editSketch((sketch) => {
      sketch.constraints.push(
        { id: 'length-10', kind: 'distance', a: 'a', b: 'b', value: 10 },
        { id: 'length-20', kind: 'distance', a: 'a', b: 'b', value: 20 },
      )
    }),
  )
  await page.locator('.diagnostic-conflict').first().waitFor()
  await page.locator('.diagnostic-conflict').first().click()
  if (process.env.OKC_WORKBENCH_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.OKC_WORKBENCH_SCREENSHOTS}-sketch.png` })
  assert.equal(
    await page.evaluate(() => window.__okc.store.getState().sketchSelection[0].kind),
    'constraint',
  )
  await page.getByRole('button', { name: '✓ Finish Sketch', exact: true }).click()
  checked++

  await fixture()
  await page.evaluate(() => {
    const state = window.__okc.store.getState()
    const instance = state.instances.find((item) => item.bodyId === 'plate')
    const mesh = state.meshes.get(instance.meshKey)
    state.select({ kind: 'edge', id: 'plate', instanceId: instance.id })
    window.__okc.store.setState({
      subSelection: [
        {
          kind: 'edge',
          bodyId: 'plate',
          instanceId: instance.id,
          name: mesh.edges.edgeGroups[0].name,
          point: [0, 0, 0],
        },
      ],
    })
  })
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: 'Actions', exact: true })
    .click()
  const actions = page.locator('.selection-actions')
  assert.equal(await actions.getByRole('button', { name: /^Fillet\b/ }).count(), 1)
  await actions.getByText(/^More actions/).click()
  await actions.getByRole('textbox', { name: 'Search actions' }).fill('all edges')
  await actions.getByRole('button', { name: /^Fillet All Edges/ }).waitFor()
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: 'Проверки', exact: true })
    .click()
  await page.getByText('Настройки принтера', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Подробнее', exact: true }).first().click()
  await page.getByText('Настройки принтера', { exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  if (process.env.OKC_WORKBENCH_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.OKC_WORKBENCH_SCREENSHOTS}-mobile.png` })
  checked++
  assert.deepEqual(crashes, [])
  console.log(`${checked} workbench UI scenarios passed.`)
} catch (error) {
  if (page) {
    console.error((await page.locator('body').innerText()).slice(-7000))
    await page.screenshot({ path: '../workbench-failure.png' })
  }
  throw error
} finally {
  await browser?.close()
  await server.close()
}
