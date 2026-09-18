import * as Comlink from 'comlink'
import type { Feature, Matrix4, OkcDocument } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

const PI: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -42.5, -28, 6, 1]
const PI_TOP = 6 + 1.4 + 16

function enclosureDoc(
  patch: Record<string, unknown> = {},
  mount: Record<string, unknown> = {},
): OkcDocument {
  const doc = emptyDocument('Enclosure')
  doc.components[0].bodies = [
    { id: 'box', name: 'Box', visible: true, colour: '#cccccc' },
    { id: 'lid', name: 'Lid', visible: true, colour: '#cccccc' },
  ]
  doc.components.push({
    id: 'pi-part',
    name: 'Raspberry Pi 4 Model B',
    source: { kind: 'catalogue', partId: 'raspberry-pi-4b' },
    bodies: [],
  })
  doc.occurrences.push({
    id: 'pi',
    parentComponentId: doc.rootComponentId,
    componentId: 'pi-part',
    name: 'Raspberry Pi 4 Model B',
    transform: PI,
    visible: true,
    grounded: true,
  })
  doc.timeline = [
    {
      id: 'en',
      name: 'Enclosure',
      componentId: 'root',
      kind: 'enclosure',
      contextPath: [],
      mounts: [{ occurrencePath: ['pi'], kind: 'standoffs', connectorIds: [], ...mount }],
      clearance: 2,
      under: 4,
      wall: 2,
      floor: 2,
      lid: 'screws',
      lidThickness: 2,
      gap: 0.2,
      screw: 3,
      tolerance: 0.6,
      bodyId: 'box',
      lidBodyId: 'lid',
      ...patch,
    } as Feature,
  ]
  return doc
}

function withClash(doc: OkcDocument): OkcDocument {
  doc.timeline.push({
    id: 'cm',
    name: 'Check',
    componentId: 'root',
    kind: 'combine',
    bodyId: 'lid',
    toolBodyIds: ['box'],
    operation: 'intersect',
    keepTools: true,
  } as Feature)
  return doc
}

export async function runEnclosureTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Enclosure: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const evaluate = (doc: OkcDocument) => kernel.evaluate(doc, [])
  const said = (result: EvaluateResult) =>
    result.errors.map((error) => `${error.severity}: ${error.message}`).join('; ') || 'clean'
  const meshOf = (result: EvaluateResult, bodyId: string) => {
    const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
    return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
  }
  const near = (a: number | undefined, b: number, within = 0.3) =>
    a !== undefined && Math.abs(a - b) < within
  const clash = async (patch: Record<string, unknown>) => {
    const result = await evaluate(withClash(enclosureDoc(patch)))
    return { volume: meshOf(result, 'lid')?.volume ?? 0, said: said(result) }
  }

  try {
    await kernel.ready()

    await check('screwed lid', async () => {
      const result = await evaluate(enclosureDoc())
      const box = meshOf(result, 'box')
      const lid = meshOf(result, 'lid')
      add(
        'a box goes round the board with corner towers and a lid on top',
        result.errors.length === 0 &&
          near(box?.bounds[2], 0) &&
          near(box?.bounds[5], PI_TOP + 2) &&
          near(lid?.bounds[5], PI_TOP + 4) &&
          (box?.bounds[0] ?? 0) < -42.5 - 2 - 2 - 5 &&
          (box?.volume ?? 0) > 10000,
        `${said(result)}; box z ${box?.bounds[2].toFixed(2)}..${box?.bounds[5].toFixed(2)} x from ${box?.bounds[0].toFixed(2)}, lid top ${lid?.bounds[5].toFixed(2)}, volume ${box?.volume.toFixed(0)}`,
      )
      const shared = await clash({})
      add(
        'the screwed lid sits on the box without overlapping it',
        shared.volume < 0.01,
        `${shared.said}; overlap ${shared.volume.toFixed(4)}`,
      )
    })

    await check('snap lid', async () => {
      const result = await evaluate(enclosureDoc({ lid: 'snap' }))
      const box = meshOf(result, 'box')
      const lid = meshOf(result, 'lid')
      add(
        'a snap lid sits flush inside the rim',
        result.errors.length === 0 &&
          near(lid?.bounds[5], box?.bounds[5] ?? NaN, 0.01) &&
          near(box?.bounds[5], PI_TOP + 2 + 2) &&
          (lid?.bounds[0] ?? -Infinity) > (box?.bounds[0] ?? 0) + 1.5,
        `${said(result)}; lid top ${lid?.bounds[5].toFixed(2)} box top ${box?.bounds[5].toFixed(2)}, lid x from ${lid?.bounds[0].toFixed(2)} box x from ${box?.bounds[0].toFixed(2)}`,
      )
      const shared = await clash({ lid: 'snap' })
      add(
        'the snap bead sits in its groove without overlapping the wall',
        shared.volume < 0.01,
        `${shared.said}; overlap ${shared.volume.toFixed(4)}`,
      )
    })

    await check('sliding lid', async () => {
      const result = await evaluate(enclosureDoc({ lid: 'slide' }))
      const box = meshOf(result, 'box')
      const lid = meshOf(result, 'lid')
      add(
        'a sliding lid runs in grooves and stands proud of the open end',
        result.errors.length === 0 &&
          near((lid?.bounds[3] ?? 0) - (box?.bounds[3] ?? 0), 2) &&
          (lid?.bounds[2] ?? 0) >= PI_TOP + 2 - 0.01,
        `${said(result)}; lid runs to x ${lid?.bounds[3].toFixed(2)} past box ${box?.bounds[3].toFixed(2)}, lid bottom ${lid?.bounds[2].toFixed(2)}`,
      )
      const shared = await clash({ lid: 'slide' })
      add(
        'the sliding lid clears its grooves',
        shared.volume < 0.01,
        `${shared.said}; overlap ${shared.volume.toFixed(4)}`,
      )
      const thin = await evaluate(enclosureDoc({ lid: 'slide', wall: 1 }))
      add(
        'walls too thin for grooves say so',
        thin.errors.some((error) => error.message.includes('too thin')),
        said(thin),
      )
    })

    await check('mounts and ports', async () => {
      const posts = meshOf(await evaluate(enclosureDoc({}, { kind: 'none' })), 'box')
      const standoffs = meshOf(await evaluate(enclosureDoc()), 'box')
      const clipped = await evaluate(enclosureDoc({}, { kind: 'clips' }))
      const clips = meshOf(clipped, 'box')
      add(
        'standoffs and clips each add material',
        clipped.errors.length === 0 &&
          (standoffs?.volume ?? 0) > (posts?.volume ?? Infinity) &&
          (clips?.bounds[0] ?? 0) < (posts?.bounds[0] ?? 0) - 1,
        `${said(clipped)}; none ${posts?.volume.toFixed(0)}, standoffs ${standoffs?.volume.toFixed(0)}, clips x from ${clips?.bounds[0].toFixed(2)} against ${posts?.bounds[0].toFixed(2)}`,
      )
      const opened = await evaluate(enclosureDoc({}, { connectorIds: ['usb2', 'usb3', 'eth'] }))
      const ported = meshOf(opened, 'box')
      add(
        'ticked connectors get openings through the wall',
        opened.errors.length === 0 && (ported?.volume ?? Infinity) < (standoffs?.volume ?? 0) - 500,
        `${said(opened)}; ${ported?.volume.toFixed(0)} against ${standoffs?.volume.toFixed(0)}`,
      )
    })

    await check('following the parts', async () => {
      const before = meshOf(await evaluate(enclosureDoc()), 'box')
      const moved = enclosureDoc()
      moved.occurrences[0].transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -32.5, -28, 6, 1]
      const after = meshOf(await evaluate(moved), 'box')
      add(
        'moving the board moves the box with it',
        near((after?.bounds[0] ?? 0) - (before?.bounds[0] ?? 0), 10, 0.01) &&
          near((after?.bounds[3] ?? 0) - (before?.bounds[3] ?? 0), 10, 0.01),
        `x from ${before?.bounds[0].toFixed(2)} to ${after?.bounds[0].toFixed(2)}`,
      )
      const gone = enclosureDoc()
      gone.occurrences = []
      const missing = await evaluate(gone)
      add(
        'an enclosure whose part has gone says so',
        missing.errors.some((error) => error.message.includes('no longer in the design')),
        said(missing),
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
