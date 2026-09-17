import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './theme/tokens.css'
import './styles.css'
import './workspace.css'
import './fusion.css'
import './android.css'
import './ui/command/command.css'
import './ui/timeline.css'
import type { TestResult } from './dev/selftest'
import { initTheme } from './theme/theme'

initTheme()

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
      ['commands', async () => (await import('./dev/commandtest')).runCommandTest()],
      ['sketch', async () => (await import('./dev/sketchtest')).runSketchTest()],
      ['ui', async () => (await import('./dev/uitest')).runUiTest()],
      ['joints', async () => (await import('./dev/jointtest')).runJointTest()],
      ['assembly', async () => (await import('./dev/assemblytest')).runAssemblyTest()],
      ['mesh', async () => (await import('./dev/meshtest')).runMeshTest()],
      ['meshCommands', async () => (await import('./dev/meshcommandtest')).runMeshCommandTest()],
      ['parts', async () => (await import('./dev/partstest')).runPartsTest()],
      [
        'createCommands',
        async () => (await import('./dev/createcommandtest')).runCreateCommandTest(),
      ],
    )
  }
  suites.push(
    ['model', async () => (await import('./dev/modeltest')).runModelTest()],
    ['naming', async () => (await import('./dev/namingtest')).runNamingTest()],
    ['kernel', async () => (await import('./dev/kerneltest')).runKernelTest()],
    ['solids', async () => (await import('./dev/solidtest')).runSolidTest()],
    ['fits', async () => (await import('./dev/fittest')).runFitTest()],
    ['text', async () => (await import('./dev/texttest')).runTextTest()],
    ['walls', async () => (await import('./dev/walltest')).runWallTest()],
    ['cables', async () => (await import('./dev/cabletest')).runCableTest()],
  )
  const only = params.get('suite')?.split(',').filter(Boolean)
  ;(async () => {
    const results: TestResult[] = []
    for (const [name, suite] of suites) {
      if (only?.length && !only.includes(name)) continue
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
  import('./assembly/follow').then((m) => m.followGeometry())
  if (import.meta.env.DEV) {
    // Handy for poking at state from the console during development.
    Promise.all([import('./doc/store'), import('./sketch/fonts')]).then(([m, fonts]) => {
      ;(window as any).__okc = { store: m.useStore, fonts }
    })
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
