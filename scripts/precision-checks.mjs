import assert from 'node:assert/strict'

export async function checkPrecision(page) {
  const iso = page.getByRole('button', { name: 'Isometric mode', exact: true })
  await iso.click()
  await page.waitForFunction(
    () => window.__okcEngine.camera.isOrthographicCamera && !window.__okcEngine.viewTween,
  )
  const projection = await page.evaluate(() => {
    const e = window.__okcEngine
    const target = e.controls.target.clone()
    const direction = e.camera.position.clone().sub(target).normalize().toArray()
    const pixel = e.pixelSize(target.toArray())
    const farPixel = e.pixelSize(
      target
        .clone()
        .addScaledVector(e.camera.position.clone().sub(target).normalize(), 20)
        .toArray(),
    )
    return {
      direction,
      pixel,
      farPixel,
      cameraMatches:
        e.controls.object === e.camera && (!e.transform || e.transform.camera === e.camera),
    }
  })
  assert.ok(
    projection.direction.every((value) => Math.abs(Math.abs(value) - 1 / Math.sqrt(3)) < 1e-5),
  )
  assert.equal(projection.pixel, projection.farPixel)
  assert.ok(projection.cameraMatches)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(100)
  const aspect = await page.evaluate(() => {
    const e = window.__okcEngine
    return (
      (e.camera.right - e.camera.left) / (e.camera.top - e.camera.bottom) -
      e.renderer.domElement.clientWidth / e.renderer.domElement.clientHeight
    )
  })
  assert.ok(Math.abs(aspect) < 1e-8)
  await iso.click()
  await page.waitForFunction(() => window.__okcEngine.camera.isPerspectiveCamera)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const plane of ['XY', 'XZ']) {
    await page.evaluate(async (plane) => {
      const { emptyDocument } = await import('/src/doc/types.ts')
      const store = window.__okc.store.getState()
      store.setDoc(emptyDocument('Sketch measurement'))
      window.__okc.store.getState().startSketch({ kind: 'named', name: plane, offset: 7 })
      window.__okc.store.getState().editSketch((sketch) => {
        sketch.points.push(
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 40, y: 0 },
          { id: 'centre', x: 20, y: 20 },
        )
        sketch.entities.push(
          { id: 'line', kind: 'line', p1: 'a', p2: 'b', construction: false },
          { id: 'circle', kind: 'circle', c: 'centre', r: 6, construction: false },
        )
      })
    }, plane)
    await page.waitForFunction(
      () => !window.__okc.store.getState().building && !!window.__okc.store.getState().activeSketch,
    )
    await page.waitForTimeout(200)
    await page.evaluate(
      (plane) =>
        window.__okcEngine.frameAll(plane === 'XY' ? [0, 0, 7, 40, 26, 7] : [0, -7, 0, 40, -7, 26]),
      plane,
    )
    const original = await page.evaluate(() => JSON.stringify(window.__okc.store.getState().doc))
    await page.keyboard.press('i')
    const world = (x, y) => (plane === 'XY' ? [x, y, 7] : [x, -7, y])
    for (const point of [world(0, 0), world(40, 0)]) {
      const position = await page.evaluate((point) => window.__okcEngine.toScreen(point), point)
      await page.mouse.click(position[0] + 2, position[1] + 1)
    }
    const measure = await page.evaluate(() => window.__okc.store.getState().measure)
    assert.deepEqual(measure.a, world(0, 0))
    assert.deepEqual(measure.b, world(40, 0))
    assert.equal(await page.getByLabel('Distance', { exact: true }).innerText(), '40 mm')
    await page.getByRole('button', { name: 'New measurement', exact: true }).click()
    for (const point of [world(14, 20), world(26, 20)])
      await page.mouse.click(
        ...(await page.evaluate((point) => window.__okcEngine.toScreen(point), point)),
      )
    assert.equal(await page.getByLabel('Distance', { exact: true }).innerText(), '12 mm')
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.__okc.store.getState().doc)),
      original,
    )
    await page
      .getByRole('region', { name: 'Measurement', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page.evaluate(() => window.__okc.store.getState().closeSketch())
  }
  console.log(
    'Isometric parallel projection, resize, camera controls and exact sketch measurements on XY/XZ passed.',
  )
}
