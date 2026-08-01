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

    // --- combining bodies ---------------------------------------------------
    {
      const V = 40 * 40 * 20
      const OVERLAP = 20 * 40 * 20
      const combineDoc = (op: 'add' | 'cut' | 'intersect' | null): OkcDocument => ({
        version: 1,
        name: 'combine',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'tool',
            name: 'Tool',
            visible: true,
            colour: '#888',
            features: [
              {
                id: 't',
                name: 'Tool',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [20, 0],
                width: 40,
                depth: 40,
                height: 20,
                operation: 'new',
              },
            ],
          },
          {
            id: 'main',
            name: 'Main',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'm',
                name: 'Main',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [0, 0],
                width: 40,
                depth: 40,
                height: 20,
                operation: 'new',
              },
              ...(op
                ? [
                    {
                      id: 'c',
                      name: 'Combine',
                      kind: 'combine' as const,
                      otherBodyId: 'tool',
                      operation: op,
                      keepOther: false,
                    },
                  ]
                : []),
            ],
          },
        ],
      })

      for (const [op, expected] of [
        ['add', 2 * V - OVERLAP],
        ['cut', V - OVERLAP],
        ['intersect', OVERLAP],
      ] as const) {
        const r = await kernel.evaluate(combineDoc(op))
        const main = r.shapes.find((s) => s.id === 'main')
        add(
          `combining two bodies with "${op}"`,
          !!main && Math.abs(main.volume - expected) < 1 && r.errors.length === 0,
          `${main?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${expected}` +
            (r.errors.length ? ` (${r.errors[0].message})` : ''),
        )
        // The tool body is merged in, so it stops being a thing of its own.
        add(
          `the body merged in by "${op}" is no longer drawn separately`,
          r.shapes.length === 1,
          `${r.shapes.length} shape(s) left`,
        )
      }
    }

    // --- a sketch plane tipped over -----------------------------------------
    {
      const r = await kernel.evaluate({
        version: 1,
        name: 'tilt',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'b',
            name: 'Tilted',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'bx',
                name: 'Slab',
                kind: 'box',
                plane: {
                  kind: 'angled',
                  name: 'XY',
                  tiltAxis: 'x',
                  angle: 30,
                  offset: 0,
                },
                origin: [0, 0],
                width: 40,
                depth: 20,
                height: 5,
                operation: 'new',
              },
            ],
          },
        ],
      })
      const slab = r.shapes[0]
      add(
        'a solid built on a tilted plane has the right volume',
        !!slab && Math.abs(slab.volume - 40 * 20 * 5) < 1,
        `${slab?.volume.toFixed(0) ?? 'nothing'} mm3, expected 4000`,
      )
      // Tipped 30 degrees, the 20 mm depth projects to 20*cos30 and the 5 mm
      // thickness adds 5*sin30 on top of it. Forgetting the second term is an
      // easy way to write a test that fails against correct geometry.
      const expectedSpan = 20 * Math.cos(Math.PI / 6) + 5 * Math.sin(Math.PI / 6)
      add(
        'and is genuinely tilted, not flat',
        !!slab && Math.abs(slab.bounds[4] - slab.bounds[1] - expectedSpan) < 0.1,
        `spans ${(slab ? slab.bounds[4] - slab.bounds[1] : 0).toFixed(2)} mm front to back, expected ${expectedSpan.toFixed(2)}`,
      )
    }

    // --- moving and turning a body ------------------------------------------
    {
      const box = (extra: unknown[]): OkcDocument => ({
        version: 1,
        name: 'move',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'b',
            name: 'Slab',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'bx',
                name: 'Slab',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [0, 0],
                width: 40,
                depth: 20,
                height: 10,
                operation: 'new',
              },
              ...extra,
            ] as Body['features'],
          },
        ],
      })

      // A move step that has not been dragged yet must leave the part exactly
      // where it was. The gizmo creates one the moment you ask to move
      // something, so if this were not true, asking would move it.
      const still = (
        await kernel.evaluate(
          box([
            { id: 'mv', name: 'Move', kind: 'move', offset: [0, 0, 0], rotation: [0, 0, 0] },
          ]),
        )
      ).shapes[0]
      add(
        'a move step with nothing set leaves the part alone',
        !!still && still.bounds.every((v, i) => Math.abs(v - [0, 0, 0, 40, 20, 10][i]) < 1e-6),
        `bounds ${still?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )

      const shifted = (
        await kernel.evaluate(
          box([
            { id: 'mv', name: 'Move', kind: 'move', offset: [100, 5, -3], rotation: [0, 0, 0] },
          ]),
        )
      ).shapes[0]
      add(
        'moving a body shifts it by exactly that much',
        !!shifted &&
          shifted.bounds.every((v, i) => Math.abs(v - [100, 5, -3, 140, 25, 7][i]) < 1e-6),
        `bounds ${shifted?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )

      // Turned about its own centre, not the world origin. A 40 x 20 footprint
      // centred at (20, 10) becomes 20 x 40 about the same point; if this
      // rotated about the origin instead, the part would swing off to one side.
      const turned = (
        await kernel.evaluate(
          box([
            { id: 'mv', name: 'Move', kind: 'move', offset: [0, 0, 0], rotation: [0, 0, 90] },
          ]),
        )
      ).shapes[0]
      add(
        'turning a body pivots about its own centre',
        !!turned &&
          turned.bounds.every((v, i) => Math.abs(v - [10, -10, 0, 30, 30, 10][i]) < 1e-6),
        `bounds ${turned?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )

      // Volume is the real check that a rotation is a rotation: scaling or
      // shearing would still move the bounding box about convincingly.
      add(
        'and does not distort it',
        !!turned && Math.abs(turned.volume - 40 * 20 * 10) < 1e-3,
        `${turned?.volume.toFixed(2)} mm3, expected 8000`,
      )

      // Off-axis, where an error in the pivot shows up plainly: at 45 degrees a
      // 40 x 20 rectangle spans (40 + 20) * cos45 = 42.43 mm each way.
      const diagonal = (
        await kernel.evaluate(
          box([
            { id: 'mv', name: 'Move', kind: 'move', offset: [0, 0, 0], rotation: [0, 0, 45] },
          ]),
        )
      ).shapes[0]
      const span = 60 * Math.cos(Math.PI / 4)
      add(
        'a 45 degree turn spans the diagonal, still centred',
        !!diagonal &&
          Math.abs(diagonal.bounds[3] - diagonal.bounds[0] - span) < 1e-3 &&
          Math.abs((diagonal.bounds[0] + diagonal.bounds[3]) / 2 - 20) < 1e-6,
        `spans ${(diagonal ? diagonal.bounds[3] - diagonal.bounds[0] : 0).toFixed(3)} mm, expected ${span.toFixed(3)}`,
      )
    }

    // --- ready-made shapes, positive and negative ---------------------------
    {
      const sphereV = (4 / 3) * Math.PI * 15 ** 3
      const shapes = await kernel.evaluate({
        version: 1,
        name: 'shapes',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'ball',
            name: 'Ball',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 's',
                name: 'Ball',
                kind: 'sphere',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                centre: [0, 0],
                radius: 15,
                half: false,
                operation: 'new',
              },
            ],
          },
          {
            // Deliberately away from the origin: a dome built with a cutter
            // centred on the plane instead of on the ball comes out a whole
            // sphere, and only shows it once it is moved off centre.
            id: 'dome',
            name: 'Dome',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'd',
                name: 'Dome',
                kind: 'sphere',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                centre: [60, 0],
                radius: 15,
                half: true,
                operation: 'new',
              },
            ],
          },
        ],
      })
      const ball = shapes.shapes.find((x) => x.id === 'ball')
      const dome = shapes.shapes.find((x) => x.id === 'dome')
      add(
        'a ball has the volume of a sphere',
        !!ball && Math.abs(ball.volume - sphereV) < 20,
        `${ball?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${sphereV.toFixed(0)}`,
      )
      add(
        'a dome is half of one, sitting flat on its plane',
        !!dome && Math.abs(dome.volume - sphereV / 2) < 20 && Math.abs(dome.bounds[2]) < 0.05,
        `${dome?.volume.toFixed(0) ?? 'nothing'} mm3 (expected ${(sphereV / 2).toFixed(0)}), base at z ${dome?.bounds[2].toFixed(2)}`,
      )

      const carved = await kernel.evaluate({
        version: 1,
        name: 'carve',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'b',
            name: 'B',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'bx',
                name: 'Box',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [-20, -20],
                width: 40,
                depth: 40,
                height: 40,
                operation: 'new',
              },
              {
                id: 'sp',
                name: 'Scoop',
                kind: 'sphere',
                plane: { kind: 'named', name: 'XY', offset: 20 },
                centre: [0, 0],
                radius: 10,
                half: false,
                operation: 'cut',
              },
            ],
          },
        ],
      })
      const expected = 40 ** 3 - (4 / 3) * Math.PI * 10 ** 3
      add(
        'a shape used as a negative scoops material out',
        Math.abs((carved.shapes[0]?.volume ?? 0) - expected) < 10,
        `${carved.shapes[0]?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${expected.toFixed(0)}`,
      )
    }

    // --- vent grid and its border -------------------------------------------
    {
      const PANEL = 60
      const T = 3
      const SIZE = 6
      const MARGIN = 4
      const vented = await kernel.evaluate({
        version: 1,
        name: 'vent',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'p',
            name: 'Panel',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'pl',
                name: 'Panel',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [-PANEL / 2, -PANEL / 2],
                width: PANEL,
                depth: PANEL,
                height: T,
                operation: 'new',
              },
              {
                id: 'v',
                name: 'Vent',
                kind: 'vent',
                plane: { kind: 'named', name: 'XY', offset: T },
                shape: 'hex',
                size: SIZE,
                spacing: 2,
                margin: MARGIN,
                depth: 'through',
              },
            ],
          },
        ],
      })
      const panel = vented.shapes[0]
      const solidV = PANEL * PANEL * T
      const hexArea = (Math.sqrt(3) / 2) * SIZE * SIZE
      const holes = (solidV - (panel?.volume ?? solidV)) / (hexArea * T)
      add(
        'a hex vent grid cuts a whole number of hexagons',
        vented.errors.length === 0 && holes > 10 && Math.abs(holes - Math.round(holes)) < 0.02,
        `${holes.toFixed(2)} hexagons' worth removed` +
          (vented.errors.length ? ` (${vented.errors[0].message})` : ''),
      )
      // Partial holes at the edge would eat into the outline; a kept border
      // means the panel is still exactly its original size.
      add(
        'and leaves the edge border intact',
        !!panel &&
          Math.abs(panel.bounds[3] - panel.bounds[0] - PANEL) < 0.01 &&
          Math.abs(panel.bounds[4] - panel.bounds[1] - PANEL) < 0.01,
        `panel still ${(panel ? panel.bounds[3] - panel.bounds[0] : 0).toFixed(2)} mm across`,
      )
    }

    // --- hollow, and turn the open side into a lid --------------------------
    {
      const W = 50
      const D = 40
      const H = 30
      const WALL = 2
      const withLid = await kernel.evaluate({
        version: 1,
        name: 'lid',
        units: 'mm',
        parameters: [],
        placements: [],
        bodies: [
          {
            id: 'box',
            name: 'Box',
            visible: true,
            colour: '#ccc',
            features: [
              {
                id: 'bx',
                name: 'Box',
                kind: 'box',
                plane: { kind: 'named', name: 'XY', offset: 0 },
                origin: [0, 0],
                width: W,
                depth: D,
                height: H,
                operation: 'new',
              },
              {
                id: 'sh',
                name: 'Hollow',
                kind: 'shell',
                thickness: WALL,
                openFaces: [{ bodyId: 'box', anchor: [W / 2, D / 2, H], normal: [0, 0, 1] }],
              },
            ],
          },
          {
            id: 'lid',
            name: 'Lid',
            visible: true,
            colour: '#bbb',
            features: [
              {
                id: 'ld',
                name: 'Lid',
                kind: 'lid',
                sourceBodyId: 'box',
                shellFeatureId: 'sh',
                thickness: WALL,
              },
            ],
          },
        ],
      })
      const lid = withLid.shapes.find((x) => x.id === 'lid')
      // The lid fills the opening rather than capping it from outside, so it is
      // the size of the hole - the outer profile less a wall on each side.
      const lidVolume = (W - 2 * WALL) * (D - 2 * WALL) * WALL
      add(
        'the lid is the size of the opening it fills',
        !!lid && Math.abs(lid.volume - lidVolume) < 1,
        `${lid?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${lidVolume} for a ${W - 2 * WALL}x${D - 2 * WALL}x${WALL} plug`,
      )
      add(
        'and sits down in it, flush with the outside',
        !!lid && Math.abs(lid.bounds[2] - (H - WALL)) < 0.05 && Math.abs(lid.bounds[5] - H) < 0.05,
        `z ${lid?.bounds[2].toFixed(1)}..${lid?.bounds[5].toFixed(1)}, expected ${H - WALL}..${H}`,
      )
      // It must not foul the walls it drops between, or it would not go in.
      const walls = withLid.shapes.find((x) => x.id === 'box')
      add(
        'and clears the walls rather than overlapping them',
        !!lid && !!walls && lid.bounds[0] >= walls.bounds[0] + WALL - 0.01,
        `lid starts at x ${lid?.bounds[0].toFixed(2)}, inner wall face at ${((walls?.bounds[0] ?? 0) + WALL).toFixed(2)}`,
      )
    }

    // --- export path --------------------------------------------------------
    // Rebuild the plate: the checks above replaced what the kernel is holding,
    // and exporting works from the last thing built.
    await kernel.evaluate(makeDoc([8, 7, PLATE_T], true))
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
