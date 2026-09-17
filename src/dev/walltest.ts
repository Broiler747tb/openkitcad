import * as Comlink from 'comlink'
import type { Vec2, Vec3 } from '../core/math'
import type { BodyOperation, Feature, OkcDocument, PlaneRef } from '../doc/types'
import { emptyDocument } from '../doc/types'
import { couponLayout } from '../kernel/couponStep'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import { emptySketch, type Sketch2D } from '../sketch/types'
import type { TestResult } from './selftest'

const XY = (offset = 0): PlaneRef => ({ kind: 'named', name: 'XY', offset })

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
    plane: XY(offset),
    origin,
    width: size[0],
    depth: size[1],
    height: size[2],
    result,
  }
}

function lines(runs: Array<[Vec2, Vec2]>): Sketch2D {
  const sketch = emptySketch()
  runs.forEach(([a, b], index) => {
    sketch.points.push({ id: `a${index}`, x: a[0], y: a[1] })
    sketch.points.push({ id: `b${index}`, x: b[0], y: b[1] })
    sketch.entities.push({
      id: `l${index}`,
      kind: 'line',
      p1: `a${index}`,
      p2: `b${index}`,
      construction: false,
    })
  })
  return sketch
}

function wallDoc(
  bodies: Feature[],
  sketch: Sketch2D,
  plane: PlaneRef,
  wall: {
    kind: 'rib' | 'web'
    thickness?: number
    sides?: 'both' | 'one'
    flipSide?: boolean
    depth?: 'toNext' | 'finite'
    distance?: number
    flip?: boolean
    curves?: string[]
  },
): OkcDocument {
  const doc = emptyDocument('Walls')
  doc.components[0].bodies = [{ id: 'part', name: 'Part', visible: true, colour: '#cccccc' }]
  doc.timeline = [
    ...bodies,
    {
      id: 'sk',
      name: 'Sketch',
      componentId: 'root',
      kind: 'sketch',
      plane,
      sketch,
      visible: true,
    },
    {
      id: 'wl',
      name: wall.kind === 'rib' ? 'Rib' : 'Web',
      componentId: 'root',
      kind: wall.kind,
      sketchId: 'sk',
      curves: wall.curves ?? sketch.entities.map((entity) => entity.id),
      bodyId: 'part',
      thickness: wall.thickness ?? 3,
      sides: wall.sides ?? 'both',
      flipSide: wall.flipSide ?? false,
      depth: wall.depth ?? 'toNext',
      distance: wall.distance ?? 10,
      flip: wall.flip ?? false,
    },
  ]
  return doc
}

export async function runWallTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Walls: ${name}`, pass, detail })
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
  const meshOf = (result: EvaluateResult) => {
    const instance = result.instances.find((candidate) => candidate.bodyId === 'part')
    return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
  }
  const volumeOf = (result: EvaluateResult) => meshOf(result)?.volume ?? 0

  const corner = [
    box('floor', [0, 0], [40, 20, 4], 0, { kind: 'newBody', bodyId: 'part' }),
    box('wall', [0, 0], [4, 20, 30]),
  ]
  const CORNER_VOLUME = 40 * 20 * 4 + 4 * 20 * 30 - 4 * 20 * 4
  const side: PlaneRef = { kind: 'named', name: 'XZ', offset: -10 }

  try {
    await kernel.ready()

    await check('rib to the part', async () => {
      const gusset = lines([
        [
          [4, 20],
          [24, 4],
        ],
      ])
      const result = await evaluate(wallDoc(corner, gusset, side, { kind: 'rib' }))
      add(
        'a line across a corner becomes a gusset that lands on the floor',
        result.errors.length === 0 && Math.abs(volumeOf(result) - (CORNER_VOLUME + 160 * 3)) < 0.02,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of ${(CORNER_VOLUME + 480).toFixed(0)}`,
      )
      const stepped = [
        box('low', [0, 0], [20, 20, 4], 0, { kind: 'newBody', bodyId: 'part' }),
        box('high', [20, 0], [20, 20, 8]),
      ]
      const flat = lines([
        [
          [5, 16],
          [35, 16],
        ],
      ])
      const over = await evaluate(wallDoc(stepped, flat, side, { kind: 'rib' }))
      add(
        'a rib over a step follows the two levels under it',
        over.errors.length === 0 && Math.abs(volumeOf(over) - (4800 + 300 * 3)) < 0.02,
        `${said(over)}; volume ${volumeOf(over).toFixed(3)} of 5700`,
      )
    })

    await check('rib by distance', async () => {
      const flat = lines([
        [
          [8, 6],
          [28, 6],
        ],
      ])
      const result = await evaluate(
        wallDoc(corner, flat, side, { kind: 'rib', depth: 'finite', distance: 6 }),
      )
      add(
        'a rib given a depth grows exactly that far',
        result.errors.length === 0 && Math.abs(volumeOf(result) - (CORNER_VOLUME + 120)) < 0.02,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of ${(CORNER_VOLUME + 120).toFixed(0)}`,
      )
    })

    await check('thickness sides', async () => {
      const gusset = lines([
        [
          [4, 20],
          [24, 4],
        ],
      ])
      const edge: PlaneRef = { kind: 'named', name: 'XZ', offset: 0 }
      const centred = await evaluate(wallDoc(corner, gusset, edge, { kind: 'rib' }))
      const along = await evaluate(wallDoc(corner, gusset, edge, { kind: 'rib', sides: 'one' }))
      const back = await evaluate(
        wallDoc(corner, gusset, edge, { kind: 'rib', sides: 'one', flipSide: true }),
      )
      const minY = (result: EvaluateResult) => meshOf(result)?.bounds[1] ?? NaN
      add(
        'the line is the middle of the wall, or one of its sides',
        Math.abs(minY(centred) + 1.5) < 0.01 &&
          Math.abs(minY(along) + 3) < 0.01 &&
          Math.abs(minY(back)) < 0.01,
        `${minY(centred).toFixed(2)}, ${minY(along).toFixed(2)}, ${minY(back).toFixed(2)}`,
      )
    })

    await check('web of crossing lines', async () => {
      const slab = [box('slab', [0, 0], [40, 30, 10], 0, { kind: 'newBody', bodyId: 'part' })]
      const network = lines([
        [
          [5, 15],
          [35, 15],
        ],
        [
          [20, 5],
          [20, 25],
        ],
      ])
      const result = await evaluate(wallDoc(slab, network, XY(20), { kind: 'web', thickness: 2 }))
      add(
        'crossing lines become walls that stand on the part and meet',
        result.errors.length === 0 && Math.abs(volumeOf(result) - (12000 + 960)) < 0.02,
        `${said(result)}; volume ${volumeOf(result).toFixed(3)} of 12960`,
      )
      const asRib = await evaluate(wallDoc(slab, network, XY(20), { kind: 'rib', thickness: 2 }))
      add(
        'a rib refuses a set of separate lines',
        asRib.errors.some((error) => error.message.includes('one run of lines')),
        said(asRib),
      )
    })

    await check('fit test coupon', async () => {
      const coupon = (patch: Record<string, unknown> = {}): OkcDocument => {
        const doc = emptyDocument('Coupon')
        doc.components[0].bodies = [
          { id: 'pins', name: 'Pins', visible: true, colour: '#cccccc' },
          { id: 'holes', name: 'Holes', visible: true, colour: '#cccccc' },
        ]
        doc.timeline = [
          {
            id: 'cp',
            name: 'Coupon',
            componentId: 'root',
            kind: 'fitCoupon',
            plane: XY(0),
            origin: [0, 0],
            diameter: 5,
            start: 0.1,
            step: 0.05,
            count: 7,
            thickness: 3,
            height: 6,
            pinBodyId: 'pins',
            holeBodyId: 'holes',
            ...patch,
          } as Feature,
        ]
        return doc
      }
      const built = await evaluate(coupon())
      const pins = built.instances.find((instance) => instance.bodyId === 'pins')
      const holes = built.instances.find((instance) => instance.bodyId === 'holes')
      const pinMesh = pins ? built.meshes.find((mesh) => mesh.key === pins.meshKey) : undefined
      const holeMesh = holes ? built.meshes.find((mesh) => mesh.key === holes.meshKey) : undefined
      add(
        'a coupon prints as a card of pins and a card of holes',
        built.errors.length === 0 &&
          !!pinMesh &&
          !!holeMesh &&
          Math.abs((pinMesh?.bounds[5] ?? 0) - 9) < 0.05 &&
          Math.abs((holeMesh?.bounds[5] ?? 0) - 3) < 0.05 &&
          (pinMesh?.volume ?? 0) > (holeMesh?.volume ?? 0),
        `${said(built)}; pins to ${pinMesh?.bounds[5].toFixed(2)} mm, holes to ${holeMesh?.bounds[5].toFixed(2)} mm`,
      )

      const probe = async (rung: number, diameter: number) => {
        const doc = coupon()
        const layout = couponLayout({
          origin: [0, 0],
          diameter: 5,
          start: 0.1,
          step: 0.05,
          count: 7,
        })
        const gap = layout.gaps[rung]
        const x = layout.centreOf(rung)
        const y = layout.holeY
        doc.timeline.push(
          {
            id: 'pr',
            name: 'Probe',
            componentId: 'root',
            kind: 'cylinder',
            plane: XY(-1),
            centre: [x, y],
            radius: diameter / 2,
            height: 5,
            result: { kind: 'newBody', bodyId: 'probe' },
          } as Feature,
          {
            id: 'cm',
            name: 'Check',
            componentId: 'root',
            kind: 'combine',
            bodyId: 'probe',
            toolBodyIds: ['holes'],
            operation: 'intersect',
            keepTools: true,
          } as Feature,
        )
        doc.components[0].bodies.push({
          id: 'probe',
          name: 'Probe',
          visible: true,
          colour: '#cccccc',
        })
        const result = await evaluate(doc)
        const instance = result.instances.find((candidate) => candidate.bodyId === 'probe')
        const mesh = instance
          ? result.meshes.find((candidate) => candidate.key === instance.meshKey)
          : undefined
        return { gap, volume: mesh?.volume ?? 0, said: said(result) }
      }
      const loose = await probe(0, 5 + 2 * 0.1 - 0.06)
      const tight = await probe(0, 5 + 2 * 0.1 + 0.06)
      const last = await probe(6, 5 + 2 * 0.4 - 0.06)
      add(
        'each rung is a hole of the pin plus twice its gap',
        loose.volume < 0.01 && tight.volume > 0.05 && last.volume < 0.01,
        `first rung ${loose.volume.toFixed(3)} under, ${tight.volume.toFixed(3)} over; last rung ${last.volume.toFixed(3)}`,
      )

      const silly = await evaluate(coupon({ step: 2 }))
      add(
        'a step that runs past the pin is refused',
        silly.errors.some((error) => error.message.includes('looser than the pin is wide')),
        said(silly),
      )
    })

    await check('walls that miss', async () => {
      const gusset = lines([
        [
          [4, 20],
          [24, 4],
        ],
      ])
      const away = await evaluate(wallDoc(corner, gusset, side, { kind: 'rib', flip: true }))
      add(
        'a rib grown away from the part says so',
        away.errors.some((error) => error.message.includes('never reaches')),
        said(away),
      )
    })
  } catch (error) {
    add('suite', false, `threw: ${(error as Error)?.message ?? error}`)
  } finally {
    worker.terminate()
  }
  return out
}
