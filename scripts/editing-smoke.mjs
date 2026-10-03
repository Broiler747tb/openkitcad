import assert from 'node:assert/strict'
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
  server: { host: '127.0.0.1', port: 4275, strictPort: true, open: false },
})
let browser
let page
let checked = 0
const crashes = []
try {
  await server.listen()
  browser = await launch()
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  // The app has no favicon; Chromium's automatic request is unrelated to these checks.
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))
  page.on('pageerror', (error) => crashes.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') crashes.push(message.text())
  })
  await page.goto('http://127.0.0.1:4275/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const doc = emptyDocument('Editing regression')
    doc.components[0].bodies = [
      { id: 'solid', name: 'Plate', visible: true, colour: '#ffffff' },
      { id: 'cut', name: 'Cutting tool', visible: true, colour: '#ffffff', negative: true },
    ]
    doc.timeline = [
      ['box', 'solid', 0, 40],
      ['cutter', 'cut', 1000, 500],
    ].map(([id, bodyId, x, width]) => ({
      id,
      name: id,
      kind: 'box',
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [x, 0],
      width,
      depth: 20,
      height: 10,
      result: { kind: 'newBody', bodyId },
    }))
    window.__okc.store.getState().setDoc(doc)
  })
  async function waitForWidth(width) {
    await page.waitForFunction((width) => {
      const state = window.__okc.store.getState()
      const instance = state.instances.find((i) => i.bodyId === 'solid')
      const bounds = instance && state.meshes.get(instance.meshKey)?.bounds
      return !state.building && bounds && Math.abs(bounds[3] - bounds[0] - width) < 0.001
    }, width)
  }
  await waitForWidth(40)
  await page.evaluate(() => {
    const store = window.__okc.store.getState()
    store.beginTransient()
    store.updateFeature('box', { width: 60 }, { transient: true })
  })
  await waitForWidth(60)
  await page.evaluate(() => window.__okc.store.getState().cancelTransient())
  await waitForWidth(40)
  assert.equal(await page.evaluate(() => window.__okc.store.getState().past.length), 0)
  checked++

  await page.evaluate(() => window.__okc.store.getState().select({ kind: 'body', id: 'solid' }))
  await page.getByRole('button', { name: 'Checks', exact: true }).click()
  await page.getByRole('button', { name: /^Check it will print/ }).click()
  await page.getByText('No printing problems spotted.', { exact: true }).waitFor()
  checked++

  await page.evaluate(() => window.__okc.store.getState().updateFeature('box', { width: 230 }))
  await waitForWidth(230)
  assert.equal(await page.getByText('No printing problems spotted.', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /^Check it will print/ }).click()
  await page.getByText(/Too big for the print bed:/).waitFor()
  await page.evaluate(() => window.__okc.store.getState().undo())
  await waitForWidth(40)
  assert.equal(await page.getByText(/Too big for the print bed:/).count(), 0)
  checked++

  assert.deepEqual(crashes, [])
  console.log(`PASS  ${checked}/${checked} editing and print-check UI scenarios`)
} catch (error) {
  for (const crash of crashes.slice(0, 10)) console.error(crash)
  if (page)
    console.error(
      await page
        .evaluate(() => ({
          ready: window.__okc?.store.getState().kernelReady,
          error: window.__okc?.store.getState().kernelError,
        }))
        .catch(() => 'Page unavailable'),
    )
  throw error
} finally {
  await browser?.close()
  await server.close()
}
