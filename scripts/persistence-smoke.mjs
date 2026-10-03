import assert from 'node:assert/strict'
import { preview } from 'vite'
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

function design(name) {
  return {
    format: 'openkitcad',
    version: 2,
    name,
    units: 'mm',
    parameters: [],
    bindings: [],
    rootComponentId: 'root',
    components: [
      {
        id: 'root',
        name,
        source: { kind: 'design' },
        bodies: [{ id: 'solid', name: 'Box', visible: true, colour: '#ffffff' }],
      },
    ],
    occurrences: [],
    marker: null,
    groups: [],
    timeline: [
      {
        id: 'box',
        name: 'Box',
        kind: 'box',
        componentId: 'root',
        plane: { kind: 'named', name: 'XY', offset: 0 },
        origin: [0, 0],
        width: 10,
        depth: 10,
        height: 10,
        result: { kind: 'newBody', bodyId: 'solid' },
      },
    ],
  }
}

const old = design('My unsaved work')
const incoming = design('Incoming design')
const hash =
  '#d=' + Buffer.from(deflateSync(strToU8(JSON.stringify(incoming)))).toString('base64url')
const server = await preview({
  preview: { host: '127.0.0.1', port: 4274, strictPort: true, open: false },
})
let browser
let checked = 0
const crashes = []
try {
  browser = await launch()
  async function openPage(fragment = '', full = false) {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
    })
    await context.addInitScript(
      ({ old, incoming, full }) => {
        localStorage.setItem('openkitcad.autosave.v2', JSON.stringify({ savedAt: 'now', doc: old }))
        window.showOpenFilePicker = async () => [
          {
            getFile: async () =>
              new File([JSON.stringify(incoming)], 'incoming.okc', { type: 'application/json' }),
          },
        ]
        if (full) {
          const setItem = Storage.prototype.setItem
          Storage.prototype.setItem = function (key, value) {
            if (key === 'openkitcad.autosave.v2')
              throw new DOMException('full', 'QuotaExceededError')
            setItem.call(this, key, value)
          }
        }
      },
      { old, incoming, full },
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => crashes.push(String(error)))
    await page.goto(`http://127.0.0.1:4274/${fragment}`)
    return { page, context }
  }
  for (const accept of [false, true]) {
    const { page, context } = await openPage(hash)
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    // Waiting longer than the autosave debounce must not overwrite work while asking.
    await page.waitForTimeout(800)
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name,
      ),
      old.name,
    )
    await dialog.getByRole('button', { name: accept ? 'Open' : 'Cancel', exact: true }).click()
    const wanted = accept ? incoming.name : old.name
    await page.waitForFunction(
      (wanted) => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name === wanted,
      wanted,
    )
    if (accept)
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem('openkitcad.autosave.v2.unopened')).doc.name,
        ),
        old.name,
      )
    checked++
    await context.close()
  }
  for (const accept of [false, true]) {
    const { page, context } = await openPage()
    await page.waitForFunction(() =>
      document.querySelector('.app-header')?.textContent.includes('My unsaved work'),
    )
    await page.getByText('File ▾', { exact: true }).click()
    await page.getByRole('button', { name: /^Open…/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: accept ? 'Open' : 'Cancel', exact: true }).click()
    const wanted = accept ? incoming.name : old.name
    await page.waitForFunction(
      (wanted) => document.querySelector('.app-header')?.textContent.includes(wanted),
      wanted,
    )
    await page.waitForTimeout(800)
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name,
      ),
      wanted,
    )
    checked++
    await context.close()
  }
  const { page, context } = await openPage('', true)
  await page.getByText(/Autosave failed:/).waitFor()
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('openkitcad.autosave.v2')).doc.name),
    old.name,
  )
  checked++
  await context.close()
  assert.deepEqual(crashes, [])
  console.log(`PASS  ${checked}/${checked} persistence UI scenarios`)
} finally {
  await browser?.close()
  await server.close()
}
