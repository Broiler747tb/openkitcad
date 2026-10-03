import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer, preview } from 'vite'
import { chromium } from 'playwright'
import { deflateSync, strToU8 } from 'fflate'

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

const dev = await createServer({
  server: { host: '127.0.0.1', port: 4276, strictPort: true, open: false },
})
const production = await preview({
  preview: { host: '127.0.0.1', port: 4277, strictPort: true, open: false },
})
let browser
const crashes = []
const uploads = []
let checked = 0
let lastPage
try {
  await dev.listen()
  browser = await launch()
  const producer = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  })
  const page = await producer.newPage()
  lastPage = page
  const observe = async (page) => {
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))
    page.on('pageerror', (error) => crashes.push(String(error)))
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) uploads.push(request.url())
    })
  }
  await observe(page)
  await page.goto('http://127.0.0.1:4276/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
  const fixture = await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const { upsertUserPart } = await import('/src/catalogue/index.ts')
    const { createMesh } = await import('/src/mesh/types.ts')
    const { putMeshData } = await import('/src/doc/meshData.ts')
    const { serialise } = await import('/src/doc/persist.ts')
    const custom = {
      id: 'share-test-board',
      name: 'Shared board',
      category: 'mcu',
      summary: 'Test board',
      confidence: 'measured',
      source: 'Test',
      geometry: { kind: 'board', outline: { shape: 'rect', w: 20, h: 10 }, thickness: 1.6 },
    }
    upsertUserPart(custom)
    const doc = emptyDocument('Shared fixture 🔧')
    const old = emptyDocument('My previous project')
    const box = {
      id: 'box',
      name: 'Box',
      kind: 'box',
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [0, 0],
      width: 10,
      depth: 20,
      height: 0.1,
      result: { kind: 'newBody', bodyId: 'solid' },
    }
    const body = { id: 'solid', name: 'Box', visible: true, colour: '#e67e22' }
    old.timeline = [box]
    old.components[0].bodies = [body]
    doc.timeline = [box]
    doc.components[0].bodies = [
      body,
      { id: 'mesh-body', name: 'Tetrahedron', visible: true, colour: '#3498db' },
    ]
    const meshId = putMeshData(
      createMesh([30, 0, 0, 40, 0, 0, 30, 10, 0, 30, 0, 10], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    )
    doc.timeline.push({
      id: 'insert',
      name: 'Tetrahedron',
      kind: 'meshInsert',
      componentId: 'root',
      bodyId: 'mesh-body',
      dataId: meshId,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      unit: 'mm',
      yUp: false,
      centre: false,
      ground: false,
    })
    doc.components.push({
      id: 'board-component',
      name: 'Shared board',
      source: { kind: 'catalogue', partId: custom.id },
      bodies: [],
    })
    doc.occurrences.push({
      id: 'board-instance',
      parentComponentId: 'root',
      componentId: 'board-component',
      name: 'Board',
      visible: true,
      grounded: false,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 30, 0, 1],
    })
    window.__okc.store.getState().setDoc(doc)
    return {
      snapshot: JSON.parse(serialise(doc)),
      old,
      conflicting: {
        ...custom,
        geometry: { ...custom.geometry, outline: { shape: 'rect', w: 99, h: 10 } },
      },
      meshId,
    }
  })
  await page.getByRole('button', { name: 'Share', exact: true }).waitFor()
  await page.waitForFunction(() => !window.__okc.store.getState().building)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share model' })
  await dialog.waitFor()
  const link = await dialog.getByLabel('Model link').inputValue()
  assert.ok(link.startsWith('https://broiler747tb.github.io/openkitcad/#m=1.'))
  assert.ok(link.length < 8000)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Denied')
        },
      },
    })
  })
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await dialog.getByText('Select and copy the link above.').waitFor()
  assert.equal(
    await dialog
      .getByLabel('Model link')
      .evaluate((field) => field.selectionEnd - field.selectionStart),
    link.length,
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  checked++
  console.log(`Share fixture link: ${link.length} characters`)

  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  })
  await context.addInitScript(({ old, conflicting }) => {
    localStorage.setItem('openkitcad.autosave.v2', JSON.stringify({ savedAt: 'now', doc: old }))
    localStorage.setItem('openkitcad.userparts.v1', JSON.stringify([conflicting]))
  }, fixture)
  const viewer = await context.newPage()
  lastPage = viewer
  await observe(viewer)
  await viewer.goto('http://127.0.0.1:4277/' + new URL(link).hash)
  await viewer.getByText('View only', { exact: true }).waitFor()
  await viewer.getByRole('button', { name: 'Open a copy', exact: true }).waitFor()
  await viewer.waitForFunction(() => !document.querySelector('.shared-message'), null, {
    timeout: 60_000,
  })
  assert.equal(await viewer.locator('.shared-canvas canvas').count(), 1)
  await viewer.waitForTimeout(800)
  const untouched = await viewer.evaluate(async () => ({
    name: JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name,
    parts: JSON.parse(localStorage.getItem('openkitcad.userparts.v1')),
    databases: await indexedDB.databases(),
  }))
  assert.equal(untouched.name, fixture.old.name)
  assert.deepEqual(untouched.parts, [fixture.conflicting])
  assert.equal(untouched.databases.length, 0)
  assert.equal(await viewer.getByRole('button', { name: 'Undo', exact: true }).count(), 0)
  checked++
  const beforeImage = await viewer.locator('.shared-canvas').screenshot()
  const bounds = await viewer.locator('.shared-canvas').boundingBox()
  await viewer.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4)
  await viewer.mouse.down()
  await viewer.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5, {
    steps: 15,
  })
  await viewer.mouse.up()
  await viewer.waitForTimeout(300)
  assert.notDeepEqual(await viewer.locator('.shared-canvas').screenshot(), beforeImage)
  await viewer.getByRole('button', { name: 'Fit view' }).click()
  checked++
  const downloading = viewer.waitForEvent('download')
  await viewer.getByRole('button', { name: 'Download .okc' }).click()
  const download = await downloading
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.deepEqual(downloaded, fixture.snapshot)
  assert.ok(downloaded.meshData[fixture.meshId])
  assert.equal(downloaded.customParts[0].geometry.outline.w, 20)
  checked++

  await viewer.getByRole('button', { name: 'Open a copy', exact: true }).click()
  const confirm = viewer.getByRole('dialog')
  await confirm.waitFor()
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(
    await viewer.evaluate(
      () => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name,
    ),
    fixture.old.name,
  )
  assert.equal(await viewer.getByText('View only', { exact: true }).count(), 1)
  checked++
  await viewer.getByRole('button', { name: 'Open a copy', exact: true }).click()
  await confirm.getByRole('button', { name: 'Open', exact: true }).click()
  await viewer.waitForFunction(
    (name) => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name === name,
    fixture.snapshot.name,
  )
  assert.equal(await viewer.locator('.shared-view').count(), 0)
  assert.equal(await viewer.evaluate(() => location.hash), '')
  const accepted = await viewer.evaluate(() => ({
    aside: JSON.parse(localStorage.getItem('openkitcad.autosave.v2.unopened')).doc,
    parts: JSON.parse(localStorage.getItem('openkitcad.userparts.v1')),
  }))
  assert.deepEqual(accepted.aside, fixture.old)
  assert.equal(
    accepted.parts.find((part) => part.id === fixture.conflicting.id).geometry.outline.w,
    99,
  )
  assert.ok(
    accepted.parts.some(
      (part) => part.id !== fixture.conflicting.id && part.geometry.outline.w === 20,
    ),
  )
  checked++

  const mobile = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const narrow = await mobile.newPage()
  lastPage = narrow
  await observe(narrow)
  await narrow.goto('http://127.0.0.1:4277/' + new URL(link).hash)
  await narrow.waitForFunction(() => !document.querySelector('.shared-message'), null, {
    timeout: 60_000,
  })
  assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const mobileButton = await narrow.getByRole('button', { name: 'Download .okc' }).boundingBox()
  assert.ok(mobileButton.width > 80 && mobileButton.x + mobileButton.width <= 390)
  checked++
  await narrow.goto('http://127.0.0.1:4277/#m=1.invalid')
  await narrow.getByRole('button', { name: 'Back to CAD' }).waitFor()
  await narrow.getByRole('button', { name: 'Back to CAD' }).click()
  await narrow.locator('.app-header').waitFor()
  checked++

  const startup = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  })
  await startup.addInitScript(
    (old) =>
      localStorage.setItem('openkitcad.autosave.v2', JSON.stringify({ savedAt: 'now', doc: old })),
    fixture.old,
  )
  let releaseWasm
  let wasmStarted
  const gate = new Promise((resolve) => {
    releaseWasm = resolve
  })
  const started = new Promise((resolve) => {
    wasmStarted = resolve
  })
  await startup.route('**/*.wasm', async (route) => {
    wasmStarted()
    await gate
    await route.continue()
  })
  const switching = await startup.newPage()
  lastPage = switching
  await observe(switching)
  await switching.goto('http://127.0.0.1:4277/')
  await switching.locator('.app-header').waitFor()
  await started
  const legacyView =
    '#d=' +
    Buffer.from(deflateSync(strToU8(JSON.stringify(fixture.snapshot)))).toString('base64url') +
    '&view=1'
  await switching.evaluate((hash) => {
    location.hash = hash
  }, legacyView)
  await switching.getByText('View only', { exact: true }).waitFor()
  releaseWasm()
  await switching.waitForFunction(() => !document.querySelector('.shared-message'), null, {
    timeout: 60_000,
  })
  await switching.waitForTimeout(800)
  assert.equal(await switching.getByRole('dialog').count(), 0)
  assert.equal(
    await switching.evaluate(
      () => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name,
    ),
    fixture.old.name,
  )
  assert.equal(await switching.evaluate(() => location.hash), legacyView)
  await startup.close()
  checked++

  lastPage = page
  await page.evaluate(() =>
    window.__okc.store.getState().setDoc({
      ...window.__okc.store.getState().doc,
      name: Array.from({ length: 2000 }, () => crypto.randomUUID()).join(''),
    }),
  )
  await page.waitForFunction(() => !window.__okc.store.getState().building)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await dialog.getByText(/too large for a reliable link/).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Copy link' }).count(), 0)
  await dialog.getByRole('button', { name: 'Save .okc file' }).waitFor()
  checked++
  assert.deepEqual(crashes, [])
  assert.deepEqual(uploads, [])
  console.log(`PASS ${checked}/${checked} sharing UI scenarios; no uploads`)
} catch (error) {
  if (lastPage) {
    console.error((await lastPage.locator('body').innerText()).slice(0, 1800))
    await lastPage.screenshot({ path: 'dist/share-test-failure.png' }).catch(() => {})
  }
  for (const crash of crashes) console.error(crash)
  throw error
} finally {
  await browser?.close()
  await dev.close()
  await production.close()
}
