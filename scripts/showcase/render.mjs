import { createServer } from 'vite'
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root, output, browserOptions, renderResolve } from './runtime.mjs'
const trace = process.argv.includes('--trace')
const server = await createServer({
  configFile: false,
  root,
  resolve: renderResolve(),
  server: {
    host: '127.0.0.1',
    port: 4276,
    strictPort: true,
    hmr: false,
    watch: null,
    fs: { allow: [root, resolve(root, '..'), process.env.SHOWCASE_DEPENDENCIES || root] },
  },
  plugins: [
    {
      name: 'showcase-assets',
      configureServer(server) {
        server.middlewares.use('/printer-scene.json', (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(readFileSync(resolve(output, 'printer-scene.json')))
        })
      },
    },
  ],
})
await server.listen()
const browser = await chromium.launchPersistentContext(resolve(output, 'render-browser-cache'), {
  headless: true,
  ...browserOptions,
})
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: trace ? 1280 : 1600, height: trace ? 1120 : 1400 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(
    'http://127.0.0.1:4276/scripts/showcase/viewer.html?capture' + (trace ? '&trace' : ''),
  )
  await page.waitForFunction(() => window.printerReady, null, { timeout: 600000 })
  for (const view of trace ? ['home'] : ['home', 'back', 'head', 'bed']) {
    await page.evaluate((name) => window.printer.view(name), view)
    if (trace) {
      for (let i = 0; i < 60; i++) {
        const count = await page.evaluate(() => window.printer.tracer.samples)
        console.log('Path tracing: ' + count.toFixed(1) + ' samples')
        if (count >= 384) break
        await page
          .waitForFunction(() => window.printer.tracer.samples >= 384, null, { timeout: 30000 })
          .catch(() => {})
      }
    } else await page.waitForTimeout(1500)
    await page.screenshot({
      path: resolve(output, 'printer-' + view + (trace ? '-trace' : '') + '.png'),
    })
  }
  if (process.argv.includes('--glb'))
    writeFileSync(
      resolve(output, 'OpenKitCAD-3D-printer.glb'),
      Buffer.from(await page.evaluate(() => window.printer.exportGlb()), 'base64'),
    )
  console.log(
    JSON.stringify({
      errors,
      renderer: await page.evaluate(() => {
        const g = window.printer.renderer.getContext()
        return g.getParameter(g.RENDERER)
      }),
    }),
  )
} finally {
  await browser.close()
  await server.close()
}
