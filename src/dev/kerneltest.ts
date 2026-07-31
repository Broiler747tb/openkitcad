/**
 * End-to-end kernel test.
 *
 * Builds the exact vertical slice the app is for - sketch a plate, extrude it,
 * drop a Raspberry Pi on it, generate its mounting holes - and checks the
 * resulting solid against numbers worked out by hand. Runs against the real
 * OpenCascade worker, so it catches anything the pure-maths tests cannot.
 */
import * as Comlink from 'comlink'
import type { KernelApi } from '../kernel/worker'
import type { Body, OkcDocument, Placement } from '../doc/types'
import { applySolve, solveSketch } from '../sketch/solver'
import { emptySketch, type Sketch2D } from '../sketch/types'
import type { TestResult } from './selftest'

const PLATE_W = 100
const PLATE_D = 70
const PLATE_T = 3

/** A fully constrained rectangle, solved, ready to extrude. */
function platePlan(): Sketch2D {
  const s = emptySketch()
  const pt = (id: string, x: number, y: number) => {
    s.points.push({ id, x, y })
    return id
  }
  const a = pt('a', 0, 0)
  const b = pt('b', 90, 5)
  const c = pt('c', 95, 65)
  const d = pt('d', 5, 72)
  s.entities.push(
    { id: 'l1', kind: 'line', p1: a, p2: b, construction: false },
    { id: 'l2', kind: 'line', p1: b, p2: c, construction: false },
    { id: 'l3', kind: 'line', p1: c, p2: d, construction: false },
    { id: 'l4', kind: 'line', p1: d, p2: a, construction: false },
  )
  s.constraints.push(
    { id: 'k1', kind: 'coincident', a, b: 'origin' },
    { id: 'k2', kind: 'horizontal', e: 'l1' },
    { id: 'k3', kind: 'horizontal', e: 'l3' },
    { id: 'k4', kind: 'vertical', e: 'l2' },
    { id: 'k5', kind: 'vertical', e: 'l4' },
    { id: 'k6', kind: 'distanceX', a, b, value: PLATE_W },
    { id: 'k7', kind: 'distanceY', a, b: d, value: PLATE_D },
  )
  applySolve(s, solveSketch(s))
  return s
}

function makeDoc(piPosition: [number, number, number], withStandoffs: boolean): OkcDocument {
  const placement: Placement = {
    id: 'pi',
    partId: 'raspberry-pi-4b',
    name: 'Raspberry Pi 4 Model B',
    position: piPosition,
    rotation: 0,
    flipped: false,
    visible: true,
  }

  const body: Body = {
    id: 'plate',
    name: 'Base plate',
    visible: true,
    colour: '#c8cdd3',
    features: [
      { id: 'f-sketch', name: 'Plate outline', kind: 'sketch', plane: { kind: 'named', name: 'XY', offset: 0 }, sketch: platePlan() },
      {
        id: 'f-extrude',
        name: 'Extrude plate',
        kind: 'extrude',
        sketchId: 'f-sketch',
        distance: PLATE_T,
        symmetric: false,
        reverse: false,
        operation: 'new',
      },
      {
        id: 'f-holes',
        name: 'Pi mounting holes',
        kind: 'hole',
        plane: { kind: 'named', name: 'XY', offset: PLATE_T },
        source: { kind: 'placement', placementId: 'pi' },
        style: 'simple',
        diameter: 2.8,
        depth: 'through',
      },
    ],
  }

  if (withStandoffs) {
    body.features.push({
      id: 'f-standoffs',
      name: 'Standoffs',
      kind: 'standoff',
      plane: { kind: 'named', name: 'XY', offset: PLATE_T },
      source: { kind: 'placement', placementId: 'pi' },
      height: 6,
      outerDiameter: 6,
      boreDiameter: 2.1,
      boreDepth: 5,
    })
  }

  return {
    version: 1,
    name: 'Kernel test',
    units: 'mm',
    parameters: [],
    bodies: [body],
    placements: [placement],
  }
}

export async function runKernelTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) =>
    out.push({ name, pass, detail })

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), {
    type: 'module',
  })
  const kernel = Comlink.wrap<KernelApi>(worker)
  // Exposed so the kernel can be poked at from the browser console.
  ;(window as any).__okc_kernel = kernel

  try {
    const t0 = performance.now()
    await kernel.ready()
    add('kernel boots', true, `OpenCascade ready in ${Math.round(performance.now() - t0)} ms`)

    // --- the full slice -----------------------------------------------------
    const onPlate = await kernel.evaluate(makeDoc([8, 7, PLATE_T], true))
    add(
      'vertical slice builds without errors',
      onPlate.errors.length === 0,
      onPlate.errors.length
        ? onPlate.errors.map((e) => e.message).join('; ')
        : `built in ${onPlate.elapsedMs} ms`,
    )
    add(
      'produces both the plate and the board',
      onPlate.shapes.length === 2,
      `${onPlate.shapes.length} shape(s): ${onPlate.shapes.map((s) => s.name).join(', ')}`,
    )

    const plate = onPlate.shapes.find((s) => s.id === 'plate')
    if (plate) {
      const [x0, y0, z0, x1, y1, z1] = plate.bounds
      // OpenCascade's bounding box deliberately includes a small gap, so this
      // is checked to a couple of hundredths rather than exactly.
      const BBOX_GAP = 0.02
      const okXY =
        Math.abs(x0) < BBOX_GAP &&
        Math.abs(y0) < BBOX_GAP &&
        Math.abs(x1 - PLATE_W) < BBOX_GAP &&
        Math.abs(y1 - PLATE_D) < BBOX_GAP
      add(
        'sketch solved to the exact plate size',
        okXY,
        `bounds x ${x0.toFixed(3)}..${x1.toFixed(3)}, y ${y0.toFixed(3)}..${y1.toFixed(3)} (expected 0..${PLATE_W}, 0..${PLATE_D})`,
      )
      // 3 mm plate plus 6 mm standoffs standing on top of it.
      add(
        'standoffs stand on top of the plate',
        Math.abs(z0) < 0.02 && Math.abs(z1 - (PLATE_T + 6)) < 0.02,
        `height ${z0.toFixed(2)}..${z1.toFixed(2)} (expected 0..${PLATE_T + 6})`,
      )
      add('plate has real volume', plate.volume > 0, `${plate.volume.toFixed(1)} mm3`)
      add(
        'plate is tessellated for display',
        plate.mesh.triangles.length > 0 && plate.edges.lines.length > 0,
        `${plate.mesh.triangles.length / 3} triangles, ${plate.edges.lines.length / 6} edge segments`,
      )
    } else {
      add('plate was built', false, 'no shape with id "plate" came back')
    }

    // --- the parametric link ------------------------------------------------
    // Holes are derived from the placement, so sliding the board off the plate
    // must leave the plate solid. This is the whole promise of the app.
    const holesOnly = await kernel.evaluate(makeDoc([8, 7, PLATE_T], false))
    const holesAway = await kernel.evaluate(makeDoc([400, 400, PLATE_T], false))
    const drilled = holesOnly.shapes.find((s) => s.id === 'plate')?.volume ?? 0
    const solid = holesAway.shapes.find((s) => s.id === 'plate')?.volume ?? 0
    const nominal = PLATE_W * PLATE_D * PLATE_T

    add(
      'an undrilled plate is exactly its nominal volume',
      Math.abs(solid - nominal) < 0.5,
      `${solid.toFixed(1)} mm3 (expected ${nominal})`,
    )
    // Four 2.8 mm holes through 3 mm of plate.
    const expectedRemoved = 4 * Math.PI * 1.4 * 1.4 * PLATE_T
    const removed = solid - drilled
    add(
      'holes are generated from the placed board',
      Math.abs(removed - expectedRemoved) < 0.5,
      `removed ${removed.toFixed(2)} mm3, expected ${expectedRemoved.toFixed(2)} mm3 for four 2.8 mm holes`,
    )

    // --- export path --------------------------------------------------------
    try {
      const step = await kernel.exportStep(['plate'], 'plate')
      const head = new TextDecoder().decode(new Uint8Array(step.slice(0, 13)))
      add(
        'STEP export produces a real STEP file',
        head.startsWith('ISO-10303-21'),
        `${(step.byteLength / 1024).toFixed(1)} kB, header "${head}"`,
      )
    } catch (e) {
      add('STEP export produces a real STEP file', false, (e as Error).message)
    }

    try {
      // Rebuild with the board back on the plate: the previous evaluation
      // deliberately moved it away, so the plate has no holes to project.
      await kernel.evaluate(makeDoc([8, 7, PLATE_T], false))
      const proj = await kernel.project('plate', 'XY')
      add(
        'projection finds the four holes as true circles',
        proj.circles.length === 4 && proj.circles.every((c) => Math.abs(c.r - 1.4) < 0.01),
        `${proj.circles.length} circle(s), ${proj.polylines.length} polyline(s); radii ${proj.circles
          .map((c) => c.r.toFixed(3))
          .join(', ')} (expected four at 1.400)`,
      )
      // SVG measures Y downward. If this comes back negative, every DXF panel
      // the app exports would be a mirror image of the real part.
      add(
        'projection is not mirrored',
        Math.abs(proj.bounds[1]) < 0.01 && Math.abs(proj.bounds[3] - PLATE_D) < 0.01,
        `y spans ${proj.bounds[1].toFixed(2)}..${proj.bounds[3].toFixed(2)} (expected 0..${PLATE_D})`,
      )
      // Hole centres must land exactly under the board's mounting holes.
      const expected = [
        [11.5, 10.5],
        [69.5, 10.5],
        [11.5, 59.5],
        [69.5, 59.5],
      ]
      const matched = expected.filter((e) =>
        proj.circles.some((c) => Math.hypot(c.cx - e[0], c.cy - e[1]) < 0.02),
      )
      add(
        'hole centres land exactly under the board',
        matched.length === 4,
        `${matched.length}/4 matched; got ${proj.circles
          .map((c) => `(${c.cx.toFixed(2)}, ${c.cy.toFixed(2)})`)
          .join(' ')}`,
      )
    } catch (e) {
      add('projection finds the four holes as true circles', false, (e as Error).message)
    }
  } catch (e) {
    add('kernel test ran', false, `${(e as Error).message}\n${(e as Error).stack ?? ''}`)
  }

  return out
}
