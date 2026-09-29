import * as THREE from 'three'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { NAMED_FRAMES } from '../core/math'
import { useStore } from '../doc/store'
import { emptyDocument, type Feature, type OkcDocument } from '../doc/types'
import { emptySketch } from '../sketch/types'
import { CommandHost } from '../ui/command/CommandHost'
import { startCommand } from '../ui/command/commands'
import { elementPick } from '../ui/command/picks'
import { useCommand } from '../ui/command/session'
import { ask, ConfirmHost } from '../ui/Confirm'
import { StatusBar } from '../ui/StatusBar'
import { ViewportEngine } from '../viewport/engine'
import type { TestResult } from './selftest'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(done: () => boolean, ms = 5000): Promise<boolean> {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (done()) return true
    await wait(25)
  }
  return done()
}

function plateDoc(): OkcDocument {
  const doc = emptyDocument('Plate')
  const sketch = emptySketch()
  const corners = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]
  corners.forEach(([x, y], i) => sketch.points.push({ id: `q${i}`, x, y }))
  corners.forEach((_, i) =>
    sketch.entities.push({
      id: `e${i}`,
      kind: 'line',
      p1: `q${i}`,
      p2: `q${(i + 1) % 4}`,
      construction: false,
    }),
  )
  doc.timeline = [
    {
      id: 'sk',
      kind: 'sketch',
      name: 'Sketch',
      componentId: 'root',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      visible: false,
      sketch,
    },
    {
      id: 'ex',
      kind: 'extrude',
      name: 'Extrude',
      componentId: 'root',
      sketchId: 'sk',
      distance: 5,
      symmetric: false,
      reverse: false,
      result: { kind: 'newBody', bodyId: 'body' },
    } as Feature,
  ]
  doc.components[0].bodies = [{ id: 'body', name: 'Plate', visible: true, colour: '#ccc' }]
  return doc
}

function mount(width: number) {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px`
  document.body.appendChild(host)
  const root = createRoot(host)
  return {
    host,
    root,
    remove: () => {
      root.unmount()
      host.remove()
    },
  }
}

function press(dialog: Element | null, label: string) {
  const button = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === label,
  )
  button?.click()
}

export async function runPolishTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Polish: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }
  const saved = useStore.getState()

  try {
    await check('status bar', () => {
      const view = mount(1280)
      try {
        flushSync(() => view.root.render(<StatusBar />))
        const bar = view.host.querySelector('.statusbar')!.getBoundingClientRect()
        const labels = [...view.host.querySelectorAll('.statusbar > label')].map((label) =>
          label.getBoundingClientRect(),
        )
        add(
          'the status bar toggles sit inside the bar, on one line',
          labels.length === 2 &&
            labels.every(
              (rect) =>
                rect.top >= bar.top - 0.5 && rect.bottom <= bar.bottom + 0.5 && rect.height < 20,
            ),
          `bar ${bar.top.toFixed(1)}..${bar.bottom.toFixed(1)}, labels ${labels
            .map((rect) => `${rect.top.toFixed(1)}..${rect.bottom.toFixed(1)}`)
            .join(' ')}`,
        )
      } finally {
        view.remove()
      }
    })

    await check('confirm', async () => {
      const view = mount(800)
      try {
        flushSync(() => view.root.render(<ConfirmHost />))
        await wait(0)
        const destroy = ask({ title: 'Delete the test?', confirm: 'Delete', danger: true })
        await wait(30)
        const opened = !!view.host.querySelector('dialog[open]')
        const safeFocus = document.activeElement?.textContent
        press(view.host.querySelector('dialog'), 'Delete')
        const yes = await destroy
        const proceed = ask({ title: 'Carry on?', confirm: 'Carry on' })
        await wait(30)
        const plainFocus = document.activeElement?.textContent
        press(view.host.querySelector('dialog'), 'Cancel')
        const no = await proceed
        const escape = ask({ title: 'Escape this?', confirm: 'Go' })
        await wait(30)
        view.host.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
        const escaped = await escape
        await wait(30)
        add(
          'a question is a themed dialog: Cancel has focus when the answer destroys work, Cancel and Escape say no',
          opened &&
            safeFocus === 'Cancel' &&
            yes &&
            plainFocus === 'Carry on' &&
            !no &&
            !escaped &&
            !view.host.querySelector('dialog'),
          JSON.stringify({ opened, safeFocus, yes, plainFocus, no, escaped }),
        )
      } finally {
        view.remove()
      }
    })

    await check('camera and sketch labels', async () => {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px'
      document.body.appendChild(host)
      let engine: ViewportEngine
      try {
        engine = new ViewportEngine(host)
      } catch (error) {
        out.push({
          name: 'Polish: finishing a sketch takes the camera back',
          pass: true,
          skipped: true,
          detail: `no WebGL here: ${error}`,
        })
        host.remove()
        return
      }
      const inside = engine as unknown as {
        camera: THREE.PerspectiveCamera
        viewTween: { start: number } | null
        stepViewTween(): boolean
        worldLabels: unknown[]
      }
      const settle = () => {
        if (inside.viewTween) inside.viewTween.start -= 10_000
        inside.stepViewTween()
      }
      try {
        const before = engine.saveView()
        engine.lookAtFrame(NAMED_FRAMES.XY)
        const looking = engine.isLookingAlong(NAMED_FRAMES.XY.normal)
        engine.restoreView(before)
        settle()
        const facing = inside.camera.getWorldDirection(new THREE.Vector3())
        const expected = new THREE.Vector3(...before.target)
          .sub(new THREE.Vector3(...before.position))
          .normalize()
        engine.lookAtFrame(NAMED_FRAMES.XY)
        engine.setStandardView('front')
        settle()
        const orbited = !engine.isLookingAlong(NAMED_FRAMES.XY.normal)
        add(
          'finishing a sketch can take the camera back to where it was, unless it was turned away',
          looking && facing.distanceTo(expected) < 1e-6 && orbited,
          `looking ${looking}, off by ${facing.distanceTo(expected).toExponential(2)}, orbited ${orbited}`,
        )
        engine.setLabels([{ id: 'c1', text: '—', at: [0, 0, 0], kind: 'constraint' }])
        engine.clearSketch()
        add(
          'leaving a sketch takes its constraint markers with it',
          inside.worldLabels.length === 0,
          `${inside.worldLabels.length} left`,
        )
      } finally {
        engine.dispose()
        host.remove()
      }
    })

    await check('OK needs a step that builds', async () => {
      const doc = plateDoc()
      useStore.setState({
        rebuild: () => {},
        doc,
        past: [],
        future: [],
        selection: { kind: 'none' },
        activeSketch: null,
        activeComponentId: doc.rootComponentId,
        meshes: new Map(),
        instances: [],
        commandOpen: false,
        transientBase: null,
      })
      const view = mount(360)
      try {
        flushSync(() => view.root.render(<CommandHost />))
        const edge = elementPick(doc, { bodyId: 'body', kind: 'edge', name: 'ex:end:e0' })
        startCommand('fillet', { edges: edge ? [edge] : [], radius: 50 })
        const failed = await until(
          () => !!useCommand.getState().preview?.errors.some((e) => e.featureId !== ''),
          60_000,
        )
        await wait(50)
        const button = () => view.host.querySelector<HTMLButtonElement>('.okc-cmd-ok')
        const blocked = !!button()?.disabled
        useCommand.getState().dispatch({ type: 'text', id: 'radius', text: '1' })
        const built = await until(
          () => !!useCommand.getState().preview && !useCommand.getState().preview!.errors.length,
          60_000,
        )
        await wait(50)
        const open = button()?.disabled === false
        add(
          'OK stays off while the preview says the step cannot be built',
          !!edge && failed && blocked && built && open,
          `edge ${!!edge}, failed ${failed}, blocked ${blocked}, built ${built}, open ${open}`,
        )
      } finally {
        useCommand.getState().cancel()
        view.remove()
      }
    })
  } finally {
    useCommand.getState().cancel()
    useStore.setState(saved, true)
  }
  return out
}
