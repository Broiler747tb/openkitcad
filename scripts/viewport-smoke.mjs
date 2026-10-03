import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4283, strictPort: true, open: false },
})
let browser
let page
const failures = []
async function align(direction) {
  await page.evaluate(
    (direction) => window.dispatchEvent(new CustomEvent('okc:view', { detail: direction })),
    direction,
  )
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
}
async function screen(point) {
  return page.evaluate((point) => window.__okcEngine.toScreen(point), point)
}
try {
  await server.listen()
  let launchError
  for (const executable of [
    undefined,
    ...(process.env.OKC_TEST_BROWSER ?? 'msedge,chrome').split(','),
  ]) {
    try {
      browser = await chromium.launch(
        !executable
          ? {}
          : /[\\/]/.test(executable)
            ? { executablePath: executable }
            : { channel: executable },
      )
      break
    } catch (error) {
      launchError = error
    }
  }
  if (!browser) throw launchError
  page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => failures.push(String(error)))
  await page.goto('http://127.0.0.1:4283/')
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady && window.__okcEngine)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const doc = emptyDocument('Picking regression')
    doc.components[0].bodies = ['rear', 'front'].map((id) => ({
      id,
      name: id,
      colour: '#4783bc',
      visible: true,
    }))
    doc.timeline = ['rear', 'front'].map((bodyId, index) => ({
      id: bodyId,
      kind: 'box',
      name: bodyId,
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: index * 20 },
      origin: index ? [-10, -10] : [0, 0],
      width: index ? 40 : 20,
      depth: index ? 40 : 20,
      height: index ? 4 : 10,
      result: { kind: 'newBody', bodyId },
    }))
    window.__okc.store.getState().setDoc(doc)
  })
  await page.waitForFunction(
    () =>
      !window.__okc.store.getState().building &&
      window.__okc.store.getState().instances.length === 2,
  )
  await page.evaluate(() => window.__okcEngine.frameAll())
  await align('top')
  const hidden = await screen([0, 0, 10])
  const picked = await page.evaluate(([x, y]) => window.__okcEngine.pickSub(x, y), hidden)
  assert.equal(picked.bodyId, 'front')
  assert.equal(picked.kind, 'face')
  const cutPick = await page.evaluate(([x, y]) => {
    window.__okcEngine.setSection(true, 'z', 15, false)
    const pick = window.__okcEngine.pickSub(x, y)
    window.__okcEngine.setSection(false, 'z', 15, false)
    return pick
  }, hidden)
  assert.equal(cutPick.bodyId, 'rear')
  assert.equal(cutPick.kind, 'vertex')
  await page.mouse.click(...hidden)
  assert.equal(
    await page.evaluate(() => window.__okc.store.getState().subSelection[0].bodyId),
    'front',
  )
  await page.evaluate(() => window.__okc.store.getState().updateBody('front', { visible: false }))
  await page.waitForFunction(() => !window.__okc.store.getState().building)
  await page.waitForFunction(
    ([x, y]) => window.__okcEngine.pickSub(x, y)?.bodyId === 'rear',
    hidden,
  )
  const revealed = await page.evaluate(([x, y]) => window.__okcEngine.pickSub(x, y), hidden)
  assert.equal(revealed.kind, 'vertex')
  await page.evaluate(() => window.__okc.store.getState().updateBody('front', { visible: true }))
  await page.waitForFunction(() => !window.__okc.store.getState().building)
  await page.waitForFunction(
    ([x, y]) => window.__okcEngine.pickSub(x, y)?.bodyId === 'front',
    hidden,
  )
  const outside = await screen([-10, -10, 24])
  await page.mouse.click(outside[0] - 2, outside[1] + 2)
  assert.equal(
    await page.evaluate(() => window.__okc.store.getState().subSelection[0].kind),
    'vertex',
  )
  assert.equal(await page.evaluate(() => window.__okc.store.getState().selection.id), 'front')

  await page.getByRole('button', { name: 'Measure', exact: true }).first().click()
  const a = await screen([-10, -10, 24])
  const b = await screen([30, -10, 24])
  await page.mouse.click(...a)
  await page.mouse.click(...b)
  const measured = await page.evaluate(() => window.__okc.store.getState().measure)
  assert.deepEqual(measured, { a: [-10, -10, 24], b: [30, -10, 24] })
  assert.equal(await page.getByLabel('Distance', { exact: true }).innerText(), '40 mm')
  await page.getByRole('button', { name: 'New measurement', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__okc.store.getState().measure), {
    a: null,
    b: null,
  })
  await page
    .getByRole('region', { name: 'Measurement', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()

  const worldCorners = await page.evaluate(async () => {
    const doc = structuredClone(window.__okc.store.getState().doc)
    const front = doc.components[0].bodies.find((body) => body.id === 'front')
    doc.components[0].bodies = doc.components[0].bodies.filter((body) => body.id !== 'front')
    doc.components.push({
      id: 'child',
      name: 'Placed component',
      source: { kind: 'design' },
      bodies: [front],
    })
    doc.timeline.find((feature) => feature.id === 'front').componentId = 'child'
    const angle = Math.PI / 6
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const transform = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 80, 30, 5, 1]
    doc.occurrences = [
      {
        id: 'placed',
        parentComponentId: 'root',
        componentId: 'child',
        name: 'Placed front',
        transform,
        visible: true,
        grounded: false,
      },
    ]
    window.__okc.store.getState().setDoc(doc)
    const { transformPoint } = await import('/src/doc/model.ts')
    return [
      [-10, -10, 24],
      [30, -10, 24],
    ].map((point) => transformPoint(transform, point))
  })
  await page.waitForFunction(
    () =>
      !window.__okc.store.getState().building &&
      window.__okc.store.getState().instances.some((instance) => instance.path.includes('placed')),
  )
  await align('top')
  await page.evaluate(() => window.__okcEngine.frameAll())
  await page.getByRole('button', { name: 'Measure', exact: true }).first().click()
  for (const point of worldCorners) await page.mouse.click(...(await screen(point)))
  const placedMeasure = await page.evaluate(() => window.__okc.store.getState().measure)
  for (const [index, point] of [placedMeasure.a, placedMeasure.b].entries())
    for (const [axis, value] of point.entries())
      assert.ok(Math.abs(value - worldCorners[index][axis]) < 1e-5)
  assert.equal(await page.getByLabel('Distance', { exact: true }).innerText(), '40 mm')
  if (process.env.OKC_VIEWPORT_SCREENSHOT)
    await page.screenshot({
      path: process.env.OKC_VIEWPORT_SCREENSHOT.replace('.png', '-measure.png'),
    })
  await page
    .getByRole('region', { name: 'Measurement', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()

  const cube = page.locator('.view-cube')
  await cube.getByRole('button', { name: 'Home view', exact: true }).click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  await cube.locator('[data-direction="0,-1,0"]').click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  assert.equal(
    await cube.getByRole('button', { name: 'FRONT', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await cube.getByRole('button', { name: 'Roll clockwise', exact: true }).click()
  const roll = await page.evaluate(() => window.__okcEngine.camera.up.toArray())
  assert.ok(Math.abs(roll[0]) > 0.999)
  await cube.getByRole('button', { name: 'View to the right', exact: true }).click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  await cube.getByRole('button', { name: 'Home view', exact: true }).click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  await cube.locator('[data-direction="1,-1,1"]').click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  const direction = await page.evaluate(() =>
    window.__okcEngine.camera.position
      .clone()
      .sub(window.__okcEngine.controls.target)
      .normalize()
      .toArray(),
  )
  for (const [index, value] of direction.entries())
    assert.ok(Math.abs(value - [1, -1, 1][index] / Math.sqrt(3)) < 1e-5)
  const before = await page.evaluate(() => window.__okcEngine.camera.quaternion.toArray())
  const face = await cube.locator('[data-direction="0,-1,0"]').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return [rect.x + rect.width / 2, rect.y + rect.height / 2]
  })
  await page.mouse.move(...face)
  await page.mouse.down()
  await page.mouse.move(face[0] - 45, face[1] + 18, { steps: 10 })
  await page.mouse.up()
  assert.notDeepEqual(
    await page.evaluate(() => window.__okcEngine.camera.quaternion.toArray()),
    before,
  )
  assert.equal(await page.evaluate(() => !!window.__okcEngine.viewTween), false)
  await cube.getByRole('button', { name: 'Home view', exact: true }).click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  await cube.locator('[data-direction="1,-1,0"]').click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  const edgeDirection = await page.evaluate(() =>
    window.__okcEngine.camera.position
      .clone()
      .sub(window.__okcEngine.controls.target)
      .normalize()
      .toArray(),
  )
  assert.ok(Math.abs(edgeDirection[2]) < 1e-5)
  assert.ok(Math.abs(edgeDirection[0] - Math.SQRT1_2) < 1e-5)
  await cube.getByRole('button', { name: 'FRONT', exact: true }).press('Enter')
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  assert.equal(
    await cube.getByRole('button', { name: 'FRONT', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await cube.getByRole('button', { name: 'Home view', exact: true }).click()
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  if (process.env.OKC_VIEWPORT_SCREENSHOT)
    await page.screenshot({ path: process.env.OKC_VIEWPORT_SCREENSHOT })
  if (process.env.OKC_VIEWPORT_SCREENSHOT)
    await page.screenshot({
      path: process.env.OKC_VIEWPORT_SCREENSHOT.replace('.png', '-cube.png'),
      clip: await cube.boundingBox(),
    })
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileCube = await cube.boundingBox()
  assert.ok(mobileCube.x >= 0 && mobileCube.x + mobileCube.width <= 390)
  await cube.getByRole('button', { name: 'Исходный вид', exact: true }).waitFor()
  assert.deepEqual(failures, [])
  console.log(
    '3 viewport scenarios passed: occluded picking, exact Measure points, cube navigation and dragging.',
  )
} catch (error) {
  if (page) {
    console.error((await page.locator('body').innerText()).slice(-4000))
    await page.screenshot({ path: '../viewport-failure.png' })
  }
  throw error
} finally {
  await browser?.close()
  await server.close()
}
