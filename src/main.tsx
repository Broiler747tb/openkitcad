import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// `?selftest` runs the solver and kernel checks instead of the app. Kept in the
// shipped build so a contributor or a bug report can verify the engine on any
// machine without a toolchain.
if (new URLSearchParams(location.search).has('selftest')) {
  const mount = document.getElementById('root')!
  mount.style.cssText =
    'font:13px/1.55 ui-monospace,monospace;color:#e8e2d8;background:#16181b;' +
    'padding:24px;min-height:100vh;box-sizing:border-box;white-space:pre'
  mount.textContent = 'running…'
  Promise.all([import('./dev/selftest'), import('./dev/kerneltest')]).then(
    async ([selftest, kerneltest]) => {
      const results = [...selftest.runSelfTest(), ...(await kerneltest.runKernelTest())]
      ;(window as any).__okc_tests = results
      const failed = results.filter((r) => !r.pass)
      mount.textContent =
        `${failed.length ? 'FAIL' : 'PASS'}  ${results.length - failed.length}/${results.length}\n\n` +
        results
          .map((r) => `${r.pass ? ' ok ' : 'FAIL'}  ${r.name}\n        ${r.detail}`)
          .join('\n')
    },
  )
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
