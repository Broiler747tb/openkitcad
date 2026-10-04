import assert from 'node:assert/strict'

async function rotationTarget(page, axis) {
  return page.evaluate(async (axis) => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const engine = window.__okcEngine
    const tc = engine.transform
    engine.scene.updateMatrixWorld(true)
    const mesh = tc.getHelper().children[0].gizmo.rotate.children.find((x) => x.name === axis)
    if (!mesh?.visible) throw new Error('Missing rotation ring: ' + axis)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...{ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[axis]),
    )
    const point = (angle) =>
      engine.toScreen(
        new THREE.Vector3(Math.cos(angle) * 0.84, Math.sin(angle) * 0.84, 0)
          .applyQuaternion(quaternion)
          .applyMatrix4(mesh.matrixWorld)
          .toArray(),
      )
    const rect = engine.renderer.domElement.getBoundingClientRect()
    const candidates = []
    for (let i = 0; i < 96; i++) {
      const angle = (i * Math.PI) / 48
      const start = point(angle)
      const end = point(angle + 0.25)
      tc.pointerHover({
        x: ((start[0] - rect.left) / rect.width) * 2 - 1,
        y: (-(start[1] - rect.top) / rect.height) * 2 + 1,
        button: -1,
      })
      if (tc.axis === axis)
        candidates.push({
          start,
          end,
          distance: Math.hypot(end[0] - start[0], end[1] - start[1]),
        })
    }
    candidates.sort((a, b) => b.distance - a.distance)
    if (!candidates.length) throw new Error('Cannot pick rotation ring: ' + axis)
    tc.axis = null
    return {
      ...candidates[0],
      camera: engine.camera.quaternion.toArray(),
      position: engine.gizmoProxy.position.toArray(),
    }
  }, axis)
}

export async function checkRotation(page) {
  page.setDefaultTimeout(30000)
  let checked = 0
  for (const part of ['heltec-wifi-lora-32-v4', 'raspberry-pi-4b', 'bearing-608zz']) {
    const id = await page.evaluate(async (part) => {
      const { emptyDocument } = await import('/src/doc/types.ts')
      const store = window.__okc.store.getState()
      store.setDoc(emptyDocument('Rotation regression'))
      const id = window.__okc.store.getState().insertCatalogue(part)
      window.__okc.store.getState().setGizmoMode('rotate')
      return id
    }, part)
    await page.waitForFunction(
      () =>
        !window.__okc.store.getState().building && window.__okcEngine.transform?.mode === 'rotate',
    )
    for (const view of ['iso', 'front', 'right', 'top']) {
      console.log(`Rotation: ${part}/${view}`)
      await page.evaluate((view) => {
        window.__okcEngine.frameAll()
        window.__okcEngine.setStandardView(view)
      }, view)
      await page.waitForFunction(() => !window.__okcEngine.viewTween)
      for (const axis of ['X', 'Y', 'Z']) {
        await page.evaluate(
          (id) => window.__okc.store.getState().select({ kind: 'occurrence', id }),
          id,
        )
        await page.waitForFunction(() => !!window.__okcEngine.transform?.object)
        const target = await rotationTarget(page, axis)
        await page.mouse.move(...target.start)
        await page.mouse.down()
        assert.equal(
          await page.evaluate(() => window.__okcEngine.transform.axis),
          axis,
          `${part}/${view}/${axis} grabbed another ring`,
        )
        assert.equal(
          await page.evaluate(() => window.__okcEngine.isGizmoDragging()),
          true,
          `${part}/${view}/${axis} cannot grab`,
        )
        const length = Math.max(target.distance, 1)
        const end = target.start.map(
          (value, index) => value + ((target.end[index] - value) / length) * 32,
        )
        await page.mouse.move(...end, { steps: 12 })
        await page.mouse.up()
        const result = await page.evaluate(async (id) => {
          const THREE = await import('/node_modules/three/build/three.module.js')
          const state = window.__okc.store.getState()
          const matrix = state.doc.occurrences.find((x) => x.id === id).transform
          const q = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().fromArray(matrix),
          )
          return {
            matrix,
            quaternion: q.toArray(),
            camera: window.__okcEngine.camera.quaternion.toArray(),
            selection: state.selection.id,
          }
        }, id)
        assert.ok(result.matrix.every(Number.isFinite))
        const index = ['X', 'Y', 'Z'].indexOf(axis)
        assert.ok(
          result.quaternion[index] > 0.03,
          `${part}/${view}/${axis} did not follow the ring: ${JSON.stringify(result)}`,
        )
        for (let i = 0; i < 3; i++)
          if (i !== index)
            assert.ok(
              Math.abs(result.quaternion[i]) < 0.001,
              `${part}/${view}/${axis} rotated another axis`,
            )
        assert.equal(result.selection, id)
        assert.ok(result.camera.every((v, i) => Math.abs(v - target.camera[i]) < 1e-8))
        assert.ok(target.position.every((v, i) => Math.abs(v - result.matrix[12 + i]) < 1e-6))
        if (
          part === 'heltec-wifi-lora-32-v4' &&
          view === 'iso' &&
          axis === 'Z' &&
          process.env.OKC_VIEWPORT_SCREENSHOT
        )
          await page.screenshot({
            path: process.env.OKC_VIEWPORT_SCREENSHOT.replace('.png', '-rotation.png'),
          })
        await page.evaluate(() => window.__okc.store.getState().undo())
        await page.waitForFunction(
          (id) =>
            window.__okc.store
              .getState()
              .doc.occurrences.find((x) => x.id === id)
              .transform.every((v, i) => Math.abs(v - ([0, 5, 10, 15].includes(i) ? 1 : 0)) < 1e-6),
          id,
        )
        await page.evaluate(() => window.__okc.store.getState().redo())
        const restored = await page.evaluate(
          (id) => window.__okc.store.getState().doc.occurrences.find((x) => x.id === id).transform,
          id,
        )
        assert.ok(restored.every((v, i) => Math.abs(v - result.matrix[i]) < 1e-6))
        await page.evaluate(() => window.__okc.store.getState().undo())
        checked++
      }
    }
  }
  for (const [view, axis] of [
    ['right', 'X'],
    ['front', 'Y'],
    ['top', 'Z'],
  ]) {
    console.log(`Rotation: 450 degrees ${view}/${axis}`)
    const id = await page.evaluate(async () => {
      const { emptyDocument } = await import('/src/doc/types.ts')
      window.__okc.store.getState().setDoc(emptyDocument('Multiple turns regression'))
      const id = window.__okc.store.getState().insertCatalogue('bearing-608zz')
      window.__okc.store.getState().setGizmoMode('rotate')
      return id
    })
    await page.waitForFunction(
      () => !window.__okc.store.getState().building && window.__okcEngine.transform?.object,
    )
    await page.evaluate((view) => {
      window.__okcEngine.frameAll()
      window.__okcEngine.setStandardView(view)
    }, view)
    await page.waitForFunction(() => !window.__okcEngine.viewTween)
    const target = await rotationTarget(page, axis)
    const centre = await page.evaluate(() =>
      window.__okcEngine.toScreen(window.__okcEngine.gizmoProxy.position.toArray()),
    )
    const sign = view === 'front' ? 1 : -1
    for (const direction of [1, -1]) {
      await page.mouse.move(...target.start)
      await page.mouse.down()
      assert.equal(await page.evaluate(() => window.__okcEngine.transform.axis), axis)
      for (let degrees = 10; degrees <= 450; degrees += 10) {
        const angle = ((degrees * Math.PI) / 180) * sign * direction
        const x = target.start[0] - centre[0],
          y = target.start[1] - centre[1]
        await page.mouse.move(
          centre[0] + x * Math.cos(angle) - y * Math.sin(angle),
          centre[1] + x * Math.sin(angle) + y * Math.cos(angle),
        )
      }
      await page.mouse.up()
      const matrix = await page.evaluate(
        (id) => window.__okc.store.getState().doc.occurrences.find((x) => x.id === id).transform,
        id,
      )
      const expected = await page.evaluate(
        async ({ axis, direction }) => {
          const { rotationMatrix } = await import('/src/doc/model.ts')
          return rotationMatrix(axis.toLowerCase(), direction === 1 ? 90 : 0)
        },
        { axis, direction },
      )
      assert.ok(
        matrix.every((v, i) => Math.abs(v - expected[i]) < 0.001),
        `${view}/${axis} failed a ${direction === 1 ? 'forward' : 'reverse'} 450-degree turn`,
      )
      checked++
    }
  }
  for (const nested of [false, true]) {
    console.log(`Rotation: ${nested ? 'nested' : 'root'} body`)
    await page.evaluate(async (nested) => {
      const { emptyDocument } = await import('/src/doc/types.ts')
      const { multiplyMatrices, rotationMatrix, translationMatrix } =
        await import('/src/doc/model.ts')
      const doc = emptyDocument('Body rotation regression')
      const componentId = nested ? 'part' : 'root'
      if (nested) {
        doc.components.push({
          id: componentId,
          name: 'Tilted component',
          source: { kind: 'design' },
          bodies: [],
        })
        const transform = multiplyMatrices(
          translationMatrix([55, -25, 20]),
          multiplyMatrices(rotationMatrix('z', 35), rotationMatrix('x', 20)),
        )
        doc.occurrences.push({
          id: 'placed',
          parentComponentId: 'root',
          componentId,
          name: 'Placed part',
          transform,
          visible: true,
          grounded: false,
        })
      }
      doc.components
        .find((x) => x.id === componentId)
        .bodies.push({ id: 'block', name: 'Block', visible: true, colour: '#4783bc' })
      doc.timeline = [
        {
          id: 'box',
          kind: 'box',
          name: 'Box',
          componentId,
          plane: { kind: 'named', name: 'XY', offset: 0 },
          origin: [0, 0],
          width: 20,
          depth: 12,
          height: 8,
          result: { kind: 'newBody', bodyId: 'block' },
        },
        {
          id: 'turn',
          kind: 'move',
          name: 'Move',
          componentId,
          bodyIds: ['block'],
          offset: [4, -2, 8],
          rotation: [20, 35, -15],
        },
      ]
      window.__okc.store.getState().setDoc(doc)
      window.__okc.store.getState().setGizmoMode('rotate')
    }, nested)
    await page.waitForFunction(
      () =>
        !window.__okc.store.getState().building &&
        window.__okc.store.getState().instances.length === 1,
    )
    await page.evaluate(() => {
      window.__okcEngine.frameAll()
      window.__okcEngine.setStandardView('iso')
    })
    await page.waitForFunction(() => !window.__okcEngine.viewTween)
    for (const axis of ['X', 'Y', 'Z']) {
      await page.evaluate(() => window.__okc.store.getState().select({ kind: 'body', id: 'block' }))
      await page.waitForFunction(() => !!window.__okcEngine.transform?.object)
      const target = await rotationTarget(page, axis)
      await page.mouse.move(...target.start)
      await page.mouse.down()
      assert.equal(await page.evaluate(() => window.__okcEngine.transform.axis), axis)
      const length = Math.max(target.distance, 1)
      await page.mouse.move(
        ...target.start.map((v, i) => v + ((target.end[i] - v) / length) * 32),
        { steps: 12 },
      )
      const expected = await page.evaluate(() =>
        window.__okcEngine.gizmoProxy.matrix.elements.slice(),
      )
      await page.mouse.up()
      await page.waitForFunction(() => !window.__okc.store.getState().building)
      const result = await page.evaluate(async () => {
        const { moveRotation } = await import('/src/viewport/rotation.ts')
        const { multiplyMatrices } = await import('/src/doc/model.ts')
        const state = window.__okc.store.getState()
        const move = state.doc.timeline.find((x) => x.id === 'turn')
        const instance = state.instances.find((x) => x.bodyId === 'block')
        return {
          matrix: multiplyMatrices(instance.matrix, moveRotation(move.rotation)),
          offset: move.offset,
        }
      })
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10])
        assert.ok(
          Math.abs(result.matrix[i] - expected[i]) < 0.003,
          `Body ${nested ? 'nested' : 'root'}/${axis} orientation disagrees with the ring`,
        )
      assert.ok(
        result.offset.every((v, i) => Math.abs(v - [4, -2, 8][i]) < 0.01),
        'Rotation moved the body',
      )
      checked++
    }
  }
  await page.evaluate(() => window.__okc.store.getState().setGizmoMode('translate'))
  console.log(
    `${checked} rotation drags passed: three catalogue parts, all axes, four views, compound body rotations and tilted components, stable camera, undo and redo.`,
  )
}
