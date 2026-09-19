import { preview } from 'vite'
import { chromium } from 'playwright'

const TIMEOUT_MS = Number(process.env.OKC_TEST_TIMEOUT ?? 600000)
const suites = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const query = suites.length ? `?selftest&suite=${suites.join(',')}` : '?selftest'

async function launch() {
  const browsers = [undefined, ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(',')]
  let last = null
  for (const browser of browsers) {
    try {
      return await chromium.launch(
        !browser ? {} : /[\\/]/.test(browser) ? { executablePath: browser } : { channel: browser },
      )
    } catch (error) {
      last = error
    }
  }
  throw new Error(
    `No Chromium to test in. Run "npx playwright install chromium", install Edge or Chrome, or set OKC_TEST_BROWSER to the path of a chrome.exe.\n${last?.message ?? ''}`,
  )
}

const server = await preview({ preview: { port: 4273, strictPort: true, open: false } })
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:4273/`
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const crashes = []
page.on('pageerror', (error) => crashes.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') crashes.push(message.text())
})

let results = []
let failure = null
try {
  await page.goto(new URL(query, base).href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__okc_tests !== undefined, null, {
    timeout: TIMEOUT_MS,
    polling: 500,
  })
  results = await page.evaluate(() => window.__okc_tests)
} catch (error) {
  failure = error
} finally {
  await browser.close()
  await server.close()
}

if (failure) {
  console.error(`The suite did not finish: ${failure.message}`)
  for (const crash of crashes.slice(0, 20)) console.error(`  ${crash}`)
  process.exit(1)
}

const failed = results.filter((result) => !result.pass)
const skipped = results.filter((result) => result.skipped)
for (const result of failed) console.error(`FAIL  ${result.name}\n      ${result.detail}`)
for (const result of skipped) console.log(`skip  ${result.name}\n      ${result.detail}`)
console.log(
  `${failed.length ? 'FAIL' : 'PASS'}  ${results.length - failed.length - skipped.length}/${results.length - skipped.length}` +
    `${skipped.length ? `  (${skipped.length} skipped)` : ''}`,
)
process.exit(failed.length ? 1 : 0)
