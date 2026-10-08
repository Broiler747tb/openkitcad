import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { preview } from 'vite'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const server = await preview({
  root,
  preview: { host: '127.0.0.1', port: 4293, strictPort: true, open: false },
})
let browser
try {
  let launchError
  for (const channel of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      browser = await chromium.launch(
        channel ? (/[\\/]/.test(channel) ? { executablePath: channel } : { channel }) : {},
      )
      break
    } catch (error) {
      launchError = error
    }
  }
  if (!browser) throw launchError
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto('http://127.0.0.1:4293/')
  assert.equal(await page.evaluate(() => typeof window.openkitcad), 'undefined')
  await page.goto('http://127.0.0.1:4293/?agent=1')
  await page.waitForFunction(() => window.openkitcad)
  const call = (method, args = {}) =>
    page.evaluate(({ method, args }) => window.openkitcad.request({ method, args }), {
      method,
      args,
    })
  const ok = async (method, args) => {
    const result = await call(method, args)
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
  const fail = async (method, args, code) => {
    const result = await call(method, args)
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.equal(result.error.code, code, JSON.stringify(result))
  }
  const idle = async () => {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const result = await ok('inspect')
      if (result.ready) return result
      await page.waitForTimeout(50)
    }
    throw new Error('Build did not finish.')
  }
  let model = await idle()
  await page.evaluate(async () => {
    const state = await window.openkitcad.request({ method: 'inspect' })
    state.data.components[0].name = 'Changed outside the API'
  })
  assert.equal((await ok('inspect')).components[0].name, model.components[0].name)
  assert.equal(await page.evaluate(() => typeof window.__okc), 'undefined')
  const commands = await ok('commands')
  assert.ok(commands.some((command) => command.id === 'box'))
  assert.ok(commands.some((command) => command.id === 'enclosure'))
  const parts = await ok('catalogue', { query: 'm5stack' })
  assert.equal(parts.length, 8)
  assert.equal(parts.find((part) => part.id === 'm5stack-stamp-s3').size.z, 4.7)
  assert.equal(parts.find((part) => part.id === 'm5stack-stamp-s3').footprint.z, 1)
  assert.equal((await ok('catalogue', { query: 'м5 стак' })).length, 8)
  for (const part of parts) {
    const detail = await ok('part', { id: part.id })
    assert.equal(detail.manufacturer, 'M5Stack')
    assert.equal(detail.confidence, 'approximate')
    assert.deepEqual(detail.mountingHoles, [])
  }
  await fail(
    'preview',
    { revision: model.revision, operations: [{ command: 'box', args: { length: -1 } }] },
    'COMMAND_INVALID',
  )
  await fail(
    'preview',
    { revision: model.revision, operations: [{ command: 'box', args: { widthh: 30 } }] },
    'INVALID_INPUT',
  )
  await fail(
    'preview',
    { revision: model.revision, operations: [{ command: 'box', args: { operation: 'typo' } }] },
    'INVALID_INPUT',
  )
  await fail(
    'preview',
    { revision: model.revision, operations: [{ command: 'box', args: { height: true } }] },
    'INVALID_INPUT',
  )
  await fail(
    'preview',
    { revision: model.revision, operations: [{ command: 'box', edit: '' }] },
    'INVALID_INPUT',
  )
  await fail(
    'preview',
    { revision: model.revision - 1, operations: [{ command: 'box' }] },
    'REVISION_CONFLICT',
  )
  let trial = await ok('preview', {
    revision: model.revision,
    operations: [
      { command: 'box', as: 'base', args: { length: 40, width: 30, height: 3.123456 } },
      {
        command: 'box',
        args: {
          x: 37,
          length: 3,
          width: 30,
          height: 30,
          operation: 'join',
          bodies: [{ kind: 'body', id: '@base' }],
        },
      },
    ],
  })
  assert.equal((await ok('inspect')).features.length, 0)
  assert.equal(trial.geometry.length, 1)
  assert.ok(
    Math.abs(trial.geometry[0].volume - (40 * 30 * 3.123456 + 3 * 30 * (30 - 3.123456))) < 0.01,
  )
  for (const view of ['iso', 'front', 'top']) {
    const shot = await ok('snapshot', { token: trial.token, view })
    assert.ok(shot.dataUrl.startsWith('data:image/png;base64,'))
    if (process.env.OKC_AGENT_SCREENSHOT && view === 'iso')
      await fs.writeFile(
        process.env.OKC_AGENT_SCREENSHOT,
        Buffer.from(shot.dataUrl.split(',')[1], 'base64'),
      )
  }
  await ok('apply', { token: trial.token })
  model = await idle()
  assert.equal(model.features.length, 2)
  await fail('apply', { token: trial.token }, 'STALE_PREVIEW')
  const baseId = trial.aliases.base.features[0]
  assert.equal((await ok('feature', { id: baseId })).feature.height, 3.123456)
  const elements = await ok('geometry', { bodyId: trial.aliases.base.bodies[0] })
  assert.ok(elements[0].faces.length >= 6)
  assert.ok(
    elements[0].faces.some((face) => face.planar && face.normal?.[2] > 0.99 && face.area > 0),
  )
  await fail('feature', { name: 'Box' }, 'AMBIGUOUS_REFERENCE')
  await fail(
    'preview',
    {
      revision: model.revision,
      operations: [
        {
          command: 'fillet',
          args: { edges: [{ kind: 'body', id: trial.aliases.base.bodies[0] }], radius: 200 },
        },
      ],
    },
    'GEOMETRY_INVALID',
  )
  trial = await ok('preview', {
    revision: model.revision,
    operations: [{ command: 'box', edit: baseId, args: { length: 45 } }],
  })
  assert.equal(trial.aliases.base, undefined)
  await ok('apply', { token: trial.token })
  model = await idle()
  const edited = await ok('feature', { id: baseId })
  assert.equal(edited.feature.width, 45)
  assert.equal(edited.feature.height, 3.123456)
  await ok('undo', { revision: model.revision })
  model = await idle()
  assert.equal((await ok('feature', { id: baseId })).feature.width, 40)
  await ok('undo', { revision: model.revision })
  model = await idle()
  assert.equal(model.features.length, 0)
  await ok('redo', { revision: model.revision })
  model = await idle()
  assert.equal(model.features.length, 2)
  trial = await ok('preview', {
    revision: model.revision,
    operations: [{ command: 'box', args: { x: 100 } }],
  })
  await ok('undo', { revision: model.revision })
  model = await idle()
  await fail('apply', { token: trial.token }, 'STALE_PREVIEW')
  const sizes = {
    'm5stack-atom-lite': [24, 24, 9.5],
    'm5stack-atoms3-lite': [24, 24, 9.5],
    'm5stack-atoms3': [24, 24, 12.9],
    'm5stack-stickc-plus2': [24, 48, 13.5],
    'm5stack-core2': [54, 54, 16.5],
    'm5stack-cores3': [54, 54, 15.5],
    'm5stack-cardputer': [84, 54, 19.7],
    'm5stack-stamp-s3': [18, 25.96, 4.7],
  }
  trial = await ok('preview', {
    revision: model.revision,
    operations: parts.map((part, i) => ({ partId: part.id, at: [i * 120, 0, 0], as: 'part' + i })),
  })
  assert.equal(trial.geometry.length, 8)
  for (const [i, part] of parts.entries()) {
    const occurrence = trial.aliases['part' + i].occurrence
    const geometry = trial.geometry.find((item) => item.id.includes(occurrence))
    assert.ok(geometry, JSON.stringify(trial))
    assert.ok(geometry.volume > 0)
    const bounds = geometry.bounds
    const size = [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]]
    sizes[part.id].forEach((dimension, axis) =>
      assert.ok(Math.abs(size[axis] - dimension) < 0.1, `${part.id}: ${size}`),
    )
  }
  await ok('apply', { token: trial.token })
  model = await idle()
  assert.equal(model.geometry.length, 8, JSON.stringify(model))
  const measurement = await ok('measure', { a: model.geometry[0].id, b: model.geometry[1].id })
  assert.ok(measurement.distance > 0)
  const occurrence = model.occurrences.find((item) => item.name.includes('AtomS3 Lite'))
  trial = await ok('preview', {
    revision: model.revision,
    operations: [
      {
        command: 'enclosure',
        args: { parts: [{ kind: 'occurrence', id: occurrence.id }], protrudingConnectors: true },
      },
    ],
  })
  assert.ok(trial.geometry.length >= 10)
  await ok('cancel', { token: trial.token })
  await fail('apply', { token: trial.token }, 'STALE_PREVIEW')
  const inch = await browser.newPage()
  await inch.addInitScript(() => {
    const doc = {
      format: 'openkitcad',
      version: 2,
      name: 'Agent inches',
      units: 'in',
      rootComponentId: 'root',
      components: [
        {
          id: 'root',
          name: 'Agent inches',
          source: { kind: 'design' },
          bodies: [{ id: 'bound-body', name: 'Bound box', visible: true, colour: '#aabbcc' }],
        },
      ],
      occurrences: [],
      timeline: [
        {
          id: 'bound-box',
          kind: 'box',
          name: 'Bound box',
          componentId: 'root',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          origin: [0, 0],
          width: 40,
          depth: 30,
          height: 3.123456,
          result: { kind: 'newBody', bodyId: 'bound-body' },
        },
      ],
      marker: null,
      groups: [],
      parameters: [{ id: 'p-wall', name: 'wall', value: 40 }],
      bindings: [{ featureId: 'bound-box', field: 'width', expression: 'wall' }],
    }
    localStorage.setItem(
      'openkitcad.autosave.v2',
      JSON.stringify({ savedAt: new Date().toISOString(), doc }),
    )
  })
  await inch.goto('http://127.0.0.1:4293/?agent=1')
  await inch.waitForFunction(() => window.openkitcad)
  const inchCall = (method, args = {}) =>
    inch.evaluate(({ method, args }) => window.openkitcad.request({ method, args }), {
      method,
      args,
    })
  let initial
  for (let i = 0; i < 2400; i++) {
    initial = await inchCall('inspect')
    if (initial.ok && initial.data.ready) break
    await inch.waitForTimeout(50)
  }
  assert.equal(initial.data.units, 'in')
  let updated = await inchCall('preview', {
    revision: initial.revision,
    operations: [{ command: 'box', edit: 'bound-box', args: { height: 12.123456 } }],
  })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  assert.equal((await inchCall('apply', { token: updated.data.token })).ok, true)
  let after
  for (let i = 0; i < 2400; i++) {
    after = await inchCall('inspect')
    if (after.ok && after.data.ready) break
    await inch.waitForTimeout(50)
  }
  assert.equal(after.data.bindings.length, 1)
  const bound = await inchCall('feature', { id: 'bound-box' })
  assert.equal(bound.data.feature.height, 12.123456)
  assert.equal(bound.data.feature.width, 40)
  updated = await inchCall('preview', {
    revision: after.revision,
    operations: [{ command: 'box', edit: 'bound-box', args: { length: '1 in' } }],
  })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  assert.equal((await inchCall('apply', { token: updated.data.token })).ok, true)
  assert.equal((await inchCall('inspect')).data.bindings.length, 0)
  assert.equal((await inchCall('feature', { id: 'bound-box' })).data.feature.width, 25.4)
  await inch.close()
  assert.deepEqual(errors, [])
  console.log(
    'Agent production API passed: schema errors, revision guards, isolated previews, batch Undo/Redo, precision edits, measurements, 3-view images and 8 M5Stack solids/enclosure.',
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
