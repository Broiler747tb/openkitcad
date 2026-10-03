import { chromium } from 'playwright'
import { copyFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, output, browserOptions } from './runtime.mjs'

copyFileSync(resolve(output, 'printer-home-trace.png'), resolve(root, 'docs/images/printer.png'))
const browser = await chromium.launch(browserOptions)
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  })
  await page.goto(pathToFileURL(resolve(root, 'docs/social-preview.html')).href)
  await page.locator('.model').evaluate((img) => img.decode())
  await page.screenshot({ path: resolve(root, 'docs/images/social-preview.png') })
  copyFileSync(
    resolve(root, 'docs/images/social-preview.png'),
    resolve(output, 'OpenKitCAD-social-preview.png'),
  )
  console.log(
    JSON.stringify({
      width: 1280,
      height: 640,
      bytes: statSync(resolve(root, 'docs/images/social-preview.png')).size,
    }),
  )
} finally {
  await browser.close()
}
