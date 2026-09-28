import * as Comlink from 'comlink'
import { featureDependencies, featureReadsBodies } from '../doc/model'
import { resolveParameters } from '../doc/parameters'
import { emptyDocument, type Feature, type OkcDocument } from '../doc/types'
import { tangentChain } from '../sketch/chains'
import { sketchRegions } from '../sketch/regions'
import { emptySketch, type Sketch2D } from '../sketch/types'
import { createCommandState, evaluateCommand, reduceCommand } from '../ui/command/state'
import { extrudeCommand, revolveCommand } from '../ui/command/specs/sketchBased'
import type { CommandContext, SelectionPick } from '../ui/command/types'
import type { EvaluateResult, KernelApi } from '../kernel/types'
import type { TestResult } from './selftest'

function square(half: number): Sketch2D {
  const sketch = emptySketch()
  const corners = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
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
  return sketch
}

function circle(radius: number): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push({ id: 'pc', x: 0, y: 0 })
  sketch.entities.push({ id: 'c1', kind: 'circle', c: 'pc', r: radius, construction: false })
  return sketch
}

function ring(): Sketch2D {
  const sketch = emptySketch()
  const corners = [
    [5, 0],
    [10, 0],
    [10, 5],
    [5, 5],
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
  return sketch
}

function washer(): Sketch2D {
  const sketch = emptySketch()
  sketch.entities.push(
    { id: 'c10', kind: 'circle', c: 'origin', r: 10, construction: false },
    { id: 'c5', kind: 'circle', c: 'origin', r: 5, construction: false },
  )
  return sketch
}

function dShape(): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push({ id: 'a', x: 3, y: -12 }, { id: 'b', x: 3, y: 12 })
  sketch.entities.push(
    { id: 'c', kind: 'circle', c: 'origin', r: 10, construction: false },
    { id: 'l', kind: 'line', p1: 'a', p2: 'b', construction: false },
  )
  return sketch
}

function corner(): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 })
  sketch.entities.push(
    { id: 'l1', kind: 'line', p1: 'a', p2: 'b', construction: false },
    { id: 'l2', kind: 'line', p1: 'b', p2: 'c', construction: false },
  )
  return sketch
}

function slot(): Sketch2D {
  const sketch = emptySketch()
  sketch.points.push(
    { id: 'a', x: -5, y: -2 },
    { id: 'b', x: 5, y: -2 },
    { id: 'c', x: 5, y: 2 },
    { id: 'd', x: -5, y: 2 },
    { id: 'r', x: 5, y: 0 },
    { id: 'l', x: -5, y: 0 },
    { id: 'up', x: -5, y: 8 },
  )
  sketch.entities.push(
    { id: 'bottom', kind: 'line', p1: 'a', p2: 'b', construction: false },
    { id: 'right', kind: 'arc', c: 'r', p1: 'b', p2: 'c', ccw: true, construction: false },
    { id: 'top', kind: 'line', p1: 'c', p2: 'd', construction: false },
    { id: 'left', kind: 'arc', c: 'l', p1: 'd', p2: 'a', ccw: true, construction: false },
    { id: 'stub', kind: 'line', p1: 'd', p2: 'up', construction: false },
  )
  return sketch
}

function segment(r: number, d: number): number {
  return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d)
}

function sketchOn(id: string, sketch: Sketch2D, offset = 0): Feature {
  return {
    id,
    kind: 'sketch',
    name: id,
    componentId: 'root',
    plane: { kind: 'named', name: 'XY', offset },
    visible: false,
    sketch,
  }
}

function extrusion(patch: Record<string, unknown> = {}): Feature {
  return {
    id: 'ex',
    kind: 'extrude',
    name: 'Extrude',
    componentId: 'root',
    sketchId: 'sk',
    distance: 5,
    symmetric: false,
    reverse: false,
    result: { kind: 'newBody', bodyId: 'body' },
    ...patch,
  } as Feature
}

function plane(id: string, distance: number): Feature {
  return {
    id,
    kind: 'constructionPlane',
    name: id,
    componentId: 'root',
    method: 'offset',
    base: { kind: 'named', name: 'XY', offset: 0 },
    distance,
    axis: 'x',
    angle: 0,
    visible: true,
  }
}

const block: Feature = {
  id: 'blk',
  kind: 'box',
  name: 'Block',
  componentId: 'root',
  plane: { kind: 'named', name: 'XY', offset: 0 },
  origin: [-10, -10],
  width: 20,
  depth: 20,
  height: 20,
  result: { kind: 'newBody', bodyId: 'block' },
}

const cylinder: Feature = {
  id: 'cyl',
  kind: 'cylinder',
  name: 'Cylinder',
  componentId: 'root',
  plane: { kind: 'named', name: 'YZ', offset: -20 },
  centre: [0, 20],
  radius: 10,
  height: 40,
  result: { kind: 'newBody', bodyId: 'rod' },
}

function design(features: Feature[], bodies: string[]): OkcDocument {
  const doc = emptyDocument('Extents')
  doc.timeline = features
  doc.components[0].bodies = bodies.map((id) => ({ id, name: id, visible: true, colour: '#ccc' }))
  return doc
}

interface Measured {
  volume: number
  bounds: number[]
  faces: string[]
  edges: string[]
  errors: string[]
}

function measure(result: EvaluateResult, bodyId: string): Measured {
  const errors = result.errors.map((error) => error.message)
  const instance = result.instances.find((candidate) => candidate.bodyId === bodyId)
  const mesh = result.meshes.find((candidate) => candidate.key === instance?.meshKey)
  if (!mesh) return { volume: NaN, bounds: [], faces: [], edges: [], errors }
  const v = mesh.mesh.vertices
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k], v[i + k])
      bounds[k + 3] = Math.max(bounds[k + 3], v[i + k])
    }
  }
  return {
    volume: mesh.volume,
    bounds,
    faces: [...new Set(mesh.mesh.faceGroups.map((group) => group.name))].sort(),
    edges: [...new Set(mesh.edges.edgeGroups.map((group) => group.name))].sort(),
    errors,
  }
}

const near = (a: number, b: number, tolerance = 1e-3) => Math.abs(a - b) <= tolerance
const zRange = (m: Measured) => `${m.bounds[2]?.toFixed(3)}..${m.bounds[5]?.toFixed(3)}`

function context(doc: OkcDocument, editing?: Feature): CommandContext {
  const ids: Record<string, string> = {}
  return {
    doc,
    unit: 'mm',
    componentId: 'root',
    id: (role) => (ids[role] ??= `${role}-1`),
    editing,
    editingFeatureId: editing?.id,
  }
}

export async function runExtentTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name: `Extents: ${name}`, pass, detail })
  const check = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run()
    } catch (error) {
      add(name, false, `threw: ${(error as Error)?.stack ?? error}`)
    }
  }

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), { type: 'module' })
  const kernel = Comlink.wrap<KernelApi>(worker)
  const build = async (features: Feature[], bodies: string[], bodyId = 'body') =>
    measure(await kernel.evaluate(design(features, bodies), []), bodyId)

  try {
    await check('plain', async () => {
      const up = await build([sketchOn('sk', square(5)), extrusion()], ['body'])
      const down = await build([sketchOn('sk', square(5)), extrusion({ distance: -5 })], ['body'])
      add(
        'a plain extrude builds and names exactly as before',
        near(up.volume, 500) &&
          zRange(up) === '0.000..5.000' &&
          zRange(down) === '-5.000..0.000' &&
          up.faces.join() === 'ex:end,ex:side:e0,ex:side:e1,ex:side:e2,ex:side:e3,ex:start',
        `${zRange(up)} ${zRange(down)} ${up.faces.join()}`,
      )
    })

    await check('two sides and symmetric', async () => {
      const two = await build(
        [sketchOn('sk', square(5)), extrusion({ twoSided: true, secondDistance: 3 })],
        ['body'],
      )
      const half = await build(
        [sketchOn('sk', square(5)), extrusion({ symmetric: true, halfLength: true, distance: 4 })],
        ['body'],
      )
      add(
        'Two Sides and a half-length Symmetric reach the right distances each way',
        near(two.volume, 800) &&
          zRange(two) === '-3.000..5.000' &&
          near(half.volume, 800) &&
          zRange(half) === '-4.000..4.000',
        `${zRange(two)} ${zRange(half)}`,
      )
    })

    await check('start', async () => {
      const offset = await build(
        [sketchOn('sk', square(5)), extrusion({ start: 'offset', startOffset: 2 })],
        ['body'],
      )
      const object = await build(
        [
          plane('cp', 6),
          sketchOn('sk', square(5)),
          extrusion({
            start: 'object',
            startPlane: { kind: 'construction', featureId: 'cp', offset: 0 },
          }),
        ],
        ['body'],
      )
      const tilted = await build(
        [
          sketchOn('sk', square(5)),
          extrusion({
            start: 'object',
            startPlane: { kind: 'angled', name: 'XY', tiltAxis: 'x', angle: 20, offset: 6 },
          }),
        ],
        ['body'],
      )
      add(
        'an extrude starts at an offset or on a parallel plane, and refuses a tilted one',
        zRange(offset) === '2.000..7.000' &&
          zRange(object) === '6.000..11.000' &&
          tilted.errors.some((error) => error.includes('parallel to the sketch')),
        `${zRange(offset)} ${zRange(object)} ${tilted.errors.join()}`,
      )
    })

    await check('all', async () => {
      const cut = await build(
        [
          block,
          sketchOn('sk', circle(3), 25),
          extrusion({ reverse: true, extent: 'all', result: { kind: 'cut', bodyIds: ['block'] } }),
        ],
        ['block'],
        'block',
      )
      const nothing = await build(
        [sketchOn('sk', circle(3), 25), extrusion({ extent: 'all' })],
        ['body'],
      )
      add(
        'All cuts through everything in the way, and says so when nothing is there',
        near(cut.volume, 8000 - Math.PI * 9 * 20, 0.05) &&
          nothing.errors.some((error) => error.includes('nothing in front')),
        `${cut.volume.toFixed(2)} ${nothing.errors.join()}`,
      )
    })

    await check('to planes', async () => {
      const flat = await build(
        [
          plane('cp', 12),
          sketchOn('sk', circle(5)),
          extrusion({
            extent: 'to',
            to: { kind: 'plane', plane: { kind: 'construction', featureId: 'cp', offset: 0 } },
          }),
        ],
        ['body'],
      )
      const tilted = await build(
        [
          sketchOn('sk', circle(5)),
          extrusion({
            extent: 'to',
            to: {
              kind: 'plane',
              plane: { kind: 'angled', name: 'XY', tiltAxis: 'x', angle: 20, offset: 30 },
            },
          }),
        ],
        ['body'],
      )
      const behind = await build(
        [
          plane('cp', -12),
          sketchOn('sk', circle(5)),
          extrusion({
            extent: 'to',
            to: { kind: 'plane', plane: { kind: 'construction', featureId: 'cp', offset: 0 } },
          }),
        ],
        ['body'],
      )
      add(
        'To Object stops at a plane, a tilted plane, or one behind the sketch',
        near(flat.volume, Math.PI * 25 * 12, 0.05) &&
          near(tilted.volume, (Math.PI * 25 * 30) / Math.cos((20 * Math.PI) / 180), 0.5) &&
          zRange(behind) === '-12.000..0.000' &&
          flat.faces.includes('ex:side:c1') &&
          flat.faces.includes('ex:start'),
        `${flat.volume.toFixed(2)} ${tilted.volume.toFixed(2)} ${zRange(behind)} ${flat.faces.join()}`,
      )
    })

    await check('to curved faces and bodies', async () => {
      const expected = 2 * (40 - (Math.sqrt(99) + 100 * Math.asin(0.1)))
      const face = await build(
        [
          cylinder,
          sketchOn('sk', square(1)),
          extrusion({
            extent: 'to',
            to: { kind: 'face', face: { bodyId: 'rod', kind: 'face', name: 'cyl:side' } },
          }),
        ],
        ['rod', 'body'],
      )
      const body = await build(
        [
          cylinder,
          sketchOn('sk', square(1)),
          extrusion({ extent: 'to', to: { kind: 'body', bodyId: 'rod' } }),
        ],
        ['rod', 'body'],
      )
      const wide = await build(
        [
          cylinder,
          sketchOn('sk', square(15)),
          extrusion({
            extent: 'to',
            to: { kind: 'face', face: { bodyId: 'rod', kind: 'face', name: 'cyl:side' } },
          }),
        ],
        ['rod', 'body'],
      )
      const along = await build(
        [
          block,
          sketchOn('sk', circle(3), 25),
          extrusion({
            reverse: true,
            extent: 'to',
            to: { kind: 'face', face: { bodyId: 'block', kind: 'face', name: 'blk:-y' } },
          }),
        ],
        ['block', 'body'],
      )
      add(
        'To Object follows a curved face or a body, keeps clean names, and refuses what it cannot reach',
        near(face.volume, expected, 0.01) &&
          near(body.volume, expected, 0.01) &&
          face.faces.includes('ex:side:e0') &&
          face.faces.includes('ex:start') &&
          wide.errors.some((error) => error.includes('reaches past the edge')) &&
          along.errors.some((error) => error.includes('runs along the extrusion')),
        `${face.volume.toFixed(3)} ${body.volume.toFixed(3)} of ${expected.toFixed(3)}, ${face.faces.join()} | ${wide.errors.join()} | ${along.errors.join()}`,
      )
    })

    await check('taper', async () => {
      const top = (angle: number) => 10 + 2 * 10 * Math.tan((angle * Math.PI) / 180)
      const frustum = (a: number, b: number, h: number) => (h / 3) * (a * a + b * b + a * b)
      const out10 = await build(
        [sketchOn('sk', square(5)), extrusion({ distance: 10, draftAngle: 10 })],
        ['body'],
      )
      const in10 = await build(
        [sketchOn('sk', square(5)), extrusion({ distance: 10, draftAngle: -10 })],
        ['body'],
      )
      add(
        'a positive taper opens out and a negative one closes in, as in Fusion',
        near(out10.volume, frustum(10, top(10), 10), 0.05) &&
          near(in10.volume, frustum(10, top(-10), 10), 0.05) &&
          near(out10.bounds[3], top(10) / 2, 1e-3),
        `${out10.volume.toFixed(2)} ${in10.volume.toFixed(2)} top ${out10.bounds[3]?.toFixed(3)}`,
      )
    })

    await check('taper names', async () => {
      const fillet: Feature = {
        id: 'fil',
        kind: 'fillet',
        name: 'Fillet',
        componentId: 'root',
        bodyId: 'body',
        radius: 1,
        edges: [{ bodyId: 'body', kind: 'edge', name: 'ex:end:e0' }],
      }
      const plain = await build([sketchOn('sk', square(5)), extrusion({ distance: 10 })], ['body'])
      const tapered = await build(
        [sketchOn('sk', square(5)), extrusion({ distance: 10, draftAngle: 10 })],
        ['body'],
      )
      const rounded = await build(
        [sketchOn('sk', square(5)), extrusion({ distance: 10, draftAngle: 10 }), fillet],
        ['body'],
      )
      add(
        'a taper keeps every face and edge name, so later steps still find their edges',
        plain.faces.join() === tapered.faces.join() &&
          plain.edges.join() === tapered.edges.join() &&
          rounded.errors.length === 0 &&
          rounded.volume < tapered.volume,
        `${tapered.edges.join()} | ${rounded.errors.join()}`,
      )
    })

    await check('two tapered sides', async () => {
      const both = await build(
        [
          sketchOn('sk', square(5)),
          extrusion({
            distance: 10,
            draftAngle: 5,
            twoSided: true,
            secondDistance: 5,
            secondDraftAngle: -5,
          }),
        ],
        ['body'],
      )
      const t = Math.tan((5 * Math.PI) / 180)
      const frustum = (a: number, b: number, h: number) => (h / 3) * (a * a + b * b + a * b)
      const expected = frustum(10, 10 + 20 * t, 10) + frustum(10, 10 - 10 * t, 5)
      add(
        'each side takes its own distance and taper',
        near(both.volume, expected, 0.05) && zRange(both) === '-5.000..10.000',
        `${both.volume.toFixed(2)} of ${expected.toFixed(2)}`,
      )
    })

    await check('revolve directions', async () => {
      const turn = (patch: Record<string, unknown>) =>
        build(
          [
            sketchOn('sk', ring()),
            {
              id: 'rv',
              kind: 'revolve',
              name: 'Revolve',
              componentId: 'root',
              sketchId: 'sk',
              angle: 90,
              axis: 'y',
              result: { kind: 'newBody', bodyId: 'body' },
              ...patch,
            } as Feature,
          ],
          ['body'],
        )
      const quarter = (Math.PI * 75 * 5) / 4
      const one = await turn({})
      const two = await turn({ twoSided: true, secondAngle: 45 })
      const symmetric = await turn({ symmetric: true })
      const flipped = await turn({ reverse: true })
      add(
        'Revolve goes one way, both ways, symmetrically or flipped',
        near(one.volume, quarter, 0.05) &&
          near(two.volume, quarter * 1.5, 0.05) &&
          near(symmetric.volume, quarter, 0.05) &&
          near(symmetric.bounds[2], -symmetric.bounds[5], 1e-3) &&
          near(flipped.bounds[2], 0, 1e-3) &&
          near(one.bounds[5], 0, 1e-3) &&
          one.faces.includes('rv:start'),
        `${one.volume.toFixed(2)} ${two.volume.toFixed(2)} ${symmetric.volume.toFixed(2)} ${zRange(symmetric)} ${zRange(flipped)}`,
      )
    })

    await check('surfaces', async () => {
      const sheet = await build(
        [
          sketchOn('sk', square(5)),
          extrusion({ surface: true, twoSided: true, secondDistance: 3 }),
        ],
        ['body'],
      )
      add('a surface extrude also goes two ways', zRange(sheet) === '-3.000..5.000', zRange(sheet))
    })

    await check('thin walls', async () => {
      const wall = (sketch: Sketch2D, patch: Record<string, unknown> = {}) =>
        build([sketchOn('sk', sketch), extrusion({ thinThickness: 1, ...patch })], ['body'])
      const outward = await wall(square(5))
      const inward = await wall(square(5), { thinSide: 'two' })
      const centred = await wall(square(5), { thinSide: 'center' })
      const ringed = await wall(washer())
      add(
        'Thin Extrude walls a profile outward, inward or on its line, and walls a hole too',
        near(outward.volume, 220) &&
          near(outward.bounds[3], 6) &&
          near(inward.volume, 180) &&
          near(inward.bounds[3], 5) &&
          near(centred.volume, 200) &&
          near(centred.bounds[3], 5.5) &&
          near(ringed.volume, 160 * Math.PI, 0.05) &&
          outward.faces.includes('ex:side:e0') &&
          outward.faces.includes('ex:side:e0~wall0') &&
          centred.faces.includes('ex:side:e0~wall1') &&
          !centred.faces.includes('ex:side:e0'),
        `${outward.volume.toFixed(2)} ${inward.volume.toFixed(2)} ${centred.volume.toFixed(2)} ${ringed.volume.toFixed(2)} ${outward.faces.join()}`,
      )
    })

    await check('thin crossings and curves', async () => {
      const regions = sketchRegions(dShape()).regions
      const big = regions.reduce((a, b) => (a.area > b.area ? a : b))
      const crossed = await build(
        [sketchOn('sk', dShape()), extrusion({ thinThickness: 1, profiles: [big.key] })],
        ['body'],
      )
      const expected = 5 * (121 * Math.PI - segment(11, 4) - (100 * Math.PI - segment(10, 3)))
      const open = await build(
        [
          sketchOn('sk', corner()),
          extrusion({ thinThickness: 1, curves: ['l1', 'l2'], profiles: [] }),
        ],
        ['body'],
      )
      const both = await build(
        [
          sketchOn('sk', corner()),
          extrusion({ thinThickness: 1, thinSide: 'center', curves: ['l1', 'l2'], profiles: [] }),
        ],
        ['body'],
      )
      add(
        'a thin wall follows a profile cut from crossing curves, and open curves with capped ends',
        near(crossed.volume, expected, 0.05) &&
          crossed.faces.includes('ex:side:c[l|l@2]~wall0') &&
          near(open.volume, 95) &&
          open.faces.includes('ex:side:a~cap') &&
          near(both.volume, 100) &&
          near(both.bounds[1], -0.5),
        `${crossed.volume.toFixed(3)} of ${expected.toFixed(3)} ${crossed.faces.join()} | ${open.volume.toFixed(2)} ${both.volume.toFixed(2)} ${open.faces.join()}`,
      )
    })

    await check('thin names', async () => {
      const busy = square(5)
      busy.points.push({ id: 'z1', x: 20, y: 20 }, { id: 'z2', x: 30, y: 20 })
      busy.entities.unshift({ id: 'zz', kind: 'line', p1: 'z1', p2: 'z2', construction: false })
      const rounded = await build(
        [
          sketchOn('sk', busy),
          extrusion({ thinThickness: 1 }),
          {
            id: 'fil',
            kind: 'fillet',
            name: 'Fillet',
            componentId: 'root',
            bodyId: 'body',
            radius: 0.5,
            edges: [{ bodyId: 'body', kind: 'edge', name: 'ex:side:q1~wall0' }],
          },
        ],
        ['body'],
      )
      add(
        'a wall is named after the curves it follows, so an edit to the sketch keeps a fillet on it',
        rounded.errors.length === 0 && near(rounded.volume, 220 - 1.25 * (1 - Math.PI / 4), 1e-3),
        `${rounded.volume.toFixed(4)} ${rounded.errors.join()}`,
      )
    })
  } finally {
    worker.terminate()
  }

  await check('dependencies', () => {
    const doc = design(
      [
        block,
        plane('cp', 12),
        sketchOn('sk', circle(5)),
        extrusion({
          extent: 'to',
          to: { kind: 'face', face: { bodyId: 'block', kind: 'face', name: 'blk:+z' } },
          start: 'object',
          startPlane: { kind: 'construction', featureId: 'cp', offset: 0 },
        }),
      ],
      ['block', 'body'],
    )
    const extrude = doc.timeline[3]
    add(
      'an extrude depends on the face and the plane it uses',
      featureReadsBodies(extrude).includes('block') &&
        featureDependencies(doc, extrude).includes('cp') &&
        featureDependencies(doc, extrude).includes('blk'),
      featureDependencies(doc, extrude).join(),
    )
  })

  await check('parameters', () => {
    const doc = design(
      [
        sketchOn('sk', square(5)),
        extrusion({
          twoSided: true,
          secondDistance: 3,
          startOffset: 0,
          start: 'offset',
          thinThickness: 1,
        }),
      ],
      ['body'],
    )
    doc.parameters = [{ id: 'p', name: 'side', value: 7, expression: '7' }]
    doc.bindings = [
      { featureId: 'ex', field: 'secondDistance', expression: 'side' },
      { featureId: 'ex', field: 'startOffset', expression: '-side' },
      { featureId: 'ex', field: 'thinThickness', expression: 'side / 2' },
    ]
    resolveParameters(doc)
    const extrude = doc.timeline[1] as {
      secondDistance: number
      startOffset: number
      thinThickness: number
    }
    add(
      'the second distance, the start offset and the wall thickness can follow parameters',
      extrude.secondDistance === 7 && extrude.startOffset === -7 && extrude.thinThickness === 3.5,
      `${extrude.secondDistance} ${extrude.startOffset} ${extrude.thinThickness}`,
    )
  })

  await check('panel', () => {
    const doc = design([block, sketchOn('sk', circle(5), 25)], ['block'])
    const profile: SelectionPick[] = [{ kind: 'sketch', id: 'sk', label: 'Sketch' }]
    const face: SelectionPick[] = [
      {
        kind: 'face',
        id: 'block|blk:+z',
        label: 'Face',
        bodyId: 'block',
        face: { bodyId: 'block', kind: 'face', name: 'blk:+z' },
      },
    ]
    const ctx = context(doc)
    const state = createCommandState(extrudeCommand, ctx, {
      profile,
      direction: 'two',
      extent: 'to',
      object: face,
      flip: true,
      taper: 3,
      extentTwo: 'all',
      taperTwo: -2,
      start: 'offset',
      startOffset: 1,
    })
    const evaluation = evaluateCommand(extrudeCommand, state, ctx, { build: true })
    const built = evaluation.features?.[0] as Record<string, unknown> | undefined
    const plain = evaluateCommand(
      extrudeCommand,
      createCommandState(extrudeCommand, ctx, { profile }),
      ctx,
      { build: true },
    ).features?.[0] as Record<string, unknown> | undefined
    const revolve = evaluateCommand(
      revolveCommand,
      createCommandState(revolveCommand, ctx, { profile, direction: 'two', angleTwo: 30 }),
      ctx,
      { build: true },
    ).features?.[0] as Record<string, unknown> | undefined
    add(
      'the panel writes every new option, and nothing extra for a plain extrude',
      built?.extent === 'to' &&
        (built?.to as { kind: string })?.kind === 'face' &&
        built?.twoSided === true &&
        built?.secondExtent === 'all' &&
        built?.draftAngle === 3 &&
        built?.secondDraftAngle === -2 &&
        built?.start === 'offset' &&
        built?.startOffset === 1 &&
        built?.reverse === true &&
        !!plain &&
        ['extent', 'to', 'twoSided', 'draftAngle', 'start', 'startOffset'].every(
          (key) => !(key in plain),
        ) &&
        revolve?.twoSided === true &&
        revolve?.secondAngle === 30,
      JSON.stringify({ built, plainKeys: plain && Object.keys(plain), revolve }),
    )
  })

  await check('thin panel', () => {
    const doc = design([sketchOn('sk', corner())], [])
    const ctx = context(doc)
    const curve = (id: string): SelectionPick => ({
      kind: 'sketchCurve',
      id: `sk|${id}`,
      label: 'Line',
      curve: { sketchId: 'sk', entityId: id },
    })
    const picksIn = (state: ReturnType<typeof createCommandState>) => {
      const field = state.fields.profile
      return field?.kind === 'selection' ? field.picks.map((pick) => pick.id) : []
    }
    const closed = createCommandState(extrudeCommand, ctx, { taper: 4 })
    const refused = reduceCommand(
      extrudeCommand,
      closed,
      { type: 'pick', pick: curve('l1'), id: 'profile' },
      ctx,
    )
    const opened = reduceCommand(
      extrudeCommand,
      closed,
      { type: 'toggle', id: 'thin', value: true },
      ctx,
    )
    const picked = reduceCommand(
      extrudeCommand,
      opened,
      { type: 'pick', pick: curve('l1'), id: 'profile' },
      ctx,
    )
    const built = evaluateCommand(extrudeCommand, picked, ctx, { build: true }).features?.[0] as
      Record<string, unknown> | undefined
    const dropped = reduceCommand(
      extrudeCommand,
      picked,
      { type: 'toggle', id: 'thin', value: false },
      ctx,
    )
    const reopened = createCommandState(extrudeCommand, ctx, {
      thin: true,
      profile: [curve('l1'), curve('l2')],
    })
    const stale = createCommandState(extrudeCommand, ctx, { profile: [curve('l1')] })
    add(
      'the panel takes open curves only for a thin extrude, and writes the wall without a taper',
      picksIn(refused).length === 0 &&
        picksIn(picked).join() === 'sk|l1' &&
        built?.thinThickness === 2 &&
        (built?.curves as string[])?.join() === 'l1' &&
        (built?.profiles as string[])?.length === 0 &&
        !('draftAngle' in (built ?? {})) &&
        !('thinSide' in (built ?? {})) &&
        picksIn(dropped).length === 0 &&
        picksIn(reopened).join() === 'sk|l1,sk|l2' &&
        picksIn(stale).length === 0,
      JSON.stringify({
        refused: picksIn(refused),
        picked: picksIn(picked),
        built,
        dropped: picksIn(dropped),
        reopened: picksIn(reopened),
      }),
    )
  })

  await check('tangent chain', () => {
    const run = tangentChain(slot(), 'bottom').sort().join()
    const alone = tangentChain(corner(), 'l1').join()
    add(
      'Tangent Chain picks the curves that run smoothly on, and stops at a corner',
      run === 'bottom,left,right,top' && alone === 'l1',
      `${run} | ${alone}`,
    )
  })

  return out
}
