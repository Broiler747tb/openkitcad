import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { root, browserOptions } from './runtime.mjs'

const doc = JSON.parse(readFileSync(resolve(root, 'examples/raspberry-pi-enclosure.okc'), 'utf8'))
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 4277, strictPort: true, open: false },
})
await server.listen()
const browser = await chromium.launch(browserOptions)
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.addInitScript((doc) => {
    localStorage.setItem('openkitcad.autosave.v2', JSON.stringify({ savedAt: 'now', doc }))
    localStorage.setItem('okc.theme.v1', 'light')
    localStorage.setItem('okc.language.v1', 'en')
    localStorage.setItem(
      'okc.preferences.v1',
      JSON.stringify({ gridVisible: false, axesVisible: false }),
    )
  }, doc)
  await page.goto('http://127.0.0.1:4277/')
  await page.waitForFunction(
    () =>
      !document.querySelector('.overlay-centre') &&
      window.__okc?.store &&
      !window.__okc.store.getState().building,
    null,
    { timeout: 90000 },
  )
  assert.ok((await page.locator('.app-header').innerText()).includes(doc.name))
  await page.getByTitle('Fit view (Home)').click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve(root, 'docs/images/enclosure-light.png') })
  await page.getByLabel('Colour theme').selectOption('dark')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: resolve(root, 'docs/images/enclosure-dark.png') })
  await page.getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByLabel('Search parts').fill('pi')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: resolve(root, 'docs/images/parts.png') })
  assert.deepEqual(errors, [])
  console.log('Captured the current editor in both themes and the hardware catalogue.')
} finally {
  await browser.close()
  await server.close()
}
