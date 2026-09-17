import * as Comlink from 'comlink'
import type { Vec2, Vec3 } from '../core/math'
import { getPart } from '../catalogue'
import { glandSpec, tieSpec } from '../doc/cables'
import type { BodyOperation, Feature, Matrix4, OkcDocument } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

function box(
  id: string,
  origin: Vec2,
  size: Vec3,
  offset = 0,
  result: BodyOperation = { kind: 'join', bodyId: 'part' },
): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'box',
    plane: { kind: 'named', name: 'XY', offset },
    origin,
    width: size[0],
    depth: size[1],
    height: size[2],
    result,
  }
}

const PLATE = box('plate', [-30, -20], [60, 40, 3], 0, { kind: 'newBody', bodyId: 'part' })
const PLATE_VOLUME = 60 * 40 * 3

function entryDoc(patch: Record<string, unknown>, bodies: Feature[] = [PLATE]): OkcDocument {
  const doc = emptyDocument('Cables')
  doc.components[0].bodies = [
    { id: 'part', name: 'Part', visible: true, colour: '#cccccc' },
    { id: 'bar', name: 'Clamp Bar', visible: true, colour: '#cccccc' },
  ]
  doc.timeline = [
    ...bodies,
    {
      id: 'ce',
      name: 'Cable Entry',
      componentId: 'root',
      kind: 'cableEntry',
      entry: 'grommet',
      bodyId: 'part',
      plane: { kind: 'face', face: { bodyId: 'part', kind: 'face', name: 'plate:+z' }, offset: 0 },
      position: [0, 0],
      angle: 0,
      cable: 6,
      clearance: 0.5,
      gland: 'PG9',
      tie: 'large',
      screw: 'M3',
      nutRoom: true,
      ...patch,
    } as Feature,
  ]
  return doc
}

const PI: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -42.5, -28, 6, 1]

function clipsDoc(patch: Record<string, unknown> = {}): OkcDocument {
  const doc = emptyDocument('Clips')
  doc.components[0].bodies = [{ id: 'part', name: 'Case', visible: true, colour: '#cccccc' }]
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
    box('floor', [-50, -35], [100, 70, 6], 0, { kind: 'newBody', bodyId: 'part' }),
    {
      id: 'cl',
      name: 'Clips',
      componentId: 'root',
      kind: 'boardClips',
      bodyId: 'part',
      occurrencePath: ['pi'],
      contextPath: [],
      count: 2,
      width: 8,
      post: 2.4,
      grip: 1.2,
      ledge: 1.2,
      hook: 1.2,
      gap: 0.2,
      ...patch,
    } as Feature,
  ]
  return doc
}

export async function runCableTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Cables: ${name}`, pass, detail })
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
  const volumeOf = (result: EvaluateResult, bodyId = 'part') => meshOf(result, bodyId)?.volume ?? 0

  const frustum = (small: number, big: number, height: number) =>
    (Math.PI * height * (small * small + small * big + big * big)) / 3
  const chamferRing = (radius: number, lead: number) =>
    frustum(radius, radius + lead, lead) - Math.PI * radius * radius * lead

  try {
    await kernel.ready()

    await check('grommet hole', async () => {
      const result = await evaluate(entryDoc({}))
      const radius = 3.5
      const lead = 0.6
      const expected = PLATE_VOLUME - Math.PI * radius * radius * 3 - 2 * chamferRing(radius, lead)
      add(
        'a grommet hole goes through the wall and is chamfered both sides',
        result.errors.length === 0 && Math.abs(volumeOf(result) - expected) < 0.5,
        `${said(result)}; volume ${volumeOf(result).toFixed(2)} of ${expected.toFixed(2)}`,
      )
    })

    await check('cable gland', async () => {
      const result = await evaluate(entryDoc({ entry: 'gland', gland: 'PG9', cable: 6 }))
      const gland = glandSpec('PG9')
      const radius = gland.hole / 2 + 0.5
      const lead = 0.6
      const expected = PLATE_VOLUME - Math.PI * radius * radius * 3 - chamferRing(radius, lead)
      add(
        'a gland hole is the panel size and the nut room misses the wall',
        result.errors.length === 0 && Math.abs(volumeOf(result) - expected) < 0.5,
        `${said(result)}; volume ${volumeOf(result).toFixed(2)} of ${expected.toFixed(2)}`,
      )
      const wrong = await evaluate(entryDoc({ entry: 'gland', gland: 'PG9', cable: 13 }))
      add(
        'a cable too fat for its gland is called out',
        wrong.errors.some((error) => error.message.includes('grips 4 to 8 mm')),
        said(wrong),
      )
    })

    await check('zip-tie anchor', async () => {
      const result = await evaluate(entryDoc({ entry: 'tie', tie: 'large', cable: 6 }))
      const tie = tieSpec('large')
      const slotWidth = tie.width + 0.6
      const slotHeight = tie.thickness + 0.4
      const width = slotWidth + 8
      const depth = 10
      const height = slotHeight + 1.6
      const expected = PLATE_VOLUME + width * depth * height - slotWidth * depth * slotHeight
      add(
        'a zip-tie anchor is a bridge with a slot under it',
        result.errors.length === 0 && Math.abs(volumeOf(result) - expected) < 0.5,
        `${said(result)}; volume ${volumeOf(result).toFixed(2)} of ${expected.toFixed(2)}`,
      )
    })

    await check('strain relief', async () => {
      const doc = entryDoc({ entry: 'clamp', screw: 'M3', cable: 6, barBodyId: 'bar' })
      const result = await evaluate(doc)
      const bar = meshOf(result, 'bar')
      add(
        'a strain relief adds two posts and a bar to screw down',
        result.errors.length === 0 &&
          volumeOf(result) > PLATE_VOLUME &&
          !!bar &&
          bar.volume > 50 &&
          bar.bounds[2] > 3,
        `${said(result)}; part ${volumeOf(result).toFixed(1)}, bar ${bar?.volume.toFixed(1)} from z ${bar?.bounds[2].toFixed(2)}`,
      )
    })
    await check('board clips', async () => {
      const result = await evaluate(clipsDoc())
      const mesh = meshOf(result, 'part')
      const floor = 100 * 70 * 6
      const part = getPart('raspberry-pi-4b')
      const board = part?.geometry.kind === 'board' ? part.geometry.thickness : 1.4
      const top = 6 + board + 0.1 + 1.2 + (0.2 + 1.2 + 2.4)
      add(
        'clips stand on the floor and reach over a placed board',
        result.errors.length === 0 &&
          !!mesh &&
          mesh.volume > floor &&
          Math.abs((mesh?.bounds[5] ?? 0) - top) < 0.1,
        `${said(result)}; volume ${(mesh?.volume ?? 0).toFixed(1)} over ${floor}, top ${mesh?.bounds[5].toFixed(2)} of ${top.toFixed(2)}`,
      )
      const four = await evaluate(clipsDoc({ count: 3 }))
      const more = meshOf(four, 'part')
      add(
        'more clips per edge add more material',
        four.errors.length === 0 && (more?.volume ?? 0) > (mesh?.volume ?? 0),
        `${said(four)}; ${(more?.volume ?? 0).toFixed(1)} against ${(mesh?.volume ?? 0).toFixed(1)}`,
      )
      const gone = clipsDoc()
      gone.occurrences = []
      const missing = await evaluate(gone)
      add(
        'clips whose board has gone say so',
        missing.errors.some((error) => error.message.includes('board these clips')),
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
