import * as Comlink from 'comlink'
import type { Feature, OkcDocument } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

function jarDoc(patch: Record<string, unknown> = {}): OkcDocument {
  const doc = emptyDocument('Screw lid')
  doc.components[0].bodies = [
    { id: 'jar', name: 'Jar', visible: true, colour: '#cccccc' },
    { id: 'cap', name: 'Cap', visible: true, colour: '#cccccc' },
  ]
  doc.timeline = [
    {
      id: 'cy',
      name: 'Tube',
      componentId: 'root',
      kind: 'cylinder',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      centre: [0, 0],
      radius: 15,
      height: 30,
      result: { kind: 'newBody', bodyId: 'jar' },
    },
    {
      id: 'bore',
      name: 'Bore',
      componentId: 'root',
      kind: 'cylinder',
      plane: { kind: 'named', name: 'XY', offset: 3 },
      centre: [0, 0],
      radius: 12,
      height: 30,
      result: { kind: 'cut', bodyIds: ['jar'] },
    },
    {
      id: 'sc',
      name: 'Screw Lid',
      componentId: 'root',
      kind: 'screwLid',
      face: { bodyId: 'jar', kind: 'face', name: 'cy:side' },
      anchor: [15, 0, 30],
      flipEnd: false,
      pitch: 3,
      turns: 3,
      profile: 'trapezoid',
      gap: 0.3,
      wall: 2,
      top: 3,
      grip: true,
      capBodyId: 'cap',
      ...patch,
    } as Feature,
  ]
  return doc
}

export async function runScrewTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Screw: ${name}`, pass, detail })
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

  try {
    await kernel.ready()

    await check('thread and cap', async () => {
      const result = await evaluate(jarDoc())
      const jar = meshOf(result, 'jar')
      const cap = meshOf(result, 'cap')
      const plain = Math.PI * (15 * 15 * 30 - 12 * 12 * 27)
      add(
        'a round opening gets a thread and a cap to match',
        result.errors.length === 0 &&
          !!jar &&
          !!cap &&
          jar.volume > plain + 100 &&
          cap.volume > 500 &&
          Math.abs((cap?.bounds[5] ?? 0) - 33) < 0.2 &&
          Math.abs((cap?.bounds[2] ?? 0) - 20) < 0.5,
        `${said(result)}; jar ${jar?.volume.toFixed(1)} over ${plain.toFixed(1)}, cap ${cap?.volume.toFixed(1)} from z ${cap?.bounds[2].toFixed(2)} to ${cap?.bounds[5].toFixed(2)}`,
      )
    })

    const clash = async (patch: Record<string, unknown>) => {
      const doc = jarDoc(patch)
      doc.components[0].bodies.push({
        id: 'probe',
        name: 'Probe',
        visible: true,
        colour: '#cccccc',
      })
      doc.timeline.push({
        id: 'cm',
        name: 'Check',
        componentId: 'root',
        kind: 'combine',
        bodyId: 'cap',
        toolBodyIds: ['jar'],
        operation: 'intersect',
        keepTools: true,
      } as Feature)
      const result = await evaluate(doc)
      return { volume: meshOf(result, 'cap')?.volume ?? 0, said: said(result) }
    }

    await check('the two halves clear each other', async () => {
      const shared = await clash({})
      add(
        'the cap screws over the thread without touching it',
        shared.volume < 0.01,
        `${shared.said}; overlap ${shared.volume.toFixed(4)}`,
      )
    })

    await check('a plug for a hole', async () => {
      const doc = jarDoc({ face: { bodyId: 'jar', kind: 'face', name: 'bore:side' } })
      const result = await evaluate(doc)
      const jar = meshOf(result, 'jar')
      const plug = meshOf(result, 'cap')
      const plain = Math.PI * (15 * 15 * 30 - 12 * 12 * 27)
      add(
        'a bore gets the thread and the lid becomes a plug',
        result.errors.length === 0 &&
          !!jar &&
          !!plug &&
          jar.volume < plain &&
          plug.volume > 500 &&
          (plug?.bounds[3] ?? 0) > 12,
        `${said(result)}; jar ${jar?.volume.toFixed(1)} under ${plain.toFixed(1)}, plug ${plug?.volume.toFixed(1)} out to ${plug?.bounds[3].toFixed(2)}`,
      )
      const shared = await clash({ face: { bodyId: 'jar', kind: 'face', name: 'bore:side' } })
      add(
        'the plug screws into the hole without touching it',
        shared.volume < 0.01,
        `${shared.said}; overlap ${shared.volume.toFixed(4)}`,
      )
    })

    await check('thread shapes', async () => {
      const vee = await evaluate(jarDoc({ profile: 'triangle' }))
      const jar = meshOf(vee, 'jar')
      add(
        'a triangular thread builds too',
        vee.errors.length === 0 && (jar?.volume ?? 0) > 0,
        `${said(vee)}; jar ${jar?.volume.toFixed(1)}`,
      )
      const tall = await evaluate(jarDoc({ turns: 20 }))
      add(
        'a thread longer than its face warns',
        tall.errors.some((error) => error.message.includes('longer than the round face')),
        said(tall),
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
