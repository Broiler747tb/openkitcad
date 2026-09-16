import * as Comlink from 'comlink'
import type {
  Body,
  BodyOperation,
  Component,
  Feature,
  LidFit,
  Matrix4,
  Occurrence,
  OkcDocument,
  PlaneRef,
} from '../doc/types'
import { emptyDocument } from '../doc/types'
import { identityMatrix, multiplyMatrices, rotationMatrix, translationMatrix } from '../doc/model'
import type { BodyMesh, EvaluateResult, KernelApi } from '../kernel/types'
import { sketchRegions } from '../sketch/regions'
import { applySolve, solveSketch } from '../sketch/solver'
import { emptySketch, type Sketch2D } from '../sketch/types'
import type { TestResult } from './selftest'

const PLATE_W = 100
const PLATE_D = 70
const PLATE_T = 3
const XY: PlaneRef = { kind: 'named', name: 'XY', offset: 0 }

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

function body(id: string, name = id, extra: Partial<Body> = {}): Body {
  return { id, name, visible: true, colour: '#cccccc', ...extra }
}

function design(id: string, bodies: Body[]): Component {
  return { id, name: id, source: { kind: 'design' }, bodies }
}

function occurrence(
  id: string,
  parentComponentId: string,
  componentId: string,
  transform: Matrix4,
  extra: Partial<Occurrence> = {},
): Occurrence {
  return {
    id,
    parentComponentId,
    componentId,
    name: id,
    transform,
    visible: true,
    grounded: false,
    ...extra,
  }
}

function makeDocument(
  name: string,
  bodies: Body[],
  timeline: Feature[],
  extra: { components?: Component[]; occurrences?: Occurrence[]; marker?: number | null } = {},
): OkcDocument {
  const doc = emptyDocument(name)
  doc.components[0].bodies = bodies
  doc.components.push(...(extra.components ?? []))
  doc.occurrences = extra.occurrences ?? []
  doc.timeline = timeline
  doc.marker = extra.marker ?? null
  return doc
}

function boxFeature(
  id: string,
  bodyId: string,
  origin: [number, number],
  size: [number, number, number],
  extra: { componentId?: string; plane?: PlaneRef; name?: string; result?: BodyOperation } = {},
): Feature {
  return {
    id,
    name: extra.name ?? id,
    componentId: extra.componentId ?? 'root',
    kind: 'box',
    plane: extra.plane ?? XY,
    origin,
    width: size[0],
    depth: size[1],
    height: size[2],
    result: extra.result ?? { kind: 'newBody', bodyId },
  }
}

const PI_COMPONENT: Component = {
  id: 'pi-part',
  name: 'Raspberry Pi 4 Model B',
  source: { kind: 'catalogue', partId: 'raspberry-pi-4b' },
  bodies: [],
}

function piPlateDoc(piTransform: Matrix4, withStandoffs: boolean): OkcDocument {
  const timeline: Feature[] = [
    {
      id: 'f-sketch',
      name: 'Plate outline',
      componentId: 'root',
      kind: 'sketch',
      plane: XY,
      sketch: platePlan(),
      visible: true,
    },
    {
      id: 'f-extrude',
      name: 'Extrude plate',
      componentId: 'root',
      kind: 'extrude',
      sketchId: 'f-sketch',
      distance: PLATE_T,
      symmetric: false,
      reverse: false,
      result: { kind: 'newBody', bodyId: 'plate' },
    },
    {
      id: 'f-holes',
      name: 'Pi mounting holes',
      componentId: 'root',
      kind: 'hole',
      bodyId: 'plate',
      plane: { kind: 'named', name: 'XY', offset: PLATE_T },
      source: { kind: 'occurrence', occurrencePath: ['pi'], contextPath: [] },
      style: 'simple',
      diameter: 2.8,
      depth: 'through',
    },
  ]
  if (withStandoffs) {
    timeline.push({
      id: 'f-standoffs',
      name: 'Standoffs',
      componentId: 'root',
      kind: 'standoff',
      plane: { kind: 'named', name: 'XY', offset: PLATE_T },
      source: { kind: 'occurrence', occurrencePath: ['pi'], contextPath: [] },
      height: 6,
      outerDiameter: 6,
      boreDiameter: 2.1,
      boreDepth: 5,
      result: { kind: 'join', bodyId: 'plate' },
    })
  }
  return makeDocument(
    'Kernel test',
    [body('plate', 'Base plate', { colour: '#c8cdd3' })],
    timeline,
    {
      components: [PI_COMPONENT],
      occurrences: [
        occurrence('pi', 'root', 'pi-part', piTransform, { name: 'Raspberry Pi 4 Model B' }),
      ],
    },
  )
}

function circleSketch(x: number, y: number, r: number): Sketch2D {
  const s = emptySketch()
  s.points.push({ id: 'c', x, y })
  s.entities.push({ id: 'k', kind: 'circle', c: 'c', r, construction: false })
  return s
}

function facePlane(bodyId: string, name: string, offset = 0): PlaneRef {
  return { kind: 'face', face: { bodyId, kind: 'face', name }, offset }
}

function meshFor(result: EvaluateResult, instanceId: string): BodyMesh | undefined {
  const instance = result.instances.find((candidate) => candidate.id === instanceId)
  return instance ? result.meshes.find((mesh) => mesh.key === instance.meshKey) : undefined
}

function errorText(result: EvaluateResult): string {
  return result.errors.map((e) => `${e.featureId}: ${e.message}`).join('; ')
}

export async function runKernelTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const add = (name: string, pass: boolean, detail: string) => out.push({ name, pass, detail })

  const worker = new Worker(new URL('../kernel/worker.ts', import.meta.url), {
    type: 'module',
  })
  const kernel = Comlink.wrap<KernelApi>(worker)
  ;(window as any).__okc_kernel = kernel
  const evaluate = (doc: OkcDocument, known: string[] = []) => kernel.evaluate(doc, known)

  try {
    const t0 = performance.now()
    await kernel.ready()
    add('kernel boots', true, `OpenCascade ready in ${Math.round(performance.now() - t0)} ms`)
    const onPlate = await evaluate(piPlateDoc(translationMatrix([8, 7, PLATE_T]), true))
    add(
      'vertical slice builds without errors',
      onPlate.errors.length === 0,
      onPlate.errors.length ? errorText(onPlate) : `built in ${onPlate.elapsedMs} ms`,
    )
    add(
      'produces both the plate and the board',
      onPlate.instances.length === 2 &&
        onPlate.instances.some((i) => i.id === 'root|plate' && i.kind === 'body') &&
        onPlate.instances.some((i) => i.id === 'pi|pi-part' && i.kind === 'catalogue'),
      `${onPlate.instances.length} instance(s): ${onPlate.instances.map((i) => i.id).join(', ')}`,
    )

    const plate = meshFor(onPlate, 'root|plate')
    if (plate) {
      const [x0, y0, z0, x1, y1, z1] = plate.bounds
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
      add('plate was built', false, 'no instance "root|plate" with a mesh came back')
    }

    const jointed = piPlateDoc(translationMatrix([8, 7, PLATE_T]), true)
    const frame = identityMatrix()
    jointed.timeline.push({
      id: 'joint-kernel',
      kind: 'joint',
      name: 'Joint',
      componentId: jointed.rootComponentId,
      asBuilt: false,
      one: { occurrencePath: ['pi'], snap: { ref: null, keypoint: 'origin' }, frame },
      two: { occurrencePath: [], snap: { ref: null, keypoint: 'origin' }, frame },
      motion: { kind: 'revolute', axis: 'z' },
      flip: false,
      angle: 0,
      offset: 0,
      values: [0],
      limits: [],
    })
    const withJoint = await evaluate(jointed)
    add(
      'a joint in the timeline leaves the build alone',
      withJoint.errors.length === 0 && withJoint.instances.length === onPlate.instances.length,
      withJoint.errors.length
        ? errorText(withJoint)
        : withJoint.instances.map((i) => i.id).join(', '),
    )

    const holesOnly = await evaluate(piPlateDoc(translationMatrix([8, 7, PLATE_T]), false))
    const holesAway = await evaluate(piPlateDoc(translationMatrix([400, 400, PLATE_T]), false))
    const drilled = meshFor(holesOnly, 'root|plate')?.volume ?? 0
    const solid = meshFor(holesAway, 'root|plate')?.volume ?? 0
    const nominal = PLATE_W * PLATE_D * PLATE_T
    add(
      'an undrilled plate is exactly its nominal volume',
      Math.abs(solid - nominal) < 0.5,
      `${solid.toFixed(1)} mm3 (expected ${nominal})`,
    )
    const expectedRemoved = 4 * Math.PI * 1.4 * 1.4 * PLATE_T
    const removed = solid - drilled
    add(
      'holes are generated from the placed board',
      Math.abs(removed - expectedRemoved) < 0.5,
      `removed ${removed.toFixed(2)} mm3, expected ${expectedRemoved.toFixed(2)} mm3 for four 2.8 mm holes`,
    )

    {
      const V = 40 * 40 * 20
      const OVERLAP = 20 * 40 * 20
      const combineDoc = (op: 'join' | 'cut' | 'intersect'): OkcDocument =>
        makeDocument(
          'combine',
          [body('tool', 'Tool'), body('main', 'Main')],
          [
            boxFeature('t', 'tool', [20, 0], [40, 40, 20]),
            boxFeature('m', 'main', [0, 0], [40, 40, 20]),
            {
              id: 'c',
              name: 'Combine',
              componentId: 'root',
              kind: 'combine',
              bodyId: 'main',
              toolBodyIds: ['tool'],
              operation: op,
              keepTools: false,
            },
          ],
        )
      for (const [op, expected] of [
        ['join', 2 * V - OVERLAP],
        ['cut', V - OVERLAP],
        ['intersect', OVERLAP],
      ] as const) {
        const r = await evaluate(combineDoc(op))
        const main = meshFor(r, 'root|main')
        add(
          `combining two bodies with "${op}"`,
          !!main && Math.abs(main.volume - expected) < 1 && r.errors.length === 0,
          `${main?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${expected}` +
            (r.errors.length ? ` (${r.errors[0].message})` : ''),
        )
        add(
          `the body merged in by "${op}" is no longer drawn separately`,
          r.instances.length === 1,
          `${r.instances.length} instance(s) left`,
        )
      }
    }

    {
      const r = await evaluate(
        makeDocument(
          'tilt',
          [body('b', 'Tilted')],
          [
            boxFeature('bx', 'b', [0, 0], [40, 20, 5], {
              plane: { kind: 'angled', name: 'XY', tiltAxis: 'x', angle: 30, offset: 0 },
            }),
          ],
        ),
      )
      const slab = meshFor(r, 'root|b')
      add(
        'a solid built on a tilted plane has the right volume',
        !!slab && Math.abs(slab.volume - 40 * 20 * 5) < 1,
        `${slab?.volume.toFixed(0) ?? 'nothing'} mm3, expected 4000`,
      )
      const expectedSpan = 20 * Math.cos(Math.PI / 6) + 5 * Math.sin(Math.PI / 6)
      add(
        'and is genuinely tilted, not flat',
        !!slab && Math.abs(slab.bounds[4] - slab.bounds[1] - expectedSpan) < 0.1,
        `spans ${(slab ? slab.bounds[4] - slab.bounds[1] : 0).toFixed(2)} mm front to back, expected ${expectedSpan.toFixed(2)}`,
      )
    }

    {
      const moved = async (offset: [number, number, number], rotation: [number, number, number]) =>
        meshFor(
          await evaluate(
            makeDocument(
              'move',
              [body('b', 'Slab')],
              [
                boxFeature('bx', 'b', [0, 0], [40, 20, 10]),
                {
                  id: 'mv',
                  name: 'Move',
                  componentId: 'root',
                  kind: 'move',
                  bodyIds: ['b'],
                  offset,
                  rotation,
                },
              ],
            ),
          ),
          'root|b',
        )
      const still = await moved([0, 0, 0], [0, 0, 0])
      add(
        'a move step with nothing set leaves the part alone',
        !!still && still.bounds.every((v, i) => Math.abs(v - [0, 0, 0, 40, 20, 10][i]) < 1e-6),
        `bounds ${still?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )
      const shifted = await moved([100, 5, -3], [0, 0, 0])
      add(
        'moving a body shifts it by exactly that much',
        !!shifted &&
          shifted.bounds.every((v, i) => Math.abs(v - [100, 5, -3, 140, 25, 7][i]) < 1e-6),
        `bounds ${shifted?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )
      const turned = await moved([0, 0, 0], [0, 0, 90])
      add(
        'turning a body pivots about its own centre',
        !!turned && turned.bounds.every((v, i) => Math.abs(v - [10, -10, 0, 30, 30, 10][i]) < 1e-6),
        `bounds ${turned?.bounds.map((v) => v.toFixed(2)).join(', ')}`,
      )
      add(
        'and does not distort it',
        !!turned && Math.abs(turned.volume - 40 * 20 * 10) < 1e-3,
        `${turned?.volume.toFixed(2)} mm3, expected 8000`,
      )
      const diagonal = await moved([0, 0, 0], [0, 0, 45])
      const span = 60 * Math.cos(Math.PI / 4)
      add(
        'a 45 degree turn spans the diagonal, still centred',
        !!diagonal &&
          Math.abs(diagonal.bounds[3] - diagonal.bounds[0] - span) < 1e-3 &&
          Math.abs((diagonal.bounds[0] + diagonal.bounds[3]) / 2 - 20) < 1e-6,
        `spans ${(diagonal ? diagonal.bounds[3] - diagonal.bounds[0] : 0).toFixed(3)} mm, expected ${span.toFixed(3)}`,
      )
    }
    {
      const sphereV = (4 / 3) * Math.PI * 15 ** 3
      const sphere = (
        id: string,
        bodyId: string,
        centre: [number, number],
        half: boolean,
      ): Feature => ({
        id,
        name: id,
        componentId: 'root',
        kind: 'sphere',
        plane: XY,
        centre,
        radius: 15,
        half,
        result: { kind: 'newBody', bodyId },
      })
      const shapes = await evaluate(
        makeDocument(
          'shapes',
          [body('ball', 'Ball'), body('dome', 'Dome')],
          [sphere('s', 'ball', [0, 0], false), sphere('d', 'dome', [60, 0], true)],
        ),
      )
      const ball = meshFor(shapes, 'root|ball')
      const dome = meshFor(shapes, 'root|dome')
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

      const carved = await evaluate(
        makeDocument(
          'carve',
          [body('b', 'B')],
          [
            boxFeature('bx', 'b', [-20, -20], [40, 40, 40]),
            {
              id: 'sp',
              name: 'Scoop',
              componentId: 'root',
              kind: 'sphere',
              plane: { kind: 'named', name: 'XY', offset: 20 },
              centre: [0, 0],
              radius: 10,
              half: false,
              result: { kind: 'cut', bodyIds: ['b'] },
            },
          ],
        ),
      )
      const expected = 40 ** 3 - (4 / 3) * Math.PI * 10 ** 3
      const scooped = meshFor(carved, 'root|b')
      add(
        'a shape used as a negative scoops material out',
        Math.abs((scooped?.volume ?? 0) - expected) < 10,
        `${scooped?.volume.toFixed(0) ?? 'nothing'} mm3, expected ${expected.toFixed(0)}`,
      )
    }

    {
      const PANEL = 60
      const T = 3
      const SIZE = 6
      const MARGIN = 4
      const vented = await evaluate(
        makeDocument(
          'vent',
          [body('p', 'Panel')],
          [
            boxFeature('pl', 'p', [-PANEL / 2, -PANEL / 2], [PANEL, PANEL, T]),
            {
              id: 'v',
              name: 'Vent',
              componentId: 'root',
              kind: 'vent',
              bodyId: 'p',
              plane: { kind: 'named', name: 'XY', offset: T },
              shape: 'hex',
              size: SIZE,
              spacing: 2,
              margin: MARGIN,
              depth: 'through',
            },
          ],
        ),
      )
      const panel = meshFor(vented, 'root|p')
      const solidV = PANEL * PANEL * T
      const hexArea = (Math.sqrt(3) / 2) * SIZE * SIZE
      const holes = (solidV - (panel?.volume ?? solidV)) / (hexArea * T)
      add(
        'a hex vent grid cuts a whole number of hexagons',
        vented.errors.length === 0 && holes > 10 && Math.abs(holes - Math.round(holes)) < 0.02,
        `${holes.toFixed(2)} hexagons' worth removed` +
          (vented.errors.length ? ` (${vented.errors[0].message})` : ''),
      )
      add(
        'and leaves the edge border intact',
        !!panel &&
          Math.abs(panel.bounds[3] - panel.bounds[0] - PANEL) < 0.01 &&
          Math.abs(panel.bounds[4] - panel.bounds[1] - PANEL) < 0.01,
        `panel still ${(panel ? panel.bounds[3] - panel.bounds[0] : 0).toFixed(2)} mm across`,
      )
    }

    {
      const W = 50
      const D = 40
      const H = 30
      const WALL = 2
      const GAP = 0.3
      const lidDoc = (clearance: number, fit: LidFit, seat: boolean): OkcDocument =>
        makeDocument(
          `lid-${fit}`,
          [body('box', 'Box'), body('lid', 'Lid', { colour: '#bbbbbb' })],
          [
            boxFeature('bx', 'box', [0, 0], [W, D, H]),
            {
              id: 'sh',
              name: 'Hollow',
              componentId: 'root',
              kind: 'shell',
              bodyId: 'box',
              thickness: WALL,
              openFaces: [{ bodyId: 'box', kind: 'face', name: 'bx:+z' }],
            },
            {
              id: 'ld',
              name: 'Lid',
              componentId: 'root',
              kind: 'lid',
              sourceBodyId: 'box',
              shellFeatureId: 'sh',
              thickness: WALL,
              clearance,
              fit,
              result: { kind: 'newBody', bodyId: 'lid' },
            },
            ...(seat
              ? [
                  {
                    id: 'seat',
                    name: 'Seat',
                    componentId: 'root',
                    kind: 'lidSocket' as const,
                    bodyId: 'box',
                    lidFeatureId: 'ld',
                  },
                ]
              : []),
          ],
        )

      const withLid = await evaluate(lidDoc(0, 'friction', false))
      const lid = meshFor(withLid, 'root|lid')
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
      const walls = meshFor(withLid, 'root|box')
      const hollowVolume = walls?.volume
      add(
        'and clears the walls rather than overlapping them',
        !!lid && !!walls && lid.bounds[0] >= walls.bounds[0] + WALL - 0.01,
        `lid starts at x ${lid?.bounds[0].toFixed(2)}, inner wall face at ${((walls?.bounds[0] ?? 0) + WALL).toFixed(2)}`,
      )

      const fitted = async (fit: LidFit) => {
        const r = await evaluate(lidDoc(GAP, fit, fit !== 'friction'))
        return {
          box: meshFor(r, 'root|box'),
          lid: meshFor(r, 'root|lid'),
          errors: r.errors.length,
        }
      }

      {
        const { box: ledgeBox, lid: ledgeLid, errors: ledgeErrors } = await fitted('ledge')
        const ledge = WALL / 2
        const span = W - 2 * (WALL - ledge + GAP)
        add(
          'a ledge lid laps over the step, wider than the hole',
          !!ledgeLid && Math.abs(ledgeLid.bounds[3] - ledgeLid.bounds[0] - span) < 1e-3,
          `${(ledgeLid ? ledgeLid.bounds[3] - ledgeLid.bounds[0] : 0).toFixed(3)} mm across, expected ${span.toFixed(3)}`,
        )
        const removedStep =
          (W - 2 * (WALL - ledge)) * (D - 2 * (WALL - ledge)) * WALL -
          (W - 2 * WALL) * (D - 2 * WALL) * WALL
        add(
          'and the box loses exactly the step that was cut for it',
          !!ledgeBox && Math.abs((hollowVolume ?? 0) - ledgeBox.volume - removedStep) < 1e-3,
          `${((hollowVolume ?? 0) - (ledgeBox?.volume ?? 0)).toFixed(2)} mm3 removed, expected ${removedStep.toFixed(2)}`,
        )
        add('and builds without complaint', ledgeErrors === 0, `${ledgeErrors} error(s)`)
      }

      {
        const { box: snapBox, lid: snapLid, errors: snapErrors } = await fitted('snap')
        const depth = Math.max(3, WALL * 2)
        const BEAD = 0.4
        add(
          'a snap lid hangs a skirt below the plug',
          !!snapLid && Math.abs(snapLid.bounds[5] - snapLid.bounds[2] - (WALL + depth)) < 1e-3,
          `${(snapLid ? snapLid.bounds[5] - snapLid.bounds[2] : 0).toFixed(3)} mm deep, expected ${(WALL + depth).toFixed(3)}`,
        )
        const beadSpan = W - 2 * (WALL + GAP - BEAD)
        add(
          'with a bead round it as the widest part',
          !!snapLid && Math.abs(snapLid.bounds[3] - snapLid.bounds[0] - beadSpan) < 1e-3,
          `${(snapLid ? snapLid.bounds[3] - snapLid.bounds[0] : 0).toFixed(3)} mm across, expected ${beadSpan.toFixed(3)}`,
        )
        add(
          'that reaches into the wall, so it has something to click past',
          WALL + GAP - BEAD < WALL,
          `bead face at ${(WALL + GAP - BEAD).toFixed(2)} mm in, wall face at ${WALL.toFixed(2)}`,
        )
        add(
          'and the box gains a groove for it',
          !!snapBox && snapBox.volume < (hollowVolume ?? 0) - 1e-6,
          `${((hollowVolume ?? 0) - (snapBox?.volume ?? 0)).toFixed(2)} mm3 grooved out`,
        )
        add('and builds without complaint', snapErrors === 0, `${snapErrors} error(s)`)
      }

      {
        const { box: plainBox } = await fitted('friction')
        add(
          'a drop-in lid cuts nothing into the box',
          !!plainBox && Math.abs(plainBox.volume - (hollowVolume ?? 0)) < 1e-6,
          `box is ${plainBox?.volume.toFixed(2)} mm3, unhollowed-with-lid was ${hollowVolume?.toFixed(2)}`,
        )
      }

      const gapped = await evaluate(lidDoc(GAP, 'friction', false))
      const loose = meshFor(gapped, 'root|lid')
      const expectedSpan = W - 2 * WALL - 2 * GAP
      add(
        'a gap makes the lid smaller by exactly that much all round',
        !!loose && Math.abs(loose.bounds[3] - loose.bounds[0] - expectedSpan) < 1e-3,
        `${(loose ? loose.bounds[3] - loose.bounds[0] : 0).toFixed(3)} mm across, expected ${expectedSpan.toFixed(3)}`,
      )
      add(
        'and leaves it flush with the outside, not sunk into the box',
        !!loose && Math.abs(loose.bounds[5] - H) < 1e-6,
        `top at z ${loose?.bounds[5].toFixed(3)}, expected ${H}`,
      )
    }
    await evaluate(piPlateDoc(translationMatrix([8, 7, PLATE_T]), true))
    try {
      const step = await kernel.exportStep(['root|plate'], 'plate')
      const head = new TextDecoder().decode(new Uint8Array(step.slice(0, 13)))
      add(
        'STEP export produces a real STEP file',
        head.startsWith('ISO-10303-21'),
        `${(step.byteLength / 1024).toFixed(1)} kB, header "${head}"`,
      )
    } catch (e) {
      add('STEP export produces a real STEP file', false, (e as Error).message)
    }

    {
      const failures: string[] = []
      for (let round = 0; round < 25 && failures.length === 0; round++) {
        try {
          const r = await evaluate(
            makeDocument(
              'repeated export',
              [body('rx', 'Exported')],
              [boxFeature('rxb', 'rx', [0, 0], [20 + round, 10, 5])],
            ),
          )
          if (r.errors.length) failures.push(`round ${round}: ${errorText(r)}`)
          const step = await kernel.exportStep(['root|rx'], 'repeat')
          if (step.byteLength < 1000) failures.push(`round ${round}: ${step.byteLength} bytes`)
        } catch (e) {
          failures.push(`round ${round}: ${(e as Error).message}`)
        }
      }
      add(
        'exporting STEP over and over leaves the kernel healthy',
        failures.length === 0,
        failures[0] ?? '25 exports',
      )
      await evaluate(piPlateDoc(translationMatrix([8, 7, PLATE_T]), true))
    }

    const circlesAt = async (instance: string, expected: number[][]) => {
      const proj = await kernel.project(instance, 'XY')
      const matched = expected.filter((e) =>
        proj.circles.some((c) => Math.hypot(c.cx - e[0], c.cy - e[1]) < 0.02),
      )
      return {
        proj,
        matched: matched.length,
        detail: `${matched.length}/${expected.length} matched; got ${proj.circles
          .map((c) => `(${c.cx.toFixed(2)}, ${c.cy.toFixed(2)})`)
          .join(' ')}`,
      }
    }

    try {
      await evaluate(piPlateDoc(translationMatrix([8, 7, PLATE_T]), false))
      const { proj, matched, detail } = await circlesAt('root|plate', [
        [11.5, 10.5],
        [69.5, 10.5],
        [11.5, 59.5],
        [69.5, 59.5],
      ])
      add(
        'projection finds the four holes as true circles',
        proj.circles.length === 4 && proj.circles.every((c) => Math.abs(c.r - 1.4) < 0.01),
        `${proj.circles.length} circle(s), ${proj.polylines.length} polyline(s); radii ${proj.circles
          .map((c) => c.r.toFixed(3))
          .join(', ')} (expected four at 1.400)`,
      )
      add(
        'projection is not mirrored',
        Math.abs(proj.bounds[1]) < 0.01 && Math.abs(proj.bounds[3] - PLATE_D) < 0.01,
        `y spans ${proj.bounds[1].toFixed(2)}..${proj.bounds[3].toFixed(2)} (expected 0..${PLATE_D})`,
      )
      add('hole centres land exactly under the board', matched === 4, detail)
    } catch (e) {
      add('projection finds the four holes as true circles', false, (e as Error).message)
    }

    try {
      const shiftedDoc = piPlateDoc(translationMatrix([20, 10, PLATE_T]), false)
      const shifted = await evaluate(shiftedDoc)
      const moved = await circlesAt('root|plate', [
        [23.5, 13.5],
        [81.5, 13.5],
        [23.5, 62.5],
        [81.5, 62.5],
      ])
      add(
        'a Pi occurrence moved on the plate drags its mounting holes along',
        shifted.errors.length === 0 && moved.matched === 4,
        moved.detail,
      )
      const turned = await evaluate(
        piPlateDoc(
          multiplyMatrices(translationMatrix([70, 5, PLATE_T]), rotationMatrix('z', 90)),
          false,
        ),
      )
      const rotated = await circlesAt('root|plate', [
        [66.5, 8.5],
        [66.5, 66.5],
        [17.5, 8.5],
        [17.5, 66.5],
      ])
      add(
        'and turning the occurrence turns the hole pattern with it',
        turned.errors.length === 0 && rotated.matched === 4,
        rotated.detail,
      )
      const away = await evaluate(piPlateDoc(translationMatrix([400, 400, PLATE_T]), false))
      const awayMesh = meshFor(away, 'root|plate')
      add(
        'and the plate returns to nominal volume when the Pi moves off it',
        !!awayMesh &&
          Math.abs(awayMesh.volume - nominal) < 0.5 &&
          awayMesh.key !== meshFor(turned, 'root|plate')?.key,
        `${awayMesh?.volume.toFixed(1) ?? 'nothing'} mm3 (expected ${nominal})`,
      )
    } catch (e) {
      add('a Pi occurrence moved on the plate drags its mounting holes along', false, String(e))
    }

    const linked = makeDocument(
      'linked',
      [],
      [boxFeature('bkx', 'bk', [0, 0], [20, 10, 5], { componentId: 'bracket' })],
      {
        components: [design('bracket', [body('bk', 'Bracket')])],
        occurrences: [
          occurrence('c1', 'root', 'bracket', identityMatrix()),
          occurrence('c2', 'root', 'bracket', translationMatrix([100, 0, 0])),
        ],
      },
    )
    {
      const r = await evaluate(linked)
      const a = r.instances.find((i) => i.id === 'c1|bk')
      const b = r.instances.find((i) => i.id === 'c2|bk')
      add(
        'two occurrences of one component share a mesh key at different matrices',
        !!a &&
          !!b &&
          a.meshKey === b.meshKey &&
          a.matrix[12] === 0 &&
          b.matrix[12] === 100 &&
          r.meshes.filter((m) => m.key === a.meshKey).length === 1,
        `${r.instances.map((i) => `${i.id} ${i.meshKey} x=${i.matrix[12]}`).join(', ')}; ${r.meshes.length} mesh(es)`,
      )
      const gap = await kernel.distanceBetween('c1|bk', 'c2|bk')
      add(
        'and measuring between them works in world space',
        gap !== null && Math.abs(gap - 80) < 1e-6,
        `${gap?.toFixed(3) ?? 'nothing'} mm apart, expected 80`,
      )
    }

    {
      const nested = makeDocument(
        'nested',
        [],
        [
          boxFeature('cpx', 'cp', [0, 0], [PLATE_W, PLATE_D, PLATE_T], { componentId: 'case' }),
          {
            id: 'cph',
            name: 'Holes from the nested Pi',
            componentId: 'case',
            kind: 'hole',
            bodyId: 'cp',
            plane: { kind: 'named', name: 'XY', offset: PLATE_T },
            source: { kind: 'occurrence', occurrencePath: ['k1', 'kp'], contextPath: ['k1'] },
            style: 'simple',
            diameter: 2.8,
            depth: 'through',
          },
          boxFeature('ibx', 'ib', [0, 0], [10, 10, 10], { componentId: 'inner' }),
        ],
        {
          components: [
            design('case', [body('cp', 'Case plate')]),
            design('inner', [body('ib', 'Inner block')]),
            PI_COMPONENT,
          ],
          occurrences: [
            occurrence('k1', 'root', 'case', translationMatrix([50, 0, 0])),
            occurrence('kp', 'case', 'pi-part', translationMatrix([8, 7, PLATE_T])),
            occurrence('i1', 'case', 'inner', translationMatrix([0, 20, 0])),
          ],
        },
      )
      const r = await evaluate(nested)
      const block = r.instances.find((i) => i.id === 'k1/i1|ib')
      const pi = r.instances.find((i) => i.id === 'k1/kp|pi-part')
      const world = await kernel.meshOf('k1/i1|ib')
      let minX = Infinity
      let minY = Infinity
      for (let i = 0; i < world.vertices.length; i += 3) {
        minX = Math.min(minX, world.vertices[i])
        minY = Math.min(minY, world.vertices[i + 1])
      }
      add(
        'nested occurrences compose their placements',
        r.errors.length === 0 &&
          !!block &&
          block.matrix[12] === 50 &&
          block.matrix[13] === 20 &&
          !!pi &&
          pi.matrix[12] === 58 &&
          Math.abs(minX - 50) < 1e-6 &&
          Math.abs(minY - 20) < 1e-6,
        `block at ${block?.matrix.slice(12, 15).join(', ')}, Pi at ${pi?.matrix.slice(12, 15).join(', ')}, world mesh from ${minX.toFixed(2)}, ${minY.toFixed(2)}` +
          (r.errors.length ? ` (${errorText(r)})` : ''),
      )
      const holes = await circlesAt('k1|cp', [
        [61.5, 10.5],
        [119.5, 10.5],
        [61.5, 59.5],
        [119.5, 59.5],
      ])
      add(
        'holes from a nested part are measured in their own component',
        holes.matched === 4,
        holes.detail,
      )
    }

    const negativeDoc = (negative: boolean) =>
      makeDocument(
        'negative',
        [body('a', 'A'), body('b', 'B')],
        [
          boxFeature('ax', 'a', [0, 0], [40, 40, 20]),
          boxFeature('bx', 'b', [200, 0], [40, 40, 20]),
          boxFeature('cx', 'cb', [0, 0], [10, 10, 40], { componentId: 'cutter' }),
        ],
        {
          components: [design('cutter', [body('cb', 'Cutter')])],
          occurrences: [
            occurrence('neg', 'root', 'cutter', translationMatrix([15, 15, -10]), { negative }),
          ],
        },
      )
    {
      const plain = await evaluate(negativeDoc(false))
      const cut = await evaluate(negativeDoc(true))
      const aPlain = plain.instances.find((i) => i.id === 'root|a')
      const aCut = cut.instances.find((i) => i.id === 'root|a')
      const bPlain = plain.instances.find((i) => i.id === 'root|b')
      const bCut = cut.instances.find((i) => i.id === 'root|b')
      const cutVolume = meshFor(cut, 'root|a')?.volume ?? 0
      add(
        'a negative occurrence cuts the body it overlaps',
        !!aPlain &&
          !!aCut &&
          aCut.meshKey !== aPlain.meshKey &&
          Math.abs(cutVolume - (16000 * 2 - 2000)) < 1 &&
          cut.instances.some((i) => i.id === 'neg|cb' && i.negative),
        `${cutVolume.toFixed(1)} mm3, expected ${16000 * 2 - 2000}` +
          (cut.errors.length ? ` (${errorText(cut)})` : ''),
      )
      add(
        'while a body it does not overlap keeps its shared mesh key',
        !!bPlain && !!bCut && bCut.meshKey === bPlain.meshKey,
        `${bPlain?.meshKey} then ${bCut?.meshKey}`,
      )

      const keys = [...new Set(cut.instances.map((i) => i.meshKey))]
      const again = await evaluate(negativeDoc(true), keys)
      const partial = await evaluate(negativeDoc(true), keys.slice(1))
      add(
        'known mesh keys suppress meshes the main thread already holds',
        again.meshes.length === 0 &&
          again.instances.length === cut.instances.length &&
          again.instances.every((i) => keys.includes(i.meshKey)) &&
          partial.meshes.length === 1 &&
          partial.meshes[0].key === keys[0] &&
          partial.meshes[0].mesh.vertices.length > 0,
        `${keys.length} key(s); ${again.meshes.length} mesh(es) with all known, ${partial.meshes.length} with one missing`,
      )
    }

    {
      const cacheDoc = (radius: number) =>
        makeDocument(
          'cache',
          [body('cc', 'Cached')],
          [
            boxFeature('ccx', 'cc', [0, 0], [33, 27, 11]),
            {
              id: 'ccf',
              name: 'Cached fillet',
              componentId: 'root',
              kind: 'fillet',
              bodyId: 'cc',
              radius,
              edges: [],
            },
          ],
        )
      await evaluate(cacheDoc(1))
      const twice = await evaluate(cacheDoc(1))
      add(
        'evaluating the same document twice is all cache hits',
        twice.cache.misses === 0 && twice.cache.hits === 2,
        `hits ${twice.cache.hits}, misses ${twice.cache.misses}, entries ${twice.cache.entries}`,
      )
      const edited = await evaluate(cacheDoc(1.5))
      add(
        'changing only the last feature is exactly one miss',
        edited.cache.misses === 1 && edited.cache.hits === 1,
        `hits ${edited.cache.hits}, misses ${edited.cache.misses}, entries ${edited.cache.entries}`,
      )
    }

    {
      const markerDoc = (marker: number | null) =>
        makeDocument(
          'marker',
          [body('m', 'Marked'), body('late', 'Late')],
          [
            boxFeature('mb', 'm', [0, 0], [20, 20, 20]),
            {
              id: 'mf',
              name: 'Rolled back fillet',
              componentId: 'root',
              kind: 'fillet',
              bodyId: 'm',
              radius: 2,
              edges: [],
            },
            boxFeature('lb', 'late', [40, 0], [5, 5, 5]),
          ],
          { marker },
        )
      const full = await evaluate(markerDoc(null))
      const rolled = await evaluate(markerDoc(1))
      const fullVolume = meshFor(full, 'root|m')?.volume ?? 0
      const rolledVolume = meshFor(rolled, 'root|m')?.volume ?? 0
      add(
        'the marker excludes the features after it',
        full.instances.length === 2 &&
          fullVolume < 8000 - 1 &&
          rolled.instances.length === 1 &&
          Math.abs(rolledVolume - 8000) < 0.01 &&
          rolled.errors.length === 0,
        `${full.instances.length} then ${rolled.instances.length} instance(s); ${fullVolume.toFixed(1)} then ${rolledVolume.toFixed(1)} mm3`,
      )
    }

    {
      const base = makeDocument(
        'preview',
        [body('pv', 'Previewed')],
        [boxFeature('pb', 'pv', [0, 0], [24, 24, 12])],
      )
      const pendingFillet = (id: string, radius: number): Feature => ({
        id,
        name: 'Pending fillet',
        componentId: 'root',
        kind: 'fillet',
        bodyId: 'pv',
        radius,
        edges: [],
      })
      const before = await evaluate(base)
      const pending = await kernel.preview(
        { doc: base, features: [pendingFillet('pf', 2)], insertAt: base.timeline.length },
        [],
      )
      const after = await evaluate(base)
      const beforeVolume = meshFor(before, 'root|pv')?.volume ?? 0
      const pendingVolume = meshFor(pending, 'root|pv')?.volume ?? 0
      const afterMesh = meshFor(after, 'root|pv')
      add(
        'a preview of a pending fillet differs from the evaluated design',
        pending.errors.length === 0 &&
          pendingVolume < beforeVolume - 1 &&
          pending.instances.length === 1 &&
          pending.instances.every((i) => i.preview === true),
        `${pendingVolume.toFixed(1)} mm3 previewed against ${beforeVolume.toFixed(1)} mm3`,
      )
      add(
        'and the next evaluate is unchanged by it',
        !!afterMesh &&
          Math.abs(afterMesh.volume - beforeVolume) < 1e-9 &&
          after.instances[0]?.meshKey === before.instances[0]?.meshKey &&
          after.instances.every((i) => !i.preview),
        `${afterMesh?.volume.toFixed(1) ?? 'nothing'} mm3 after, ${beforeVolume.toFixed(1)} before`,
      )

      const edited = makeDocument(
        'preview-edit',
        [body('pv', 'Previewed')],
        [
          boxFeature('pb', 'pv', [0, 0], [24, 24, 12]),
          pendingFillet('pf', 1),
          boxFeature('later', 'extra', [60, 0], [5, 5, 5]),
        ],
      )
      edited.components[0].bodies.push(body('extra', 'Later body'))
      const replaced = await kernel.preview(
        { doc: edited, features: [pendingFillet('pf', 3)], insertAt: 1, replaceFeatureId: 'pf' },
        [],
      )
      const committed = await evaluate(edited)
      const replacedVolume = meshFor(replaced, 'root|pv')?.volume ?? 0
      const committedVolume = meshFor(committed, 'root|pv')?.volume ?? 0
      add(
        'editing a feature previews the replacement and nothing after it',
        replacedVolume < committedVolume - 1 &&
          replaced.instances.length === 1 &&
          committed.instances.length === 2,
        `${replacedVolume.toFixed(1)} mm3 previewed, ${committedVolume.toFixed(1)} mm3 evaluated; ${replaced.instances.length} previewed instance(s)`,
      )
    }

    {
      const failing = makeDocument(
        'failure',
        [body('fb', 'Broken'), body('ok', 'Fine')],
        [
          {
            id: 'fs',
            name: 'Empty sketch',
            componentId: 'root',
            kind: 'sketch',
            plane: XY,
            sketch: emptySketch(),
            visible: true,
          },
          {
            id: 'fe',
            name: 'Extrude nothing',
            componentId: 'root',
            kind: 'extrude',
            sketchId: 'fs',
            distance: 5,
            symmetric: false,
            reverse: false,
            result: { kind: 'newBody', bodyId: 'fb' },
          },
          {
            id: 'ff',
            name: 'Round nothing',
            componentId: 'root',
            kind: 'fillet',
            bodyId: 'fb',
            radius: 1,
            edges: [],
          },
          boxFeature('ob', 'ok', [0, 0], [20, 20, 20]),
          {
            id: 'big',
            name: 'Fillet on a lost edge',
            componentId: 'root',
            kind: 'fillet',
            bodyId: 'ok',
            radius: 2,
            edges: [{ bodyId: 'ok', kind: 'edge', name: 'ob:+x&+q' }],
          },
        ],
      )
      const r = await evaluate(failing)
      const failed = r.errors.find((e) => e.featureId === 'fe')
      const dependent = r.errors.find((e) => e.featureId === 'ff')
      add(
        'a failing feature reports its feature id',
        !!failed && failed.severity === 'error' && !r.instances.some((i) => i.bodyId === 'fb'),
        errorText(r),
      )
      add(
        'and its dependents report what they depend on',
        dependent?.message === 'Depends on Extrude nothing, which failed.' &&
          dependent.severity === 'error',
        dependent?.message ?? 'no error for the dependent fillet',
      )
      const thrown = r.errors.find((e) => e.featureId === 'big')
      const intact = meshFor(r, 'root|ok')?.volume ?? 0
      add(
        'a feature that throws leaves its body as it was',
        !!thrown && !!thrown.hint && Math.abs(intact - 8000) < 0.01,
        `${thrown?.message ?? 'no error'}; body ${intact.toFixed(1)} mm3`,
      )
    }

    {
      const knobDoc = (height: number): OkcDocument =>
        makeDocument(
          'face sketch',
          [body('b', 'Block'), body('knob', 'Knob')],
          [
            boxFeature('bx', 'b', [0, 0], [40, 30, height]),
            {
              id: 'fs',
              name: 'On top',
              componentId: 'root',
              kind: 'sketch',
              plane: facePlane('b', 'bx:+z'),
              sketch: circleSketch(12, 9, 3),
              visible: true,
            },
            {
              id: 'fx',
              name: 'Knob',
              componentId: 'root',
              kind: 'extrude',
              sketchId: 'fs',
              distance: 4,
              symmetric: false,
              reverse: false,
              result: { kind: 'newBody', bodyId: 'knob' },
            },
          ],
        )

      const low = await evaluate(knobDoc(20))
      const block = meshFor(low, 'root|b')
      const faceNames = block?.mesh.faceGroups.map((group) => group.name) ?? []
      const edgeNames = block?.edges.edgeGroups.map((group) => group.name) ?? []
      add(
        'every face and edge of a built body is named',
        faceNames.length === 6 &&
          new Set(faceNames).size === 6 &&
          faceNames.includes('bx:+z') &&
          edgeNames.length === 12 &&
          new Set(edgeNames).size === 12 &&
          edgeNames.every((name) => name.length > 0),
        `faces ${faceNames.join(', ')}; ${edgeNames.length} edges`,
      )

      for (const height of [20, 35]) {
        const r = height === 20 ? low : await evaluate(knobDoc(height))
        const knob = meshFor(r, 'root|knob')
        const [x0, y0, z0, x1, y1, z1] = knob?.bounds ?? [0, 0, 0, 0, 0, 0]
        const GAP = 0.05
        add(
          `a sketch on a face sits on that face when the block is ${height} mm tall`,
          r.errors.length === 0 &&
            Math.abs(x0 - 9) < GAP &&
            Math.abs(x1 - 15) < GAP &&
            Math.abs(y0 - 6) < GAP &&
            Math.abs(y1 - 12) < GAP &&
            Math.abs(z0 - height) < GAP &&
            Math.abs(z1 - height - 4) < GAP,
          r.errors.length
            ? errorText(r)
            : `knob x ${x0.toFixed(2)}..${x1.toFixed(2)}, y ${y0.toFixed(2)}..${y1.toFixed(2)}, z ${z0.toFixed(2)}..${z1.toFixed(2)}`,
        )
        const plane = r.planes.find((entry) => entry.featureId === 'fs')?.frame
        add(
          `the face plane comes back with its origin under the component origin (${height} mm)`,
          !!plane &&
            Math.hypot(plane.origin[0], plane.origin[1], plane.origin[2] - height) < 1e-6 &&
            Math.abs(plane.normal[2] - 1) < 1e-9,
          plane ? `origin ${plane.origin.join(', ')}, normal ${plane.normal.join(', ')}` : 'none',
        )
      }

      const curved = await evaluate(
        makeDocument(
          'curved face',
          [body('can', 'Can')],
          [
            {
              id: 'cy',
              name: 'Can',
              componentId: 'root',
              kind: 'cylinder',
              plane: XY,
              centre: [0, 0],
              radius: 10,
              height: 20,
              result: { kind: 'newBody', bodyId: 'can' },
            },
            {
              id: 'cs',
              name: 'On the side',
              componentId: 'root',
              kind: 'sketch',
              plane: facePlane('can', 'cy:side'),
              sketch: circleSketch(0, 0, 2),
              visible: true,
            },
          ],
        ),
      )
      const refused = curved.errors.find((error) => error.featureId === 'cs')
      add(
        'a sketch cannot sit on a curved face',
        !!refused && refused.message.includes('flat face'),
        refused?.message ?? errorText(curved),
      )

      const topEdge = edgeNames.find((name) => name.includes('bx:+y') && name.includes('bx:+z'))
      const RADIUS = 3
      const removed = (1 - Math.PI / 4) * RADIUS * RADIUS * 40
      for (const height of [20, 35]) {
        const r = await evaluate(
          makeDocument(
            'named fillet',
            [body('b', 'Block')],
            [
              boxFeature('bx', 'b', [0, 0], [40, 30, height]),
              {
                id: 'fl',
                name: 'Round',
                componentId: 'root',
                kind: 'fillet',
                bodyId: 'b',
                radius: RADIUS,
                edges: [{ bodyId: 'b', kind: 'edge', name: topEdge ?? 'none' }],
              },
            ],
          ),
        )
        const volume = meshFor(r, 'root|b')?.volume ?? 0
        const expected = 40 * 30 * height - removed
        add(
          `a fillet keeps its named edge when the block is ${height} mm tall`,
          !!topEdge && r.errors.length === 0 && Math.abs(volume - expected) < 0.5,
          r.errors.length
            ? errorText(r)
            : `${topEdge}: ${volume.toFixed(2)} mm3, expected ${expected.toFixed(2)}`,
        )
      }

      const H = 20
      const slotted = await evaluate(
        makeDocument(
          'negative slot',
          [body('b', 'Block'), body('slot', 'Slot', { negative: true })],
          [
            boxFeature('bx', 'b', [0, 0], [40, 30, H]),
            boxFeature('sx', 'slot', [15, -5], [10, 40, 10], {
              plane: { kind: 'named', name: 'XY', offset: H - 5 },
            }),
          ],
        ),
      )
      const cutBlock = meshFor(slotted, 'root|b')
      const cutNames = cutBlock?.mesh.faceGroups.map((group) => group.name) ?? []
      add(
        'a negative body cuts the block it overlaps',
        slotted.errors.length === 0 &&
          Math.abs((cutBlock?.volume ?? 0) - (40 * 30 * H - 10 * 30 * 5)) < 0.5,
        slotted.errors.length ? errorText(slotted) : `${cutBlock?.volume.toFixed(1)} mm3`,
      )
      add(
        'faces split by a negative body keep the name of the face they came from',
        cutNames.filter((name) => name === 'bx:+z').length === 2 &&
          cutNames.filter((name) => name === '').length === 3 &&
          cutNames.every((name) => !name.startsWith('~')),
        cutNames.map((name) => name || '(none)').join(', '),
      )

      const blended = await evaluate(
        makeDocument(
          'rounded opening',
          [body('b', 'Block')],
          [
            boxFeature('bx', 'b', [0, 0], [40, 30, 20]),
            {
              id: 'fl',
              name: 'Round',
              componentId: 'root',
              kind: 'fillet',
              bodyId: 'b',
              radius: 2,
              edges: [{ bodyId: 'b', kind: 'edge', name: topEdge ?? 'none' }],
            },
            {
              id: 'sh',
              name: 'Hollow',
              componentId: 'root',
              kind: 'shell',
              bodyId: 'b',
              thickness: 1.5,
              openFaces: [{ bodyId: 'b', kind: 'face', name: 'bx:+z' }],
            },
          ],
        ),
      )
      const blendError = blended.errors.find((error) => error.featureId === 'sh')
      add(
        'hollowing through a face a fillet blends into says why it failed',
        !!blendError && blendError.message.includes('rounded edge'),
        blendError?.message ?? errorText(blended) ?? 'no error',
      )
    }

    {
      const block = makeDocument(
        'preview',
        [body('b', 'Block')],
        [boxFeature('bx', 'b', [0, 0], [40, 30, 20])],
      )
      const cutter = boxFeature('cx', 'b', [10, 10], [10, 10, 30], {
        plane: { kind: 'named', name: 'XY', offset: -5 },
        result: { kind: 'cut', bodyIds: ['b'] },
      })
      const first = await kernel.preview({ doc: block, features: [cutter], insertAt: 1 }, [])
      const second = await kernel.preview({ doc: block, features: [cutter], insertAt: 1 }, [])
      const toolsOf = (r: EvaluateResult) => r.instances.filter((i) => i.previewTool === 'cut')
      const cutVolume = meshFor(first, 'root|b')?.volume ?? 0
      add(
        'a cut preview shows the cut body and the tool that cuts it',
        first.errors.length === 0 &&
          Math.abs(cutVolume - (24000 - 2000)) < 0.5 &&
          toolsOf(first).length === 1 &&
          first.meshes.some((mesh) => mesh.key === toolsOf(first)[0].meshKey),
        `${cutVolume.toFixed(1)} mm3, ${toolsOf(first).length} tool(s)` +
          (first.errors.length ? ` (${errorText(first)})` : ''),
      )
      add(
        'previewing the same step twice still shows its tool',
        toolsOf(second).length === 1 && second.instances.every((i) => i.preview),
        `${toolsOf(second).length} tool(s)`,
      )
      const committed = await evaluate(block)
      add(
        'a preview does not change the next build',
        Math.abs((meshFor(committed, 'root|b')?.volume ?? 0) - 24000) < 0.5 &&
          committed.instances.every((i) => !i.preview && !i.previewTool),
        `${meshFor(committed, 'root|b')?.volume.toFixed(1)} mm3`,
      )
      const rounded = makeDocument(
        'edit preview',
        [body('b', 'Block')],
        [
          boxFeature('bx', 'b', [0, 0], [40, 30, 20]),
          {
            id: 'fl',
            name: 'Round',
            componentId: 'root',
            kind: 'fillet',
            bodyId: 'b',
            radius: 1,
            edges: [],
          },
        ],
      )
      const edited = await kernel.preview(
        {
          doc: rounded,
          features: [boxFeature('bx', 'b', [0, 0], [40, 30, 30])],
          insertAt: 0,
          replaceFeatureId: 'bx',
        },
        [],
      )
      add(
        'editing a step previews it with the steps after it rolled back',
        edited.errors.length === 0 &&
          Math.abs((meshFor(edited, 'root|b')?.volume ?? 0) - 36000) < 0.5,
        `${meshFor(edited, 'root|b')?.volume.toFixed(1)} mm3, expected 36000 with no rounding`,
      )
    }

    {
      const sketchOf = (build: (s: Sketch2D) => void): Sketch2D => {
        const s = emptySketch()
        build(s)
        return s
      }
      const halves = (radius: number) =>
        sketchOf((s) => {
          s.points.push(
            { id: 'c', x: 0, y: 0 },
            { id: 'a', x: -15, y: 0 },
            { id: 'b', x: 15, y: 0 },
          )
          s.entities.push(
            { id: 'ring', kind: 'circle', c: 'c', r: radius, construction: false },
            { id: 'cut', kind: 'line', p1: 'a', p2: 'b', construction: false },
          )
        })
      const keyWhere = (s: Sketch2D, test: (inside: [number, number]) => boolean) =>
        sketchRegions(s).regions.find((region) => test(region.inside))?.key ?? 'none'
      const profileDoc = (
        name: string,
        sketch: Sketch2D,
        operation:
          | { kind: 'extrude'; distance: number; profiles?: string[] }
          | { kind: 'revolve'; angle: number; profiles?: string[] },
      ) =>
        makeDocument(
          name,
          [body('pb', 'Profiled')],
          [
            {
              id: 'ps',
              name: 'Sketch',
              componentId: 'root',
              kind: 'sketch',
              plane: XY,
              sketch,
              visible: true,
            },
            operation.kind === 'extrude'
              ? {
                  id: 'pe',
                  name: 'Extrude',
                  componentId: 'root',
                  kind: 'extrude',
                  sketchId: 'ps',
                  ...(operation.profiles ? { profiles: operation.profiles } : {}),
                  distance: operation.distance,
                  symmetric: false,
                  reverse: false,
                  result: { kind: 'newBody', bodyId: 'pb' },
                }
              : {
                  id: 'pe',
                  name: 'Revolve',
                  componentId: 'root',
                  kind: 'revolve',
                  sketchId: 'ps',
                  ...(operation.profiles ? { profiles: operation.profiles } : {}),
                  angle: operation.angle,
                  axis: 'x',
                  result: { kind: 'newBody', bodyId: 'pb' },
                },
          ],
        )
      const volumeOf = (r: EvaluateResult) => meshFor(r, 'root|pb')?.volume ?? 0
      const sideNames = (r: EvaluateResult) =>
        (meshFor(r, 'root|pb')?.mesh.faceGroups ?? [])
          .map((group) => group.name)
          .filter((name) => name.includes(':side:'))
          .sort()

      const upper = halves(10)
      const top = await evaluate(
        profileDoc('half disc', upper, {
          kind: 'extrude',
          distance: 5,
          profiles: [keyWhere(upper, ([, y]) => y > 0)],
        }),
      )
      add(
        'extruding one half of a split circle makes a half cylinder',
        top.errors.length === 0 && Math.abs(volumeOf(top) - (Math.PI * 100 * 5) / 2) < 0.05,
        top.errors.length ? errorText(top) : `${volumeOf(top).toFixed(3)} mm3`,
      )
      const grown = halves(12)
      const topGrown = await evaluate(
        profileDoc('half disc grown', grown, {
          kind: 'extrude',
          distance: 5,
          profiles: [keyWhere(grown, ([, y]) => y > 0)],
        }),
      )
      add(
        'a split curve names its side faces by piece, and the names survive a resize',
        sideNames(top).length === 2 &&
          sideNames(top).every((name) => !name.includes('#')) &&
          sideNames(top).join(' ') === sideNames(topGrown).join(' '),
        `${sideNames(top).join(', ')} / ${sideNames(topGrown).join(', ')}`,
      )
      const both = await evaluate(
        profileDoc('both halves', upper, {
          kind: 'extrude',
          distance: 5,
          profiles: sketchRegions(upper).regions.map((region) => region.key),
        }),
      )
      add(
        'extruding both halves makes one whole cylinder',
        both.errors.length === 0 && Math.abs(volumeOf(both) - Math.PI * 100 * 5) < 0.05,
        both.errors.length ? errorText(both) : `${volumeOf(both).toFixed(3)} mm3`,
      )
      const ball = await evaluate(
        profileDoc('ball', upper, {
          kind: 'revolve',
          angle: 360,
          profiles: [keyWhere(upper, ([, y]) => y > 0)],
        }),
      )
      add(
        'revolving a half disc about its cut edge makes a ball',
        ball.errors.length === 0 && Math.abs(volumeOf(ball) - (4 / 3) * Math.PI * 1000) < 0.5,
        ball.errors.length ? errorText(ball) : `${volumeOf(ball).toFixed(2)} mm3`,
      )

      const plate = sketchOf((s) => {
        s.points.push(
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 40, y: 0 },
          { id: 'p3', x: 40, y: 30 },
          { id: 'p4', x: 0, y: 30 },
          { id: 'c', x: 20, y: 15 },
        )
        s.entities.push(
          { id: 'l1', kind: 'line', p1: 'p1', p2: 'p2', construction: false },
          { id: 'l2', kind: 'line', p1: 'p2', p2: 'p3', construction: false },
          { id: 'l3', kind: 'line', p1: 'p3', p2: 'p4', construction: false },
          { id: 'l4', kind: 'line', p1: 'p4', p2: 'p1', construction: false },
          { id: 'o', kind: 'circle', c: 'c', r: 5, construction: false },
        )
      })
      const washer = await evaluate(profileDoc('washer', plate, { kind: 'extrude', distance: 4 }))
      add(
        'a sketch extruded without picked profiles keeps the hole in its plate',
        washer.errors.length === 0 && Math.abs(volumeOf(washer) - (1200 - Math.PI * 25) * 4) < 0.05,
        washer.errors.length ? errorText(washer) : `${volumeOf(washer).toFixed(3)} mm3`,
      )
      const plug = await evaluate(
        profileDoc('plug', plate, {
          kind: 'extrude',
          distance: 4,
          profiles: [keyWhere(plate, ([x, y]) => Math.hypot(x - 20, y - 15) < 5)],
        }),
      )
      add(
        'picking only the disc in the hole extrudes a plug',
        plug.errors.length === 0 && Math.abs(volumeOf(plug) - Math.PI * 25 * 4) < 0.05,
        plug.errors.length ? errorText(plug) : `${volumeOf(plug).toFixed(3)} mm3`,
      )

      const oval = sketchOf((s) => {
        s.points.push({ id: 'c', x: 0, y: 0 }, { id: 'a', x: 0, y: -30 }, { id: 'b', x: 0, y: 30 })
        s.entities.push(
          { id: 'e', kind: 'ellipse', c: 'c', rx: 20, ry: 10, rotation: 30, construction: false },
          { id: 'v', kind: 'line', p1: 'a', p2: 'b', construction: false },
        )
      })
      const halfOval = await evaluate(
        profileDoc('half oval', oval, {
          kind: 'extrude',
          distance: 2,
          profiles: [keyWhere(oval, ([x]) => x > 0)],
        }),
      )
      add(
        'half of a tilted ellipse extrudes from an exact elliptical arc',
        halfOval.errors.length === 0 && Math.abs(volumeOf(halfOval) - Math.PI * 200) < 0.01,
        halfOval.errors.length ? errorText(halfOval) : `${volumeOf(halfOval).toFixed(4)} mm3`,
      )
      const tall = sketchOf((s) => {
        s.points.push({ id: 'c', x: 0, y: 0 }, { id: 'a', x: -30, y: 0 }, { id: 'b', x: 30, y: 0 })
        s.entities.push(
          { id: 'e', kind: 'ellipse', c: 'c', rx: 8, ry: 16, rotation: 0, construction: false },
          { id: 'h', kind: 'line', p1: 'a', p2: 'b', construction: false },
        )
      })
      const tallHalf = await evaluate(
        profileDoc('tall half', tall, {
          kind: 'extrude',
          distance: 1,
          profiles: [keyWhere(tall, ([, y]) => y > 0)],
        }),
      )
      add(
        'an ellipse taller than it is wide splits at the right place',
        tallHalf.errors.length === 0 &&
          Math.abs(volumeOf(tallHalf) - (Math.PI * 8 * 16) / 2) < 0.01,
        tallHalf.errors.length ? errorText(tallHalf) : `${volumeOf(tallHalf).toFixed(4)} mm3`,
      )

      const sail = sketchOf((s) => {
        s.points.push(
          { id: 's1', x: 0, y: 0 },
          { id: 's2', x: 40, y: 0 },
          { id: 's3', x: 30, y: 15 },
          { id: 's4', x: 10, y: 18 },
          { id: 'm1', x: 20, y: -5 },
          { id: 'm2', x: 20, y: 40 },
        )
        s.entities.push(
          { id: 'base', kind: 'line', p1: 's1', p2: 's2', construction: false },
          {
            id: 'curve',
            kind: 'spline',
            mode: 'fit',
            points: ['s2', 's3', 's4', 's1'],
            construction: false,
          },
          { id: 'mast', kind: 'line', p1: 'm1', p2: 'm2', construction: false },
        )
      })
      const sailRegion = sketchRegions(sail).regions.find((region) => region.inside[0] > 20)
      const halfSail = await evaluate(
        profileDoc('half sail', sail, {
          kind: 'extrude',
          distance: 3,
          profiles: [sailRegion?.key ?? 'none'],
        }),
      )
      add(
        'a spline cut by a line extrudes the piece on one side exactly',
        halfSail.errors.length === 0 &&
          !!sailRegion &&
          Math.abs(volumeOf(halfSail) - sailRegion.area * 3) < 1e-3 * sailRegion.area,
        halfSail.errors.length
          ? errorText(halfSail)
          : `${volumeOf(halfSail).toFixed(3)} mm3, region ${((sailRegion?.area ?? 0) * 3).toFixed(3)}`,
      )

      const lost = await evaluate(
        profileDoc('lost', upper, { kind: 'extrude', distance: 5, profiles: ['nothing[here]+'] }),
      )
      add(
        'a profile that no longer exists fails the step with a reason',
        lost.errors.some((error) => error.featureId === 'pe' && error.message.includes('gone')),
        errorText(lost) || 'no error',
      )
    }
  } catch (e) {
    add('kernel test ran', false, `${(e as Error).message}\n${(e as Error).stack ?? ''}`)
  }

  return out
}
