import { preview } from 'vite'
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root, output, browserOptions } from './runtime.mjs'
const server = await preview({
  root,
  preview: { host: '127.0.0.1', port: 4275, strictPort: true, open: false },
})
const expectedParts = JSON.parse(
  readFileSync(resolve(output, 'mechanical-audit.json'), 'utf8'),
).parts
const browser = await chromium.launch(browserOptions)
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(String(e))
    console.log('PAGE ERROR: ' + e)
  })
  await page.addInitScript(() => {
    window.showOpenFilePicker = undefined
    localStorage.setItem('okc.theme.v1', 'dark')
    localStorage.setItem(
      'okc.preferences.v1',
      JSON.stringify({ gridVisible: false, axesVisible: false }),
    )
  })
  await page.goto('http://127.0.0.1:4275/')
  await page
    .waitForFunction(
      () => !document.querySelector('.overlay-centre') && document.querySelector('.app-header'),
      null,
      { timeout: 90000 },
    )
    .catch(async (error) => {
      await page.screenshot({ path: resolve(output, 'app-boot-failure.png') })
      console.log(
        JSON.stringify({
          pageErrors: errors,
          body: (await page.locator('body').innerText()).slice(0, 1800),
          debug: await page.evaluate(() => !!window.__okc),
        }),
      )
      throw error
    })
  await page.locator('.file-menu summary').click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Open…/ }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(resolve(output, 'printer.okc'))
  await page.waitForFunction(
    () =>
      document
        .querySelector('.app-header')
        ?.textContent.includes('OpenKitCAD Cartesian 3D printer') &&
      document.querySelector('.statusbar')?.textContent.includes('Ready'),
    null,
    { timeout: 180000 },
  )
  await page.getByTitle('Fit view (Home)').click()
  await page.waitForTimeout(1500)
  const report = {
    title: await page.locator('.app-header').innerText(),
    status: await page.locator('.statusbar').innerText(),
  }
  await page.screenshot({ path: resolve(output, 'printer-openkitcad.png') })
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForFunction(
    (count) =>
      !document.querySelector('.overlay-centre') &&
      document.querySelector('.statusbar')?.textContent.includes(count + ' shapes'),
    expectedParts,
    { timeout: 90000 },
  )
  report.restoredAfterReload = true
  writeFileSync(
    resolve(output, 'openkitcad-verification.json'),
    JSON.stringify({ ...report, pageErrors: errors }, null, 2),
  )
  console.log(JSON.stringify({ ...report, pageErrors: errors }))
  if (errors.length) process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
