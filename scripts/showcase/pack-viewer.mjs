import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root, output, renderResolve } from './runtime.mjs'

// One HTML file, including geometry and JavaScript. No CDN or server required.
const result = await build({
  configFile: false,
  root,
  resolve: renderResolve(),
  define: { __SHOWCASE_TRACING__: 'false' },
  build: {
    write: false,
    target: 'esnext',
    lib: { entry: resolve(root, 'scripts/showcase/viewer.mjs'), formats: ['es'] },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
const bundle = Array.isArray(result) ? result[0] : result
const code = bundle.output.find((o) => o.type === 'chunk' && o.isEntry).code
const compressed = gzipSync(readFileSync(resolve(output, 'printer-scene.json'))).toString('base64')
const bootstrap = `
const bytes = Uint8Array.from(atob('${compressed}'), c => c.charCodeAt(0));
window.__PRINTER_SCENE__ = JSON.parse(await new Response(
  new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
).text());
`
const html = readFileSync(resolve(root, 'scripts/showcase/viewer.html'), 'utf8').replace(
  '<script type="module" src="./viewer.mjs"></script>',
  `<script type="module">${bootstrap}${code.replaceAll('</script', '<\\/script')}</script>`,
)
writeFileSync(resolve(output, 'OpenKitCAD-3D-printer.html'), html)
console.log('Saved standalone viewer.')
