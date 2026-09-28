import * as Comlink from 'comlink'
import { designation, minorDiameter, nearestThread, pitchesOf, tapDrill } from '../doc/threads'
import { flankHalfWidth, threadProfile } from '../kernel/threadStep'
import type { Feature, OkcDocument } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

const PITCH = 1.25
const MINOR = minorDiameter(8, PITCH) / 2

function pegDoc(patch: Record<string, unknown> = {}): OkcDocument {
  const doc = emptyDocument('Thread')
  doc.components[0].bodies = [{ id: 'peg', name: 'Peg', visible: true, colour: '#cccccc' }]
  doc.timeline = [
    {
      id: 'cy',
      name: 'Peg',
      componentId: 'root',
      kind: 'cylinder',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      centre: [0, 0],
      radius: 4,
      height: 8,
      result: { kind: 'newBody', bodyId: 'peg' },
    },
    {
      id: 'th',
      name: 'Thread',
      componentId: 'root',
      kind: 'thread',
      faces: [{ bodyId: 'peg', kind: 'face', name: 'cy:side' }],
      anchors: [[4, 0, 0]],
      auto: false,
      nominal: 8,
      pitch: PITCH,
      modelled: true,
      lefthand: false,
      full: true,
      length: 8,
      offset: 0,
      clearance: 0,
      ...patch,
    } as Feature,
  ]
  return doc
}

function nutDoc(patch: Record<string, unknown> = {}): OkcDocument {
  const doc = emptyDocument('Nut')
  doc.components[0].bodies = [{ id: 'nut', name: 'Nut', visible: true, colour: '#cccccc' }]
  doc.timeline = [
    {
      id: 'blk',
      name: 'Block',
      componentId: 'root',
      kind: 'box',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [-8, -8],
      width: 16,
      depth: 16,
      height: 8,
      result: { kind: 'newBody', bodyId: 'nut' },
    },
    {
      id: 'bore',
      name: 'Bore',
      componentId: 'root',
      kind: 'cylinder',
      plane: { kind: 'named', name: 'XY', offset: -1 },
      centre: [0, 0],
      radius: MINOR,
      height: 10,
      result: { kind: 'cut', bodyIds: ['nut'] },
    },
    {
      id: 'th',
      name: 'Thread',
      componentId: 'root',
      kind: 'thread',
      faces: [{ bodyId: 'nut', kind: 'face', name: 'bore:side' }],
      anchors: [[MINOR, 0, 0]],
      auto: false,
      nominal: 8,
      pitch: PITCH,
      modelled: true,
      lefthand: false,
      full: true,
      length: 8,
      offset: 0,
      clearance: 0.08,
      ...patch,
    } as Feature,
  ]
  return doc
}

export async function runThreadTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Thread: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }

  await check('the two halves of a pair', () => {
    const crest = 2 * threadProfile(PITCH, 4, 0, true)[3][1]
    const root = 2 * threadProfile(PITCH, 4, 0, true)[2][1]
    const wanted = 0.2 / Math.cos(Math.PI / 6)
    let worst = 0
    for (let r = MINOR; r <= 4.0001; r += 0.05) {
      const material = PITCH / 2 - flankHalfWidth(PITCH, 4, 0, true, r)
      const room = flankHalfWidth(PITCH, MINOR, 0.2, false, r)
      worst = Math.max(worst, Math.abs(room - material - wanted))
    }
    const rise = flankHalfWidth(PITCH, 4, 0, true, 4) - flankHalfWidth(PITCH, 4, 0, true, MINOR)
    const flank = rise / (4 - MINOR)
    add(
      'the nut leaves the same gap all the way up a 30 degree flank, on a thread of the right shape',
      worst < 1e-9 &&
        Math.abs(flank - Math.tan(Math.PI / 6)) < 1e-9 &&
        crest >= PITCH / 8 - 1e-9 &&
        crest <= PITCH / 4 &&
        Math.abs(root - (3 * PITCH) / 4) < 1e-9,
      `worst gap error ${worst.toExponential(2)}, flank ${((Math.atan(flank) * 180) / Math.PI).toFixed(3)} degrees, crest ${crest.toFixed(3)} root ${root.toFixed(3)} of pitch ${PITCH}`,
    )
  })

  await check('sizes', () => {
    add(
      'the metric table names sizes the way a drawing does',
      designation(8, 1.25) === 'M8' &&
        designation(8, 1) === 'M8x1' &&
        pitchesOf(8).join() === '1.25,1,0.75' &&
        Math.abs(minorDiameter(8, 1.25) - 6.647) < 0.005 &&
        tapDrill(8, 1.25) === 6.75 &&
        nearestThread(4.1, false).nominal === 4 &&
        nearestThread(6.7, true).nominal === 8,
      `${designation(8, 1.25)} ${designation(8, 1)} minor ${minorDiameter(8, 1.25).toFixed(3)} drill ${tapDrill(8, 1.25)}`,
    )
  })

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
    const plain = Math.PI * 16 * 8

    await check('external thread', async () => {
      const result = await evaluate(pegDoc())
      const peg = meshOf(result, 'peg')
      const core = Math.PI * MINOR * MINOR * 8
      add(
        'a thread cuts a vee groove into a peg without making it fatter',
        result.errors.length === 0 &&
          !!peg &&
          peg.volume < plain - 25 &&
          peg.volume > core &&
          Math.abs((peg?.bounds[3] ?? 0) - 4) < 0.1,
        `${said(result)}; ${peg?.volume.toFixed(1)} between core ${core.toFixed(1)} and plain ${plain.toFixed(1)}, out to ${peg?.bounds[3].toFixed(3)}`,
      )
    })

    await check('left-hand', async () => {
      const left = await evaluate(pegDoc({ lefthand: true }))
      const right = meshOf(await evaluate(pegDoc()), 'peg')
      const mirrored = meshOf(left, 'peg')
      add(
        'a left-hand thread takes the same material the other way round',
        left.errors.length === 0 && Math.abs((mirrored?.volume ?? 0) - (right?.volume ?? 1)) < 0.5,
        `${said(left)}; ${mirrored?.volume.toFixed(1)} against ${right?.volume.toFixed(1)}`,
      )
      const tapped = await evaluate(nutDoc({ lefthand: true }))
      const plain = meshOf(await evaluate(nutDoc()), 'nut')
      const hole = meshOf(tapped, 'nut')
      add(
        'a left-hand tapped hole cuts as much as a right-hand one',
        tapped.errors.length === 0 && Math.abs((hole?.volume ?? 0) - (plain?.volume ?? 1)) < 0.5,
        `${said(tapped)}; ${hole?.volume.toFixed(1)} against ${plain?.volume.toFixed(1)}`,
      )
    })

    await check('cosmetic', async () => {
      const cosmetic = await evaluate(pegDoc({ modelled: false }))
      const untouched = meshOf(cosmetic, 'peg')
      add(
        'a thread that is not modelled leaves the peg alone',
        cosmetic.errors.length === 0 && Math.abs((untouched?.volume ?? 0) - plain) < 0.5,
        `${said(cosmetic)}; ${untouched?.volume.toFixed(1)} against ${plain.toFixed(1)}`,
      )
    })

    await check('internal thread', async () => {
      const result = await evaluate(nutDoc())
      const nut = meshOf(result, 'nut')
      const drilled = 16 * 16 * 8 - Math.PI * MINOR * MINOR * 8
      add(
        'a thread opens a tapped hole out towards its major diameter',
        result.errors.length === 0 &&
          !!nut &&
          nut.volume < drilled - 30 &&
          nut.volume > drilled - 150,
        `${said(result)}; ${nut?.volume.toFixed(1)} under drilled ${drilled.toFixed(1)}`,
      )
    })

    await check('long threads', async () => {
      const perMm = (plainVolume: number, volume: number, length: number) =>
        (plainVolume - volume) / length
      const short = meshOf(await evaluate(pegDoc()), 'peg')
      const longDoc = pegDoc()
      ;(longDoc.timeline[0] as { height: number }).height = 24
      const long = await evaluate(longDoc)
      const bolt = meshOf(long, 'peg')
      const shortRate = perMm(Math.PI * 16 * 8, short?.volume ?? 0, 8)
      const longRate = perMm(Math.PI * 16 * 24, bolt?.volume ?? 0, 24)
      add(
        'a 19-turn bolt is cut the same way all along',
        long.errors.length === 0 && Math.abs(longRate - shortRate) < 0.15 * shortRate,
        `${said(long)}; ${longRate.toFixed(2)} mm3 per mm against ${shortRate.toFixed(2)}`,
      )
      const deepDoc = nutDoc()
      ;(deepDoc.timeline[0] as { height: number }).height = 20
      ;(deepDoc.timeline[1] as { height: number }).height = 22
      const deep = await evaluate(deepDoc)
      const nut = meshOf(deep, 'nut')
      const shallow = meshOf(await evaluate(nutDoc()), 'nut')
      const drilled = (height: number) => 16 * 16 * height - Math.PI * MINOR * MINOR * height
      const deepRate = perMm(drilled(20), nut?.volume ?? 0, 20)
      const shallowRate = perMm(drilled(8), shallow?.volume ?? 0, 8)
      add(
        'a 16-turn tapped hole is cut the same way all along',
        deep.errors.length === 0 && Math.abs(deepRate - shallowRate) < 0.2 * shallowRate,
        `${said(deep)}; ${deepRate.toFixed(2)} mm3 per mm against ${shallowRate.toFixed(2)}`,
      )
    })

    await check('either end', async () => {
      const top = await evaluate(pegDoc({ anchors: [[4, 0, 8]] }))
      const bottom = meshOf(await evaluate(pegDoc()), 'peg')
      const flipped = meshOf(top, 'peg')
      add(
        'a thread started from the other end takes the same material',
        top.errors.length === 0 && Math.abs((flipped?.volume ?? 0) - (bottom?.volume ?? 1)) < 0.5,
        `${said(top)}; ${flipped?.volume.toFixed(1)} against ${bottom?.volume.toFixed(1)}`,
      )
    })

    await check('choosing a size', async () => {
      const auto = await evaluate(pegDoc({ auto: true, nominal: 0, pitch: 0 }))
      const matched = meshOf(await evaluate(pegDoc()), 'peg')
      const picked = meshOf(auto, 'peg')
      add(
        'Auto picks the standard size that fits the face',
        auto.errors.length === 0 && Math.abs((picked?.volume ?? 0) - (matched?.volume ?? 1)) < 0.5,
        `${said(auto)}; ${picked?.volume.toFixed(1)} against M8 ${matched?.volume.toFixed(1)}`,
      )
      const wrong = await evaluate(pegDoc({ nominal: 12, pitch: 1.75 }))
      add(
        'a size that does not match the peg says so',
        wrong.errors.some((error) => error.message.includes('an M12 thread is 12 mm')),
        said(wrong),
      )
      const hole = await evaluate(nutDoc({ nominal: 10, pitch: 1.5 }))
      add(
        'a hole the wrong size for its thread gives the tap drill',
        hole.errors.some((error) => error.message.includes('wants a 8.5 mm hole')),
        said(hole),
      )
    })

    await check('what it refuses', async () => {
      const long = await evaluate(pegDoc({ full: false, length: 30 }))
      add(
        'a thread longer than its face stops at the end and says so',
        long.errors.some((error) => error.message.includes('longer than the face')),
        said(long),
      )
      const flat = await evaluate(
        pegDoc({ faces: [{ bodyId: 'peg', kind: 'face', name: 'cy:+z' }] }),
      )
      add(
        'a flat face is refused',
        flat.errors.some((error) => error.message.includes('round face')),
        said(flat),
      )
      const stub = await evaluate(pegDoc({ full: false, length: 1, offset: 0 }))
      add(
        'a thread shorter than one turn is refused',
        stub.errors.some((error) => error.message.includes('one turn')),
        said(stub),
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
