import * as Comlink from 'comlink'
import type { Body, Feature, OkcDocument, PlaneRef } from '../doc/types'
import { emptyDocument } from '../doc/types'
import type { BodyMesh, EvaluateResult, KernelApi } from '../kernel/types'
import { emptySketch, type Sketch2D } from '../sketch/types'
import type { TestResult } from './selftest'

const XY: PlaneRef = { kind: 'named', name: 'XY', offset: 0 }

function body(id: string): Body {
  return { id, name: id, visible: true, colour: '#cccccc' }
}

function sketch(id: string, plane: PlaneRef, drawing: Sketch2D): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'sketch',
    plane,
    sketch: drawing,
    visible: true,
  }
}

function rectangle(x: number, y: number, w: number, h: number): Sketch2D {
  const s = emptySketch()
  const corners: Array<[number, number]> = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
  corners.forEach(([px, py], i) => s.points.push({ id: `p${i}`, x: px, y: py }))
  for (let i = 0; i < 4; i++) {
    s.entities.push({
      id: `l${i}`,
      kind: 'line',
      p1: `p${i}`,
      p2: `p${(i + 1) % 4}`,
      construction: false,
    })
  }
  return s
}

function circle(x: number, y: number, r: number): Sketch2D {
  const s = emptySketch()
  s.points.push({ id: 'c', x, y })
  s.entities.push({ id: 'k', kind: 'circle', c: 'c', r, construction: false })
  return s
}

function polyline(points: Array<[number, number]>): Sketch2D {
  const s = emptySketch()
  points.forEach(([x, y], i) => s.points.push({ id: `q${i}`, x, y }))
  for (let i = 0; i + 1 < points.length; i++) {
    s.entities.push({
      id: `m${i}`,
      kind: 'line',
      p1: `q${i}`,
      p2: `q${i + 1}`,
      construction: false,
    })
  }
  return s
}

function box(
  id: string,
  bodyId: string,
  origin: [number, number],
  size: [number, number, number],
): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'box',
    plane: XY,
    origin,
    width: size[0],
    depth: size[1],
    height: size[2],
    result: { kind: 'newBody', bodyId },
  }
}

function doc(features: Feature[], bodies: string[]): OkcDocument {
  const out = emptyDocument('Solids')
  out.timeline = features
  out.components[0].bodies = bodies.map(body)
  return out
}

function meshFor(result: EvaluateResult, bodyId: string): BodyMesh | undefined {
  const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
  return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
}

function errorText(result: EvaluateResult): string {
  return result.errors.map((e) => `${e.featureId}: ${e.message}`).join('; ')
}

export async function runSolidTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Solids: ${name}`, pass, detail })
  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const evaluate = (d: OkcDocument) => kernel.evaluate(d, [])
  const near = (value: number | undefined, expected: number, tolerance: number) =>
    value !== undefined && Math.abs(value - expected) <= tolerance

  const check = async (
    name: string,
    d: OkcDocument,
    test: (result: EvaluateResult) => { pass: boolean; detail: string },
  ) => {
    try {
      const result = await evaluate(d)
      if (result.errors.length) {
        add(name, false, errorText(result))
        return
      }
      const { pass, detail } = test(result)
      add(name, pass, detail)
    } catch (error) {
      add(name, false, `threw: ${(error as Error).message}`)
    }
  }

  try {
    await kernel.ready()

    await check(
      'a loft blends a square into a circle',
      doc(
        [
          sketch('s1', XY, rectangle(-10, -10, 20, 20)),
          sketch('s2', { kind: 'named', name: 'XY', offset: 30 }, circle(0, 0, 6)),
          {
            id: 'lf',
            name: 'Loft',
            componentId: 'root',
            kind: 'loft',
            sections: [{ sketchId: 's1' }, { sketchId: 's2' }],
            ruled: false,
            surface: false,
            result: { kind: 'newBody', bodyId: 'loft' },
          },
        ],
        ['loft'],
      ),
      (result) => {
        const mesh = meshFor(result, 'loft')
        const volume = mesh?.volume ?? 0
        return {
          pass: mesh?.kind === 'solid' && volume > Math.PI * 36 * 30 && volume < 12000,
          detail: `${mesh?.kind}, ${volume.toFixed(1)} mm3`,
        }
      },
    )

    await check(
      'a surface loft is an open surface',
      doc(
        [
          sketch('s1', XY, circle(0, 0, 10)),
          sketch('s2', { kind: 'named', name: 'XY', offset: 20 }, circle(0, 0, 5)),
          {
            id: 'lf',
            name: 'Loft',
            componentId: 'root',
            kind: 'loft',
            sections: [{ sketchId: 's1' }, { sketchId: 's2' }],
            ruled: true,
            surface: true,
            result: { kind: 'newBody', bodyId: 'skin' },
          },
        ],
        ['skin'],
      ),
      (result) => {
        const mesh = meshFor(result, 'skin')
        return { pass: mesh?.kind === 'surface', detail: `${mesh?.kind}` }
      },
    )

    await check(
      'a circle swept along a straight path makes a rod',
      doc(
        [
          sketch('s1', { kind: 'named', name: 'XZ', offset: 0 }, circle(0, 0, 2)),
          sketch(
            's2',
            XY,
            polyline([
              [0, 0],
              [0, 40],
            ]),
          ),
          {
            id: 'sw',
            name: 'Sweep',
            componentId: 'root',
            kind: 'sweep',
            sketchId: 's1',
            pathSketchId: 's2',
            surface: false,
            result: { kind: 'newBody', bodyId: 'rod' },
          },
        ],
        ['rod'],
      ),
      (result) => {
        const volume = meshFor(result, 'rod')?.volume
        return { pass: near(volume, Math.PI * 4 * 40, 1), detail: `${volume?.toFixed(3)} mm3` }
      },
    )

    await check(
      'a circle swept along a bent path turns a mitred corner',
      doc(
        [
          sketch('s1', XY, circle(0, 0, 2)),
          sketch(
            's2',
            { kind: 'named', name: 'XZ', offset: 0 },
            polyline([
              [0, 0],
              [0, 30],
              [20, 30],
            ]),
          ),
          {
            id: 'sw',
            name: 'Sweep',
            componentId: 'root',
            kind: 'sweep',
            sketchId: 's1',
            pathSketchId: 's2',
            surface: false,
            result: { kind: 'newBody', bodyId: 'elbow' },
          },
        ],
        ['elbow'],
      ),
      (result) => {
        const volume = meshFor(result, 'elbow')?.volume
        return {
          pass: near(volume, Math.PI * 4 * 50, 2) && !result.errors.length,
          detail: `${volume?.toFixed(3)} mm3 ${errorText(result)}`,
        }
      },
    )

    const pipe = (hollow: boolean) =>
      doc(
        [
          sketch(
            's1',
            XY,
            polyline([
              [0, 0],
              [30, 0],
              [30, 20],
            ]),
          ),
          {
            id: 'pp',
            name: 'Pipe',
            componentId: 'root',
            kind: 'pipe',
            pathSketchId: 's1',
            section: 'circular',
            size: 4,
            hollow,
            thickness: 1,
            result: { kind: 'newBody', bodyId: 'pipe' },
          },
        ],
        ['pipe'],
      )
    let solidPipe = 0
    await check('a pipe follows a bent path', pipe(false), (result) => {
      solidPipe = meshFor(result, 'pipe')?.volume ?? 0
      return {
        pass: solidPipe > Math.PI * 4 * 45 && solidPipe < Math.PI * 4 * 52,
        detail: `${solidPipe.toFixed(1)} mm3`,
      }
    })
    await check('a hollow pipe keeps a wall', pipe(true), (result) => {
      const hollow = meshFor(result, 'pipe')?.volume ?? 0
      const expected = solidPipe * (1 - 1 / 4)
      return {
        pass: near(hollow, expected, expected * 0.05),
        detail: `${hollow.toFixed(1)} mm3 against ${expected.toFixed(1)}`,
      }
    })

    await check(
      'a coil has the volume of its wire',
      doc(
        [
          {
            id: 'cl',
            name: 'Coil',
            componentId: 'root',
            kind: 'coil',
            plane: XY,
            centre: [0, 0],
            diameter: 20,
            revolutions: 5,
            height: 30,
            section: 'circular',
            sectionSize: 2,
            clockwise: false,
            result: { kind: 'newBody', bodyId: 'coil' },
          },
        ],
        ['coil'],
      ),
      (result) => {
        const volume = meshFor(result, 'coil')?.volume ?? 0
        const expected = Math.PI * 5 * Math.hypot(Math.PI * 20, 6)
        return {
          pass: near(volume, expected, expected * 0.1),
          detail: `${volume.toFixed(1)} against ${expected.toFixed(1)}`,
        }
      },
    )

    await check(
      'a patch thickens into a slab',
      doc(
        [
          sketch('s1', XY, rectangle(0, 0, 20, 10)),
          {
            id: 'pt',
            name: 'Patch',
            componentId: 'root',
            kind: 'patch',
            sketchId: 's1',
            bodyId: 'sheet',
          },
          {
            id: 'tk',
            name: 'Thicken',
            componentId: 'root',
            kind: 'thicken',
            sourceBodyId: 'sheet',
            thickness: 2,
            symmetric: false,
            result: { kind: 'newBody', bodyId: 'slab' },
          },
        ],
        ['sheet', 'slab'],
      ),
      (result) => {
        const sheet = meshFor(result, 'sheet')
        const slab = meshFor(result, 'slab')
        return {
          pass: sheet?.kind === 'surface' && slab?.kind === 'solid' && near(slab.volume, 400, 1e-3),
          detail: `${sheet?.kind} then ${slab?.kind} of ${slab?.volume.toFixed(3)} mm3`,
        }
      },
    )

    await check(
      'a rectangular pattern copies a box in rows and columns',
      doc(
        [
          box('bx', 'cube', [0, 0], [10, 10, 10]),
          {
            id: 'pa',
            name: 'Pattern',
            componentId: 'root',
            kind: 'bodyPattern',
            bodyIds: ['cube'],
            pattern: 'rectangular',
            axisOne: 'x',
            countOne: 3,
            spacingOne: 20,
            axisTwo: 'y',
            countTwo: 2,
            spacingTwo: 30,
            axis: 'z',
            count: 1,
            angle: 360,
            newBodyIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
          },
        ],
        ['cube', 'c1', 'c2', 'c3', 'c4', 'c5'],
      ),
      (result) => {
        const corners = ['cube', 'c1', 'c2', 'c3', 'c4', 'c5'].map((id) => {
          const bounds = meshFor(result, id)?.bounds
          return bounds ? `${Math.round(bounds[0])},${Math.round(bounds[1])}` : 'missing'
        })
        return {
          pass: corners.sort().join(' ') === '0,0 0,30 20,0 20,30 40,0 40,30',
          detail: corners.join(' '),
        }
      },
    )

    await check(
      'a circular pattern spreads copies around the axis',
      doc(
        [
          box('bx', 'cube', [20, -5], [10, 10, 10]),
          {
            id: 'pa',
            name: 'Pattern',
            componentId: 'root',
            kind: 'bodyPattern',
            bodyIds: ['cube'],
            pattern: 'circular',
            axisOne: 'x',
            countOne: 1,
            spacingOne: 0,
            axisTwo: 'y',
            countTwo: 1,
            spacingTwo: 0,
            axis: 'z',
            count: 4,
            angle: 360,
            newBodyIds: ['c1', 'c2', 'c3'],
          },
        ],
        ['cube', 'c1', 'c2', 'c3'],
      ),
      (result) => {
        const opposite = meshFor(result, 'c2')?.bounds
        return {
          pass: !!opposite && near(opposite[0], -30, 1e-6) && near(opposite[3], -20, 1e-6),
          detail: `the half-turn copy spans x ${opposite?.[0]} to ${opposite?.[3]}`,
        }
      },
    )

    await check(
      'a mirror copies a box across the YZ plane',
      doc(
        [
          box('bx', 'cube', [5, 0], [10, 10, 10]),
          {
            id: 'mr',
            name: 'Mirror',
            componentId: 'root',
            kind: 'mirror',
            bodyIds: ['cube'],
            plane: { kind: 'named', name: 'YZ', offset: 0 },
            newBodyIds: ['image'],
          },
        ],
        ['cube', 'image'],
      ),
      (result) => {
        const image = meshFor(result, 'image')
        return {
          pass: !!image && near(image.bounds[0], -15, 1e-6) && near(image.volume, 1000, 1e-3),
          detail: `x ${image?.bounds[0]} to ${image?.bounds[3]}, ${image?.volume.toFixed(3)} mm3`,
        }
      },
    )

    await check(
      'split body cuts a box in two along a plane',
      doc(
        [
          box('bx', 'cube', [0, 0], [10, 10, 10]),
          {
            id: 'sp',
            name: 'Split',
            componentId: 'root',
            kind: 'splitBody',
            bodyId: 'cube',
            plane: { kind: 'named', name: 'XY', offset: 4 },
            newBodyId: 'lower',
          },
        ],
        ['cube', 'lower'],
      ),
      (result) => {
        const upper = meshFor(result, 'cube')?.volume
        const lower = meshFor(result, 'lower')?.volume
        return {
          pass: near(upper, 600, 1e-3) && near(lower, 400, 1e-3),
          detail: `${upper?.toFixed(3)} and ${lower?.toFixed(3)} mm3`,
        }
      },
    )

    await check(
      'scale doubles a box',
      doc(
        [
          box('bx', 'cube', [0, 0], [10, 10, 10]),
          {
            id: 'sc',
            name: 'Scale',
            componentId: 'root',
            kind: 'scale',
            bodyIds: ['cube'],
            factor: 2,
          },
        ],
        ['cube'],
      ),
      (result) => {
        const volume = meshFor(result, 'cube')?.volume
        return { pass: near(volume, 8000, 1e-3), detail: `${volume?.toFixed(3)} mm3` }
      },
    )

    const faces = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5']
    await check(
      'unstitching a box gives six surfaces and stitching them makes it solid again',
      doc(
        [
          box('bx', 'f0', [0, 0], [10, 10, 10]),
          {
            id: 'un',
            name: 'Unstitch',
            componentId: 'root',
            kind: 'unstitch',
            bodyId: 'f0',
            newBodyIds: faces.slice(1),
          },
          {
            id: 'st',
            name: 'Stitch',
            componentId: 'root',
            kind: 'stitch',
            bodyIds: faces,
            tolerance: 0.01,
          },
        ],
        faces,
      ),
      (result) => {
        const stitched = meshFor(result, 'f0')
        const others = faces.slice(1).filter((id) => meshFor(result, id)).length
        return {
          pass: stitched?.kind === 'solid' && near(stitched.volume, 1000, 1e-3) && others === 0,
          detail: `${stitched?.kind} of ${stitched?.volume.toFixed(3)} mm3, ${others} loose faces left`,
        }
      },
    )

    await check(
      'an offset surface lies a set distance away',
      doc(
        [
          sketch('s1', XY, rectangle(0, 0, 20, 10)),
          {
            id: 'pt',
            name: 'Patch',
            componentId: 'root',
            kind: 'patch',
            sketchId: 's1',
            bodyId: 'sheet',
          },
          {
            id: 'of',
            name: 'Offset',
            componentId: 'root',
            kind: 'surfaceOffset',
            sourceBodyId: 'sheet',
            distance: 3,
            bodyId: 'lifted',
          },
          {
            id: 'rv',
            name: 'Reverse',
            componentId: 'root',
            kind: 'reverseNormal',
            bodyIds: ['sheet'],
          },
        ],
        ['sheet', 'lifted'],
      ),
      (result) => {
        const lifted = meshFor(result, 'lifted')
        return {
          pass: lifted?.kind === 'surface' && near(Math.abs(lifted.bounds[2]), 3, 1e-6),
          detail: `${lifted?.kind} at z ${lifted?.bounds[2]}`,
        }
      },
    )

    await check(
      'a surface extrude of an open line makes a wall',
      doc(
        [
          sketch(
            's1',
            XY,
            polyline([
              [0, 0],
              [10, 0],
              [10, 6],
            ]),
          ),
          {
            id: 'ex',
            name: 'Extrude',
            componentId: 'root',
            kind: 'extrude',
            sketchId: 's1',
            distance: 5,
            symmetric: false,
            reverse: false,
            surface: true,
            result: { kind: 'newBody', bodyId: 'wall' },
          },
        ],
        ['wall'],
      ),
      (result) => {
        const wall = meshFor(result, 'wall')
        return {
          pass:
            wall?.kind === 'surface' &&
            near(wall.bounds[5], 5, 1e-6) &&
            near(wall.bounds[4], 6, 1e-6),
          detail: `${wall?.kind}, ${wall?.bounds.map((v) => v.toFixed(2)).join(' ')}`,
        }
      },
    )

    const offsetFace = (id: string, distance: number): Feature => ({
      id,
      name: id,
      componentId: 'root',
      kind: 'offsetFace',
      bodyId: 'cube',
      faces: [{ bodyId: 'cube', kind: 'face', name: 'bx:+z' }],
      distance,
    })
    await check(
      'offset face pulls a face out and a later step still finds it',
      doc([box('bx', 'cube', [0, 0], [10, 10, 10]), offsetFace('up', 5)], ['cube']),
      (result) => {
        const cube = meshFor(result, 'cube')
        return {
          pass: near(cube?.volume, 1500, 1e-3) && near(cube?.bounds[5], 15, 1e-6),
          detail: `${cube?.volume.toFixed(3)} mm3, top at ${cube?.bounds[5]}`,
        }
      },
    )
    await check(
      'a face that was offset can be pushed back in by name',
      doc(
        [box('bx', 'cube', [0, 0], [10, 10, 10]), offsetFace('up', 5), offsetFace('down', -8)],
        ['cube'],
      ),
      (result) => {
        const cube = meshFor(result, 'cube')
        return {
          pass: near(cube?.volume, 700, 1e-3) && near(cube?.bounds[5], 7, 1e-6),
          detail: `${cube?.volume.toFixed(3)} mm3, top at ${cube?.bounds[5]}`,
        }
      },
    )
    try {
      const curved = await evaluate(
        doc(
          [
            {
              id: 'cy',
              name: 'cy',
              componentId: 'root',
              kind: 'cylinder',
              plane: XY,
              centre: [0, 0],
              radius: 5,
              height: 10,
              result: { kind: 'newBody', bodyId: 'rod' },
            },
            {
              id: 'push',
              name: 'push',
              componentId: 'root',
              kind: 'offsetFace',
              bodyId: 'rod',
              faces: [{ bodyId: 'rod', kind: 'face', name: 'cy:side' }],
              distance: 1,
            },
          ],
          ['rod'],
        ),
      )
      add(
        'offset face refuses a curved face',
        curved.errors.some((error) => error.featureId === 'push'),
        errorText(curved),
      )
    } catch (error) {
      add('offset face refuses a curved face', false, `threw: ${(error as Error).message}`)
    }
    await check(
      'draft tilts a side face about the neutral plane',
      doc(
        [
          box('bx', 'cube', [0, 0], [20, 20, 20]),
          {
            id: 'dr',
            name: 'Draft',
            componentId: 'root',
            kind: 'draft',
            bodyId: 'cube',
            faces: [{ bodyId: 'cube', kind: 'face', name: 'bx:+x' }],
            plane: XY,
            angle: 10,
            flip: false,
          },
        ],
        ['cube'],
      ),
      (result) => {
        const volume = meshFor(result, 'cube')?.volume ?? 0
        const wedge = 0.5 * 20 * 20 * 20 * Math.tan((10 * Math.PI) / 180)
        return {
          pass: near(Math.abs(volume - 8000), wedge, 1),
          detail: `${volume.toFixed(1)} mm3, wedge ${wedge.toFixed(1)}`,
        }
      },
    )

    const plane = (id: string, extra: Partial<Feature>): Feature =>
      ({
        id,
        name: id,
        componentId: 'root',
        kind: 'constructionPlane',
        method: 'offset',
        base: XY,
        distance: 0,
        axis: 'x',
        angle: 0,
        visible: true,
        ...extra,
      }) as Feature
    await check(
      'a sketch on an offset plane builds up from that plane',
      doc(
        [
          plane('p1', { distance: 12 }),
          plane('p2', { base: { kind: 'construction', featureId: 'p1', offset: 0 }, distance: 3 }),
          sketch(
            's1',
            { kind: 'construction', featureId: 'p2', offset: 0 },
            rectangle(0, 0, 10, 10),
          ),
          {
            id: 'ex',
            name: 'Extrude',
            componentId: 'root',
            kind: 'extrude',
            sketchId: 's1',
            distance: 5,
            symmetric: false,
            reverse: false,
            result: { kind: 'newBody', bodyId: 'raised' },
          },
        ],
        ['raised'],
      ),
      (result) => {
        const raised = meshFor(result, 'raised')
        const p2 = result.planes.find((entry) => entry.featureId === 'p2')
        return {
          pass: near(raised?.bounds[2], 15, 1e-6) && near(raised?.bounds[5], 20, 1e-6) && !!p2,
          detail: `z ${raised?.bounds[2]} to ${raised?.bounds[5]}`,
        }
      },
    )
    await check(
      'a midplane between two box faces and a plane at an angle resolve',
      doc(
        [
          box('bx', 'cube', [0, 0], [10, 10, 10]),
          plane('mid', {
            method: 'midplane',
            base: {
              kind: 'face',
              face: { bodyId: 'cube', kind: 'face', name: 'bx:+x' },
              offset: 0,
            },
            second: {
              kind: 'face',
              face: { bodyId: 'cube', kind: 'face', name: 'bx:-x' },
              offset: 0,
            },
          }),
          plane('tilt', { method: 'angle', axis: 'y', angle: 30 }),
        ],
        ['cube'],
      ),
      (result) => {
        const mid = result.planes.find((entry) => entry.featureId === 'mid')?.frame
        const tilt = result.planes.find((entry) => entry.featureId === 'tilt')?.frame
        const offset = mid ? mid.origin[0] * mid.normal[0] : NaN
        return {
          pass:
            !!mid &&
            Math.abs(Math.abs(mid.normal[0]) - 1) < 1e-9 &&
            near(offset, 5, 1e-6) &&
            !!tilt &&
            near(Math.abs(tilt.normal[2]), Math.cos(Math.PI / 6), 1e-9),
          detail: `mid ${mid?.origin.join(',')} n ${mid?.normal.join(',')}; tilt n ${tilt?.normal.map((v) => v.toFixed(3)).join(',')}`,
        }
      },
    )

    await check(
      'a torus has the volume of its tube carried round the ring',
      doc(
        [
          {
            id: 'to',
            name: 'Torus',
            componentId: 'root',
            kind: 'torus',
            plane: { kind: 'named', name: 'XY', offset: 5 },
            centre: [3, 4],
            majorRadius: 10,
            minorRadius: 2,
            result: { kind: 'newBody', bodyId: 'ring' },
          },
        ],
        ['ring'],
      ),
      (result) => {
        const ring = meshFor(result, 'ring')
        const expected = 2 * Math.PI * Math.PI * 10 * 4
        return {
          pass:
            near(ring?.volume, expected, 0.5) &&
            near(ring?.bounds[2], 3, 0.05) &&
            near(ring?.bounds[0], -9, 0.05),
          detail: `${ring?.volume.toFixed(2)} mm3 of ${expected.toFixed(2)}, bounds ${ring?.bounds.map((v) => v.toFixed(2)).join(' ')}`,
        }
      },
    )

    const turned = rectangle(5, 0, 10, 20)
    turned.points.push({ id: 'a1', x: 2, y: 0 }, { id: 'a2', x: 2, y: 20 })
    turned.entities.push({ id: 'centre', kind: 'line', p1: 'a1', p2: 'a2', construction: true })
    await check(
      'a revolve spins round a line drawn in the sketch',
      doc(
        [
          sketch('s1', XY, turned),
          {
            id: 'rv',
            name: 'Revolve',
            componentId: 'root',
            kind: 'revolve',
            sketchId: 's1',
            angle: 360,
            axis: 'x',
            axisLine: 'centre',
            result: { kind: 'newBody', bodyId: 'sleeve' },
          },
        ],
        ['sleeve'],
      ),
      (result) => {
        const sleeve = meshFor(result, 'sleeve')
        const expected = Math.PI * (13 * 13 - 3 * 3) * 20
        return {
          pass: near(sleeve?.volume, expected, 1),
          detail: `${sleeve?.volume.toFixed(1)} mm3 of ${expected.toFixed(1)}`,
        }
      },
    )

    await check(
      'a negative extrude from the top of a box cuts down into it',
      doc(
        [
          box('bx', 'cube', [0, 0], [20, 20, 10]),
          sketch(
            'top',
            { kind: 'face', face: { bodyId: 'cube', kind: 'face', name: 'bx:+z' }, offset: 0 },
            circle(10, 10, 3),
          ),
          {
            id: 'pocket',
            name: 'Extrude',
            componentId: 'root',
            kind: 'extrude',
            sketchId: 'top',
            distance: -4,
            symmetric: false,
            reverse: false,
            result: { kind: 'cut', bodyIds: ['cube'] },
          },
        ],
        ['cube'],
      ),
      (result) => {
        const cube = meshFor(result, 'cube')
        const expected = 4000 - Math.PI * 9 * 4
        return {
          pass: near(cube?.volume, expected, 0.5),
          detail: `${cube?.volume.toFixed(2)} mm3 of ${expected.toFixed(2)}`,
        }
      },
    )

    await check(
      'a box and a cylinder with negative heights build down and cut a pocket',
      doc(
        [
          box('bx', 'cube', [0, 0], [20, 20, 10]),
          {
            id: 'pocket',
            name: 'Box',
            componentId: 'root',
            kind: 'box',
            plane: {
              kind: 'face',
              face: { bodyId: 'cube', kind: 'face', name: 'bx:+z' },
              offset: 0,
            },
            origin: [2, 2],
            width: 5,
            depth: 5,
            height: -3,
            result: { kind: 'cut', bodyIds: ['cube'] },
          },
          {
            id: 'post',
            name: 'Cylinder',
            componentId: 'root',
            kind: 'cylinder',
            plane: XY,
            centre: [40, 0],
            radius: 3,
            height: -6,
            result: { kind: 'newBody', bodyId: 'peg' },
          },
        ],
        ['cube', 'peg'],
      ),
      (result) => {
        const cube = meshFor(result, 'cube')
        const peg = meshFor(result, 'peg')
        const pegVolume = Math.PI * 9 * 6
        return {
          pass:
            near(cube?.volume, 4000 - 75, 0.5) &&
            near(peg?.volume, pegVolume, 0.5) &&
            near(peg?.bounds[2], -6, 0.05) &&
            near(peg?.bounds[5], 0, 0.05),
          detail: `cube ${cube?.volume.toFixed(2)}, peg ${peg?.volume.toFixed(2)} of ${pegVolume.toFixed(2)} z ${peg?.bounds[2].toFixed(2)}..${peg?.bounds[5].toFixed(2)}`,
        }
      },
    )
  } catch (error) {
    add('solid test ran', false, `${(error as Error).message}`)
  } finally {
    worker.terminate()
  }
  return out
}
