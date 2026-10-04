import assert from 'node:assert/strict'

export async function checkNavigation(page) {
  const cube = page.locator('.view-cube')
  const lock = cube.getByRole('button', { name: 'Horizon lock', exact: true })
  const lockBounds = await lock.boundingBox()
  assert.ok(lockBounds.width <= 28 && lockBounds.height <= 28)
  if ((await lock.getAttribute('aria-pressed')) !== 'true') await lock.click()
  assert.equal(
    await cube.getByRole('button', { name: 'Roll clockwise', exact: true }).isDisabled(),
    true,
  )
  const upright = async () => {
    const values = await page.evaluate(() => {
      const e = window.__okcEngine.camera.matrixWorld.elements
      return { rightZ: e[2], finite: e.every(Number.isFinite) }
    })
    assert.ok(values.finite)
    assert.ok(Math.abs(values.rightZ) < 1e-5, JSON.stringify(values))
  }
  for (const direction of ['front', 'top', 'bottom', 'iso']) {
    await page.evaluate((direction) => window.__okcEngine.setStandardView(direction), direction)
    await page.waitForFunction(() => !window.__okcEngine.viewTween)
    const face = cube.locator('[data-kind="face"]').first()
    const bounds = await face.boundingBox()
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 32, y - 23, { steps: 10 })
    await page.mouse.up()
    await upright()
  }
  await lock.click()
  await cube.getByRole('button', { name: 'Roll clockwise', exact: true }).click()
  await page.waitForFunction(
    () => Math.abs(window.__okcEngine.camera.matrixWorld.elements[2]) > 0.1,
  )
  await lock.click()
  await page.waitForFunction(
    () => Math.abs(window.__okcEngine.camera.matrixWorld.elements[2]) < 1e-5,
  )
  const canvas = await page.locator('.viewport-canvas canvas').boundingBox()
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(canvas.x + canvas.width / 2 + 45, canvas.y + canvas.height / 2 + 30, {
    steps: 12,
  })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.up('Shift')
  await upright()
  await page.evaluate(() => {
    window.onbeforeunload = null
  })
  await page.reload()
  await page.waitForFunction(() => window.__okc?.store.getState().kernelReady && window.__okcEngine)
  assert.equal(await lock.getAttribute('aria-pressed'), 'true')
  const occurrence = await page.evaluate(async () => {
    const { emptyDocument } = await import('/src/doc/types.ts')
    const store = window.__okc.store.getState()
    store.setDoc(emptyDocument('Move handles regression'))
    return window.__okc.store.getState().insertCatalogue('heltec-wifi-lora-32-v4')
  })
  await page.waitForFunction(
    () => !window.__okc.store.getState().building && window.__okcEngine.transform?.object,
  )
  await page.evaluate(() => {
    window.__okcEngine.frameAll()
    window.__okcEngine.setStandardView('iso')
  })
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  for (const zoom of [0.6, 1.7, 1]) {
    await page.evaluate(
      (id) => window.__okc.store.getState().select({ kind: 'occurrence', id }),
      occurrence,
    )
    await page.evaluate((zoom) => {
      const engine = window.__okcEngine
      const offset = engine.camera.position.clone().sub(engine.controls.target).multiplyScalar(zoom)
      engine.camera.position.copy(engine.controls.target).add(offset)
      engine.camera.updateMatrixWorld()
    }, zoom)
    await page.waitForFunction(() => !!window.__okcEngine.transform?.object)
    const handle = await page.evaluate(() => {
      const engine = window.__okcEngine
      engine.scene.updateMatrixWorld(true)
      const meshes = engine.transform.getHelper().children[0].gizmo.translate.children
      const shaft = meshes.find(
        (mesh) => mesh.name === 'X' && mesh.geometry.type === 'CylinderGeometry',
      )
      shaft.geometry.computeBoundingBox()
      const point = shaft.geometry.boundingBox
        .getCenter(engine.camera.position.clone())
        .applyMatrix4(shaft.matrixWorld)
      const origin = engine.toScreen(engine.gizmoProxy.position.toArray())
      const centre = engine.toScreen(point.toArray())
      const dx = centre[0] - origin[0]
      const dy = centre[1] - origin[1]
      const length = Math.hypot(dx, dy)
      return {
        centre,
        unit: [dx / length, dy / length],
        camera: engine.camera.quaternion.toArray(),
      }
    })
    const [ux, uy] = handle.unit
    const start = [handle.centre[0] - uy * 6, handle.centre[1] + ux * 6]
    await page.mouse.move(...start)
    await page.mouse.down()
    assert.equal(await page.evaluate(() => window.__okcEngine.isGizmoDragging()), true)
    await page.mouse.move(start[0] + ux * 22, start[1] + uy * 22, { steps: 12 })
    await page.mouse.up()
    const state = await page.evaluate((id) => {
      const s = window.__okc.store.getState()
      return {
        matrix: s.doc.occurrences.find((o) => o.id === id).transform,
        selection: s.selection.id,
        camera: window.__okcEngine.camera.quaternion.toArray(),
      }
    }, occurrence)
    assert.ok(Math.abs(state.matrix[12]) > 1, JSON.stringify(state))
    assert.ok(Math.abs(state.matrix[13]) < 1e-6)
    assert.ok(Math.abs(state.matrix[14]) < 1e-6)
    assert.equal(state.selection, occurrence)
    if (zoom === 1 && process.env.OKC_VIEWPORT_SCREENSHOT)
      await page.screenshot({
        path: process.env.OKC_VIEWPORT_SCREENSHOT.replace('.png', '-gizmo.png'),
      })
    assert.ok(state.camera.every((value, index) => Math.abs(value - handle.camera[index]) < 1e-8))
    await page.evaluate(() => window.__okc.store.getState().undo())
    await page.waitForFunction(
      (id) =>
        Math.abs(
          window.__okc.store.getState().doc.occurrences.find((o) => o.id === id).transform[12],
        ) < 1e-6,
      occurrence,
    )
  }
  await page.evaluate(async () => {
    const { startCommand } = await import('/src/ui/command/commands.ts')
    startCommand('box')
  })
  const height = page.locator('.okc-handle-value[aria-label="height"]')
  await height.waitFor()
  const initial = Number.parseFloat(await height.inputValue())
  const middle = await page.evaluate(() => {
    const engine = window.__okcEngine
    const handle = engine.handles.find((h) => h.id.startsWith('height#'))
    const mid = handle.origin.map((v, i) => v + handle.direction[i] * handle.length * 0.4)
    const a = engine.toScreen(mid)
    const b = engine.toScreen(mid.map((v, i) => v + handle.direction[i] * 5))
    const span = Math.hypot(b[0] - a[0], b[1] - a[1])
    return {
      a,
      unit: [(b[0] - a[0]) / span, (b[1] - a[1]) / span],
      camera: engine.camera.quaternion.toArray(),
    }
  })
  await page.mouse.move(...middle.a)
  await page.mouse.down()
  await page.mouse.move(middle.a[0] + middle.unit[0] * 2, middle.a[1] + middle.unit[1] * 2)
  assert.ok(Math.abs(Number.parseFloat(await height.inputValue()) - initial) <= 1)
  await page.mouse.move(middle.a[0] + middle.unit[0] * 25, middle.a[1] + middle.unit[1] * 25, {
    steps: 10,
  })
  await page.mouse.up()
  assert.ok(Number.parseFloat(await height.inputValue()) > initial)
  if (process.env.OKC_VIEWPORT_SCREENSHOT)
    await page.screenshot({
      path: process.env.OKC_VIEWPORT_SCREENSHOT.replace('.png', '-handle.png'),
    })
  assert.ok(
    (await page.evaluate(() => window.__okcEngine.camera.quaternion.toArray())).every(
      (value, index) => Math.abs(value - middle.camera[index]) < 1e-8,
    ),
  )
  await page.evaluate(() => window.__okcEngine.setStandardView('top'))
  await page.waitForFunction(() => !window.__okcEngine.viewTween)
  const endOn = await page.evaluate(() => {
    const engine = window.__okcEngine
    const handle = engine.handles.find((h) => h.id.startsWith('height#'))
    return engine.toScreen(
      handle.origin.map((value, index) => value + handle.direction[index] * handle.length),
    )
  })
  const beforeEndOn = Number.parseFloat(await height.inputValue())
  await page.mouse.move(...endOn)
  await page.mouse.down()
  await page.mouse.move(endOn[0], endOn[1] - 20, { steps: 10 })
  await page.mouse.up()
  const afterEndOn = Number.parseFloat(await height.inputValue())
  assert.ok(afterEndOn > beforeEndOn && afterEndOn - beforeEndOn < 50)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(() => window.__okcEngine.handles.length === 0)
  console.log(
    'Navigation checks passed: horizon and poles, persisted lock, shaft dragging at three zooms, undo and command dragging without jumps.',
  )
}
