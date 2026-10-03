import { createServer } from 'vite'
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4282, strictPort: true, open: false },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch(
    process.env.OKC_TEST_BROWSER ? { executablePath: process.env.OKC_TEST_BROWSER } : {},
  )
  const results = []
  for (const [size, linked] of [
    [100, false],
    [300, false],
    [100, true],
    [300, true],
  ]) {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    page.setDefaultTimeout(300000)
    await page.goto('http://127.0.0.1:4282/')
    await page.waitForFunction(() => window.__okc?.store.getState().kernelReady)
    results.push(
      await page.evaluate(
        async ([count, linked]) => {
          const { emptyDocument } = await import('/src/doc/types.ts')
          const { kernel } = await import('/src/kernel/api.ts')
          const api = kernel()
          const doc = emptyDocument(`Benchmark ${count}`)
          for (let index = 0; index < count; index++) {
            const bodyId = `part-${index}`
            doc.components[0].bodies.push({
              id: bodyId,
              name: `Block ${index + 1}`,
              colour: '#4783bc',
              visible: true,
            })
            doc.timeline.push({
              id: `box-${index}`,
              kind: 'box',
              name: `Block ${index + 1}`,
              componentId: 'root',
              plane: { kind: 'named', name: 'XY', offset: 0 },
              origin: [(index % 20) * 16, Math.floor(index / 20) * 12],
              width: 12,
              depth: 8,
              height: 4,
              result: { kind: 'newBody', bodyId },
            })
          }
          if (linked) {
            doc.components[0].bodies = [
              { id: 'plate', name: 'Drilled plate', colour: '#4783bc', visible: true },
            ]
            doc.timeline = [
              {
                ...doc.timeline[0],
                width: 340,
                depth: 240,
                origin: [0, 0],
                result: { kind: 'newBody', bodyId: 'plate' },
              },
            ]
            for (let index = 0; index < count - 1; index++)
              doc.timeline.push({
                id: `hole-${index}`,
                kind: 'hole',
                name: `Hole ${index + 1}`,
                componentId: 'root',
                bodyId: 'plate',
                plane: { kind: 'named', name: 'XY', offset: 4 },
                source: {
                  kind: 'explicit',
                  positions: [[10 + (index % 20) * 16, 10 + Math.floor(index / 20) * 14]],
                },
                diameter: 3,
                depth: 'through',
                style: 'simple',
              })
          }
          const known = new Set()
          const timings = []
          async function measure(operation, run) {
            const started = performance.now()
            const result = await run()
            if (result.errors.some((error) => error.severity === 'error'))
              throw new Error(JSON.stringify(result.errors))
            for (const mesh of result.meshes) known.add(mesh.key)
            timings.push({
              operation,
              roundTripMs: Math.round(performance.now() - started),
              kernelMs: result.elapsedMs,
              cache: result.cache,
            })
          }
          await measure('cold', () => api.evaluate(doc, []))
          await measure('unchanged', () => api.evaluate(doc, [...known]))
          const early = structuredClone(doc)
          early.timeline[0].width = linked ? 352 : 13
          await measure('edit first dimension', () => api.evaluate(early, [...known]))
          const late = structuredClone(early)
          if (linked) late.timeline[count - 1].diameter = 3.5
          else late.timeline[count - 1].height = 5
          await measure('edit last dimension', () => api.evaluate(late, [...known]))
          await measure('undo last edit', () => api.evaluate(early, [...known]))
          await measure('redo last edit', () => api.evaluate(late, [...known]))
          const frames = []
          for (let index = 0; index < 10; index++) {
            const feature = {
              ...late.timeline[count - 1],
              ...(linked ? { diameter: 3.5 + index / 10 } : { height: 5 + index / 10 }),
            }
            const started = performance.now()
            const result = await api.preview(
              { doc: late, features: [feature], insertAt: count - 1, replaceFeatureId: feature.id },
              [...known],
            )
            if (result.errors.some((error) => error.severity === 'error'))
              throw new Error(JSON.stringify(result.errors))
            for (const mesh of result.meshes) known.add(mesh.key)
            frames.push(Math.round(performance.now() - started))
          }
          return {
            features: count,
            geometry: linked
              ? '340 × 240 × 4 mm plate with sequential 3 mm through holes'
              : 'Independent 12 × 8 × 4 mm blocks in a grid',
            timings,
            previewFramesMs: frames,
          }
        },
        [size, linked],
      ),
    )
    await context.close()
  }
  const report = {
    recordedAt: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    platform: `${os.platform()} ${os.release()}`,
    browser: browser.version(),
    mode: 'Vite development, geometry worker; no viewport rendering in timings',
    results,
  }
  await writeFile(
    process.env.OKC_BENCHMARK_OUTPUT ?? 'docs/performance-results.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
