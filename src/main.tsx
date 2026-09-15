import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './workspace.css'
import './fusion.css'
import './android.css'
import type { TestResult } from './dev/selftest'

const root = createRoot(document.getElementById('root')!)
const params = new URLSearchParams(location.search)

// `?selftest` runs the solver and kernel checks instead of the app. Kept in the
// shipped build so a contributor or a bug report can verify the engine on any
// machine without a toolchain.
if (params.has('selftest') || params.has('kerneltest')) {
  const mount = document.getElementById('root')!
  mount.style.cssText =
    'font:13px/1.55 ui-monospace,monospace;color:#e8e2d8;background:#16181b;' +
    'padding:24px;min-height:100vh;box-sizing:border-box;white-space:pre'
  mount.textContent = 'running…'
  const suites: Array<[string, () => Promise<TestResult[]>]> = []
  if (!params.has('kerneltest')) {
    suites.push(
      ['solver', async () => (await import('./dev/selftest')).runSelfTest()],
      ['workflow', async () => (await import('./dev/workflowtest')).runWorkflowTest()],
      ['precision', async () => (await import('./dev/precisiontest')).runPrecisionTest()],
      ['workshop', async () => (await import('./dev/powertest')).runPowerTest()],
      ['parameters', async () => (await import('./dev/parametertest')).runParameterTest()],
    )
  }
  suites.push(
    ['model', async () => (await import('./dev/modeltest')).runModelTest()],
    ['kernel', async () => (await import('./dev/kerneltest')).runKernelTest()],
  )
  ;(async () => {
    const results: TestResult[] = []
    for (const [name, suite] of suites) {
      try {
        results.push(...(await suite()))
      } catch (error) {
        results.push({ name: `${name} suite crashed`, pass: false, detail: String(error) })
      }
    }
    ;(window as any).__okc_tests = results
    const failed = results.filter((r) => !r.pass)
    mount.textContent =
      `${failed.length ? 'FAIL' : 'PASS'}  ${results.length - failed.length}/${results.length}\n\n` +
      results.map((r) => `${r.pass ? ' ok ' : 'FAIL'}  ${r.name}\n        ${r.detail}`).join('\n')
  })()
} else {
  if (import.meta.env.DEV) {
    // Handy for poking at state from the console during development.
    import('./doc/store').then((m) => {
      ;(window as any).__okc = { store: m.useStore }
    })
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
