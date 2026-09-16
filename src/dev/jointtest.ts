import type { Vec3 } from '../core/math'
import {
  identityMatrix,
  invertRigidMatrix,
  multiplyMatrices,
  rotationMatrix,
  transformPoint,
  translationMatrix,
} from '../doc/model'
import { emptyDocument, type Matrix4 } from '../doc/types'
import { assemblyInputFromDocument, occurrenceUpdatesFromSolve } from '../assembly/document'
import { frameDistance } from '../assembly/frames'
import {
  applySolveResult,
  createAsBuiltJoint,
  measureJointValues,
  releaseDrag,
  solveAssembly,
  withMeasuredValues,
} from '../assembly/solve'
import type {
  AssemblyOccurrence,
  AssemblySolveInput,
  AssemblySolveResult,
  Joint,
  JointAnchor,
  JointMotion,
  MotionLink,
} from '../assembly/types'
import type { TestResult } from './selftest'

export function runJointTest(): TestResult[] {
  const results: TestResult[] = []
  let current = ''
  const check = (pass: boolean, detail: string) =>
    results.push({ name: `Joints: ${current}`, pass, detail })
  const test = (name: string, body: () => void) => {
    current = name
    try {
      body()
    } catch (error) {
      check(false, `threw: ${(error as Error).stack ?? String(error)}`)
    }
  }
  const show = (value: number) => Number(value.toFixed(6)).toString()
  const showPoint = (point: Vec3) => `[${point.map(show).join(', ')}]`
  const near = (actual: number, expected: number, label: string, tolerance = 1e-6) =>
    check(
      Math.abs(actual - expected) <= tolerance,
      `${label}: ${show(actual)} against ${show(expected)}`,
    )
  const nearPoint = (actual: Vec3, expected: Vec3, label: string, tolerance = 1e-6) =>
    check(
      Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]) <=
        tolerance,
      `${label}: ${showPoint(actual)} against ${showPoint(expected)}`,
    )
  const sameFrame = (a: Matrix4, b: Matrix4, label: string, tolerance = 1e-9) => {
    const distance = frameDistance(a, b)
    check(
      distance.translation <= tolerance && distance.angle <= tolerance,
      `${label}: off by ${distance.translation.toExponential(2)} mm and ${distance.angle.toExponential(2)} rad`,
    )
  }

  const T = (x: number, y: number, z: number) => translationMatrix([x, y, z])
  const R = rotationMatrix
  const M = (...matrices: Matrix4[]) =>
    matrices.reduce((product, matrix) => multiplyMatrices(product, matrix), identityMatrix())
  const occurrence = (
    id: string,
    transform: Matrix4 = identityMatrix(),
    grounded = false,
  ): AssemblyOccurrence => ({ path: [id], transform, grounded })
  const at = (id: string, frame: Matrix4 = identityMatrix()): JointAnchor => ({
    kind: 'geometry',
    occurrencePath: [id],
    frame,
    snap: null,
  })
  const joint = (
    id: string,
    one: JointAnchor,
    two: JointAnchor,
    motion: JointMotion,
    extra: Partial<Joint> = {},
  ): Joint => ({
    id,
    name: id,
    one,
    two,
    motion,
    flip: false,
    angle: 0,
    offset: 0,
    values: [],
    limits: [],
    ...extra,
  })
  const pointOf = (result: AssemblySolveResult, id: string, local: Vec3) =>
    transformPoint(result.transforms[id], local)
  const originOf = (matrix: Matrix4): Vec3 => [matrix[12], matrix[13], matrix[14]]
  const turnOf = (matrix: Matrix4) => (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI
  const angleGap = (a: number, b: number) => Math.abs(((((a - b + 540) % 360) + 360) % 360) - 180)
  const revolute: JointMotion = { kind: 'revolute', axis: 'z' }

  test('a revolute hinge turns a door 90 degrees about its axis', () => {
    const input: AssemblySolveInput = {
      occurrences: [occurrence('frame', identityMatrix(), true), occurrence('door', T(5, 3, 0))],
      joints: [joint('hinge', at('door'), at('frame', T(100, 50, 0)), revolute)],
    }
    const shut = solveAssembly(input)
    nearPoint(pointOf(shut, 'door', [800, 0, 1000]), [900, 50, 1000], 'shut, the door runs along x')
    const open = solveAssembly(input, { drive: [{ jointId: 'hinge', value: 90 }] })
    nearPoint(
      pointOf(open, 'door', [800, 0, 1000]),
      [100, 850, 1000],
      'open, its far edge is at +y',
    )
    nearPoint(pointOf(open, 'door', [0, 0, 500]), [100, 50, 500], 'a point on the hinge axis stays')
    near(open.jointValues.hinge[0], 90, 'reported angle')
    check(
      open.freedom.door.dof === 1 && open.freedom.door.rotations === 1,
      `the door keeps one rotation (${JSON.stringify(open.freedom.door)})`,
    )
    check(
      open.freedom.frame.dof === 0 && !open.moved.includes('frame'),
      'the grounded frame neither moves nor has freedom',
    )

    const upright = solveAssembly(
      {
        occurrences: [occurrence('frame', identityMatrix(), true), occurrence('door')],
        joints: [joint('hinge', at('door', R('x', -90)), at('frame', R('x', -90)), revolute)],
      },
      { drive: [{ jointId: 'hinge', value: 90 }] },
    )
    nearPoint(pointOf(upright, 'door', [800, 0, 0]), [0, 0, -800], 'a world-Y hinge swings x to -z')
    nearPoint(pointOf(upright, 'door', [0, 300, 0]), [0, 300, 0], 'and leaves its own axis alone')

    const sideways = solveAssembly(
      {
        occurrences: [occurrence('frame', identityMatrix(), true), occurrence('door')],
        joints: [joint('hinge', at('door'), at('frame'), { kind: 'revolute', axis: 'x' })],
      },
      { drive: [{ jointId: 'hinge', value: 90 }] },
    )
    nearPoint(
      pointOf(sideways, 'door', [0, 800, 0]),
      [0, 0, 800],
      'an x-axis revolute turns y to z',
    )
  })

  test('a slider moves along its axis and stops at its limits', () => {
    const along = R('y', 90)
    const input: AssemblySolveInput = {
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('carriage', T(0, 20, 0)),
      ],
      joints: [
        joint(
          'rail',
          at('carriage', along),
          at('base', along),
          { kind: 'slider', axis: 'z' },
          {
            limits: [{ min: 0, max: 50 }],
          },
        ),
      ],
    }
    const middle = solveAssembly(input, { drive: [{ jointId: 'rail', value: 30 }] })
    nearPoint(originOf(middle.transforms.carriage), [30, 0, 0], 'driven to 30 mm')
    const past = solveAssembly(input, { drive: [{ jointId: 'rail', value: 80 }] })
    near(past.jointValues.rail[0], 50, 'driven to 80 it stops at the 50 mm limit')
    nearPoint(originOf(past.transforms.carriage), [50, 0, 0], 'and sits at the limit')
    const before = solveAssembly(input, { drive: [{ jointId: 'rail', value: -10 }] })
    near(before.jointValues.rail[0], 0, 'driven to -10 it stops at the 0 mm limit')
    check(
      middle.freedom.carriage.dof === 1 && middle.freedom.carriage.translations === 1,
      `one translation left (${JSON.stringify(middle.freedom.carriage)})`,
    )
  })

  test('cylindrical, pin-slot, planar and ball joints move only in their freedoms', () => {
    const cases: Array<{
      label: string
      motion: JointMotion
      target: Matrix4
      values: number[]
      dof: number
      rotations: number
    }> = [
      {
        label: 'cylindrical',
        motion: { kind: 'cylindrical', axis: 'z' },
        target: M(T(5, 0, 20), R('z', 30)),
        values: [30, 20],
        dof: 2,
        rotations: 1,
      },
      {
        label: 'pin-slot',
        motion: { kind: 'pinSlot', axis: 'z', slide: 'x' },
        target: M(T(15, 7, 3), R('z', 40)),
        values: [40, 15],
        dof: 2,
        rotations: 1,
      },
      {
        label: 'planar',
        motion: { kind: 'planar', normal: 'z' },
        target: M(T(12, -8, 6), R('z', 25), R('x', 10)),
        values: [12, -8, 25],
        dof: 3,
        rotations: 1,
      },
      {
        label: 'ball',
        motion: { kind: 'ball' },
        target: M(T(9, -4, 11), R('z', 35), R('y', 20), R('x', -15)),
        values: [20, 35, -15],
        dof: 3,
        rotations: 3,
      },
    ]
    for (const item of cases) {
      const input: AssemblySolveInput = {
        occurrences: [occurrence('base', identityMatrix(), true), occurrence('part')],
        joints: [joint('j', at('part'), at('base'), item.motion)],
      }
      const dragged = solveAssembly(input, {
        drag: { kind: 'pose', path: ['part'], target: item.target },
      })
      const measured = measureJointValues(applySolveResult(input, dragged)).j
      check(
        measured.translationError < 1e-9 && measured.angleError < 1e-9,
        `${item.label} stays exactly on its joint (${measured.translationError.toExponential(2)} mm, ${measured.angleError.toExponential(2)} rad)`,
      )
      check(
        item.values.every((value, index) => Math.abs(measured.values[index] - value) < 1e-6),
        `${item.label} follows the drag in its free directions: [${measured.values.map(show).join(', ')}] against [${item.values.join(', ')}]`,
      )
      check(
        dragged.freedom.part.dof === item.dof && dragged.freedom.part.rotations === item.rotations,
        `${item.label} reports ${item.dof} freedoms, ${item.rotations} of them rotations (${JSON.stringify(dragged.freedom.part)})`,
      )
      const released = releaseDrag(input, dragged)
      sameFrame(
        released.transforms.part,
        dragged.transforms.part,
        `${item.label} stays put on release`,
      )
    }
  })

  test('a grounded part never moves', () => {
    const groundPose = M(T(10, 20, 30), R('z', 15))
    const input: AssemblySolveInput = {
      occurrences: [
        occurrence('fixed', groundPose, true),
        occurrence('loose', T(-40, 5, 0)),
        occurrence('free', T(7, 7, 7)),
      ],
      joints: [joint('mate', at('fixed', T(0, 0, 5)), at('loose', T(3, 0, 0)), { kind: 'rigid' })],
    }
    const solved = solveAssembly(input)
    sameFrame(solved.transforms.fixed, groundPose, 'grounded, it holds even as the moving side')
    sameFrame(
      M(solved.transforms.fixed, T(0, 0, 5)),
      M(solved.transforms.loose, T(3, 0, 0)),
      'the loose part came to it instead',
    )
    const settled = applySolveResult(input, solved)
    const pulled = solveAssembly(settled, {
      drag: { kind: 'pose', path: ['fixed'], target: T(100, 0, 0) },
    })
    sameFrame(pulled.transforms.fixed, groundPose, 'dragging the grounded part does nothing')
    sameFrame(pulled.transforms.loose, solved.transforms.loose, 'and its rigid partner stays too')
    check(
      pulled.freedom.fixed.dof === 0 && pulled.freedom.loose.dof === 0,
      'neither has any freedom left',
    )
    check(
      pulled.freedom.free.dof === 6 && pulled.freedom.free.rotations === 3,
      `an unjointed, ungrounded part is free in all six (${JSON.stringify(pulled.freedom.free)})`,
    )
  })

  test('a rigid group moves as one', () => {
    const input: AssemblySolveInput = {
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('arm'),
        occurrence('bracket', M(T(50, 0, 0), R('z', 10))),
      ],
      rigidGroups: [{ id: 'g', name: 'Group', members: [['arm'], ['bracket']] }],
      joints: [joint('pivot', at('arm'), at('base'), revolute)],
    }
    const turned = solveAssembly(input, { drive: [{ jointId: 'pivot', value: 45 }] })
    sameFrame(
      M(invertRigidMatrix(turned.transforms.arm), turned.transforms.bracket),
      M(T(50, 0, 0), R('z', 10)),
      'the bracket keeps its place on the arm',
    )
    nearPoint(
      originOf(turned.transforms.bracket),
      [50 * Math.SQRT1_2, 50 * Math.SQRT1_2, 0],
      'and swings round the pivot with it',
    )
    check(turned.freedom.bracket.dof === 1, 'the bracket inherits the one rotation')
    const dragged = solveAssembly(input, {
      drag: { kind: 'pose', path: ['bracket'], target: M(R('z', -30), T(50, 0, 0), R('z', 10)) },
    })
    near(dragged.jointValues.pivot[0], -30, 'dragging the bracket turns the arm')
    sameFrame(dragged.transforms.arm, R('z', -30), 'the arm went with it')
  })

  const crank = 10
  const coupler = 35
  const rocker = 25
  const span = 40
  const fourBar = (crankAngle: number) => {
    const t2 = (crankAngle * Math.PI) / 180
    const a: Vec3 = [crank * Math.cos(t2), crank * Math.sin(t2), 0]
    const d = [span - a[0], -a[1]]
    const distance = Math.hypot(d[0], d[1])
    const u = [d[0] / distance, d[1] / distance]
    const along = (coupler * coupler - rocker * rocker + distance * distance) / (2 * distance)
    const h = Math.sqrt(coupler * coupler - along * along)
    const b = [a[0] + along * u[0] - h * u[1], a[1] + along * u[1] + h * u[0]]
    const t3 = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
    const t4 = (Math.atan2(b[1], b[0] - span) * 180) / Math.PI
    return { t3, t4 }
  }
  const fourBarInput = (crankAngle: number, error: number): AssemblySolveInput => {
    const { t3, t4 } = fourBar(crankAngle)
    return {
      occurrences: [
        occurrence('ground', identityMatrix(), true),
        occurrence('crank'),
        occurrence('coupler'),
        occurrence('rocker'),
      ],
      joints: [
        joint('j1', at('crank'), at('ground'), revolute, { values: [crankAngle] }),
        joint('j2', at('coupler'), at('crank', T(crank, 0, 0)), revolute, {
          values: [t3 - crankAngle + error],
        }),
        joint('j3', at('rocker', T(rocker, 0, 0)), at('coupler', T(coupler, 0, 0)), revolute, {
          values: [t4 - t3 - error],
        }),
        joint('j4', at('rocker'), at('ground', T(span, 0, 0)), revolute, {
          values: [t4 + error],
        }),
      ],
    }
  }
  const loopGap = (result: AssemblySolveResult) => {
    const a = pointOf(result, 'coupler', [coupler, 0, 0])
    const b = pointOf(result, 'rocker', [rocker, 0, 0])
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }

  test('a four-bar linkage closes its loop at every crank angle', () => {
    let input = fourBarInput(30, 4)
    let closed = solveAssembly(input, { drive: [{ jointId: 'j1', value: 30 }] })
    for (const angle of [30, 75, 140, 210, 290, 355]) {
      closed = solveAssembly(input, { drive: [{ jointId: 'j1', value: angle }] })
      input = applySolveResult(input, closed)
      const expected = fourBar(angle).t4
      const gap = loopGap(closed)
      check(
        gap < 1e-9 && closed.conflicts.length === 0,
        `crank ${angle}: loop closes to ${gap.toExponential(2)} mm with no conflicts`,
      )
      check(
        angleGap(turnOf(closed.transforms.rocker), expected) < 1e-6,
        `crank ${angle}: rocker at ${show(turnOf(closed.transforms.rocker))} degrees against ${show(expected)}`,
      )
    }
    const jumped = solveAssembly(
      applySolveResult(fourBarInput(30, 0), solveAssembly(fourBarInput(30, 0))),
      {
        drive: [{ jointId: 'j1', value: 250 }],
      },
    )
    check(
      angleGap(turnOf(jumped.transforms.rocker), fourBar(250).t4) < 1e-6 && loopGap(jumped) < 1e-9,
      `a single jump from 30 to 250 degrees stays on the same branch (${show(turnOf(jumped.transforms.rocker))} against ${show(fourBar(250).t4)})`,
    )
    check(
      closed.freedom.crank.dof === 1 &&
        closed.freedom.coupler.dof === 1 &&
        closed.freedom.rocker.dof === 1 &&
        closed.mechanismDof === 1,
      `one freedom for the whole linkage (crank ${closed.freedom.crank.dof}, coupler ${closed.freedom.coupler.dof}, rocker ${closed.freedom.rocker.dof}, mechanism ${closed.mechanismDof})`,
    )
    sameFrame(closed.transforms.ground, identityMatrix(), 'the ground link never moved')
  })

  test('motion links drive gears at ratio 2 and a rack and pinion', () => {
    const mesh: MotionLink = {
      id: 'mesh',
      name: 'Mesh',
      a: { jointId: 'ja', dof: 0 },
      b: { jointId: 'jb', dof: 0 },
      ratio: 2,
      offset: 0,
    }
    const gears: AssemblySolveInput = {
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('small'),
        occurrence('large'),
      ],
      joints: [
        joint('ja', at('small'), at('base'), revolute),
        joint('jb', at('large'), at('base', T(30, 0, 0)), revolute),
      ],
      motionLinks: [mesh],
    }
    const driven = solveAssembly(gears, { drive: [{ jointId: 'ja', value: 30 }] })
    near(driven.jointValues.jb[0], 60, 'turning the first gear 30 degrees turns the second 60')
    near(turnOf(driven.transforms.large), 60, 'and the second gear is drawn at 60')
    const back = solveAssembly(gears, { drive: [{ jointId: 'jb', value: 50 }] })
    near(back.jointValues.ja[0], 25, 'driving the second gear to 50 turns the first to 25')
    check(
      driven.freedom.small.dof === 1 && driven.freedom.large.dof === 1 && driven.mechanismDof === 1,
      `each gear turns but the pair shares one freedom (mechanism ${driven.mechanismDof})`,
    )

    const perDegree = (2 * Math.PI * 10) / 360
    const rack: AssemblySolveInput = {
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('pinion'),
        occurrence('rack'),
      ],
      joints: [
        joint('spin', at('pinion'), at('base'), revolute),
        joint('run', at('rack'), at('base', T(0, 10, 0)), { kind: 'slider', axis: 'x' }),
      ],
      motionLinks: [
        {
          id: 'teeth',
          name: 'Teeth',
          a: { jointId: 'spin', dof: 0 },
          b: { jointId: 'run', dof: 0 },
          ratio: perDegree,
          offset: 0,
        },
      ],
    }
    const quarter = solveAssembly(rack, { drive: [{ jointId: 'spin', value: 90 }] })
    near(
      quarter.jointValues.run[0],
      Math.PI * 5,
      'a quarter turn of a 10 mm pinion runs the rack 15.708 mm',
    )
    nearPoint(
      originOf(quarter.transforms.rack),
      [Math.PI * 5, 10, 0],
      'and the rack is drawn there',
    )
    const half = solveAssembly(rack, { drive: [{ jointId: 'run', value: Math.PI * 10 }] })
    near(half.jointValues.spin[0], 180, 'pushing the rack 31.416 mm turns the pinion half a turn')
  })

  test('as-built values reproduce the current placement', () => {
    const chain = (values: Record<string, number[]>): AssemblySolveInput => ({
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('arm', T(3, 3, 3)),
        occurrence('carriage'),
        occurrence('head'),
        occurrence('pad'),
      ],
      joints: [
        joint('shoulder', at('arm'), at('base', T(0, 0, 5)), revolute, {
          values: values.shoulder ?? [],
        }),
        joint(
          'track',
          at('carriage', R('y', 90)),
          at('arm', M(T(20, 0, 0), R('y', 90))),
          {
            kind: 'slider',
            axis: 'z',
          },
          { values: values.track ?? [] },
        ),
        joint(
          'wrist',
          at('head'),
          at('carriage', T(0, 0, 15)),
          { kind: 'ball' },
          {
            flip: true,
            angle: 30,
            offset: 4,
            values: values.wrist ?? [],
          },
        ),
        joint(
          'palm',
          at('pad', T(2, 1, 0)),
          at('head', T(0, 6, 0)),
          { kind: 'planar', normal: 'z' },
          {
            angle: -20,
            values: values.palm ?? [],
          },
        ),
      ],
    })
    const expected: Record<string, number[]> = {
      shoulder: [35],
      track: [12],
      wrist: [10, -25, 40],
      palm: [3, -6, 70],
    }
    const exact = solveAssembly(chain(expected))
    const placed = applySolveResult(chain({}), exact)
    const measured = measureJointValues(placed)
    for (const [id, values] of Object.entries(expected)) {
      check(
        values.every((value, index) => Math.abs(measured[id].values[index] - value) < 1e-6),
        `${id} reads back [${measured[id].values.map(show).join(', ')}] against [${values.join(', ')}]`,
      )
      check(
        measured[id].translationError < 1e-9 && measured[id].angleError < 1e-9,
        `${id} placement is exactly representable by its motion`,
      )
    }
    const rebuilt = solveAssembly(withMeasuredValues(placed))
    check(
      rebuilt.moved.length === 0,
      `re-solving at those values moves nothing (${rebuilt.moved.join(', ') || 'none'})`,
    )

    const scattered: AssemblySolveInput = {
      occurrences: [
        occurrence('stand', M(T(5, 5, 0), R('z', 20)), true),
        occurrence('lever', M(T(40, -10, 7), R('x', 30))),
      ],
    }
    const hinge = createAsBuiltJoint(scattered, {
      id: 'built',
      name: 'Built',
      one: ['lever'],
      two: ['stand'],
      motion: revolute,
      worldFrame: M(T(20, 0, 7), R('y', 90)),
    })
    check(!!hinge, 'an as-built joint is created where the parts already are')
    if (!hinge) return
    const withHinge: AssemblySolveInput = { ...scattered, asBuiltJoints: [hinge] }
    near(measureJointValues(withHinge).built.values[0], 0, 'it starts at zero')
    check(solveAssembly(withHinge).moved.length === 0, 'and solving it moves nothing')
    const swung = solveAssembly(withHinge, { drive: [{ jointId: 'built', value: 90 }] })
    const start = transformPoint(scattered.occurrences[1].transform, [0, 12, 0])
    const expectedPoint = transformPoint(M(T(20, 0, 7), R('x', 90), T(-20, 0, -7)), start)
    nearPoint(
      pointOf(swung, 'lever', [0, 12, 0]),
      expectedPoint,
      'driving it turns the lever about the picked axis',
    )
  })

  test('a drag follows in free directions and is refused in constrained ones', () => {
    const along = R('y', 90)
    const slider: AssemblySolveInput = {
      occurrences: [occurrence('base', identityMatrix(), true), occurrence('carriage')],
      joints: [
        joint('rail', at('carriage', along), at('base', along), { kind: 'slider', axis: 'z' }),
      ],
    }
    const slid = solveAssembly(slider, {
      drag: { kind: 'pose', path: ['carriage'], target: T(30, 12, -7) },
    })
    nearPoint(
      originOf(slid.transforms.carriage),
      [30, 0, 0],
      'the carriage follows along the rail only',
      1e-9,
    )
    check(
      Math.abs(slid.transforms.carriage[13]) === 0 &&
        Math.abs(slid.transforms.carriage[14]) < 1e-12,
      'sideways and up are refused outright',
    )

    const linkage = applySolveResult(fourBarInput(30, 0), solveAssembly(fourBarInput(30, 0)))
    const grab: Vec3 = [17.5, 6, 0]
    const start = transformPoint(solveAssembly(linkage).transforms.coupler, grab)
    const target: Vec3 = [start[0] - 3, start[1] + 4, start[2] + 20]
    const dragged = solveAssembly(linkage, {
      drag: { kind: 'point', path: ['coupler'], point: grab, target },
    })
    const reached = pointOf(dragged, 'coupler', grab)
    const planeGap = Math.hypot(reached[0] - target[0], reached[1] - target[1])
    check(
      planeGap < 4,
      `the coupler moves towards the cursor within the plane (${show(planeGap)} mm from 5)`,
    )
    check(
      Math.abs(reached[2]) < 1e-9,
      `and refuses to leave the plane (z ${reached[2].toExponential(2)})`,
    )
    check(
      loopGap(dragged) < 1e-3 && dragged.conflicts.length === 0,
      `while dragging the loop stays closed to ${loopGap(dragged).toExponential(2)} mm`,
    )
    check(
      Math.abs(dragged.jointValues.j1[0] - 30) > 1,
      `the crank turned to ${show(dragged.jointValues.j1[0])}`,
    )
    sameFrame(dragged.transforms.ground, identityMatrix(), 'the ground link held')
    const released = releaseDrag(linkage, dragged)
    check(
      loopGap(released) < 1e-9 && released.conflicts.length === 0,
      `on release the loop closes exactly (${loopGap(released).toExponential(2)} mm)`,
    )
    nearPoint(
      pointOf(released, 'coupler', grab),
      reached,
      'and the linkage stays where it was dropped',
      1e-3,
    )
  })

  test('conflicting joints are reported', () => {
    const plate = (extra: Joint): AssemblySolveInput => ({
      occurrences: [occurrence('base', identityMatrix(), true), occurrence('plate')],
      joints: [joint('hingeA', at('plate'), at('base'), revolute), extra],
    })
    const clash = solveAssembly(
      plate(joint('hingeB', at('plate', T(10, 0, 0)), at('base', T(20, 0, 0)), revolute)),
    )
    check(
      !clash.converged &&
        clash.conflictingJoints.includes('hingeA') &&
        clash.conflictingJoints.includes('hingeB'),
      `two hinges on different axes conflict (${clash.conflictingJoints.join(', ') || 'none reported'})`,
    )
    const redundant = solveAssembly(
      plate(joint('hingeC', at('plate', T(0, 0, 5)), at('base', T(0, 0, 5)), revolute)),
    )
    check(
      redundant.converged && redundant.freedom.plate.dof === 1,
      `two hinges on the same axis agree and leave one freedom (${redundant.freedom.plate.dof})`,
    )
    const welded = solveAssembly({
      occurrences: [
        occurrence('left', identityMatrix(), true),
        occurrence('right', T(5, 0, 0), true),
      ],
      joints: [joint('weld', at('left'), at('right'), { kind: 'rigid' })],
    })
    check(
      welded.conflicts.some((conflict) => conflict.id === 'weld') && !welded.moved.length,
      `a rigid joint between two grounded parts that do not meet is reported (${welded.conflictingJoints.join(', ')}) and nothing moves`,
    )
    const gears: AssemblySolveInput = {
      occurrences: [
        occurrence('base', identityMatrix(), true),
        occurrence('small'),
        occurrence('large'),
      ],
      joints: [
        joint('ja', at('small'), at('base'), revolute),
        joint('jb', at('large'), at('base', T(30, 0, 0)), revolute),
      ],
      motionLinks: [
        {
          id: 'mesh',
          name: 'Mesh',
          a: { jointId: 'ja', dof: 0 },
          b: { jointId: 'jb', dof: 0 },
          ratio: 2,
          offset: 0,
        },
      ],
    }
    const forced = solveAssembly(gears, {
      drive: [
        { jointId: 'ja', value: 30 },
        { jointId: 'jb', value: 30 },
      ],
    })
    check(
      forced.conflicts.some(
        (conflict) => conflict.source === 'motionLink' && conflict.id === 'mesh',
      ),
      'driving both linked gears against the ratio reports the link',
    )
  })

  test('rest values, locked joints and named joint origins', () => {
    const along = R('y', 90)
    const rail = joint(
      'rail',
      at('carriage', along),
      { kind: 'origin', originId: 'start' },
      { kind: 'slider', axis: 'z' },
      { limits: [{ min: 0, max: 60, rest: 10 }] },
    )
    const input: AssemblySolveInput = {
      occurrences: [occurrence('base', identityMatrix(), true), occurrence('carriage')],
      origins: [
        { id: 'start', name: 'Rail start', occurrencePath: ['base'], frame: along, snap: null },
      ],
      joints: [rail],
    }
    const dragged = solveAssembly(input, {
      drag: { kind: 'pose', path: ['carriage'], target: T(40, 0, 0) },
    })
    near(dragged.jointValues.rail[0], 40, 'dragged to 40 mm along a named joint origin')
    const released = releaseDrag(input, dragged)
    near(released.jointValues.rail[0], 10, 'on release it returns to its rest value')
    nearPoint(originOf(released.transforms.carriage), [10, 0, 0], 'and is drawn there')

    const locked = solveAssembly(
      { ...input, joints: [{ ...rail, locked: true, values: [25] }] },
      {
        drive: [{ jointId: 'rail', value: 50 }],
        drag: { kind: 'pose', path: ['carriage'], target: T(55, 0, 0) },
      },
    )
    near(locked.jointValues.rail[0], 25, 'a locked joint ignores both a drive and a drag')
    check(
      locked.issues.some((issue) => issue.id === 'rail') && locked.freedom.carriage.dof === 0,
      `the drive is refused with a reason and nothing is free (${locked.issues.map((issue) => issue.message).join(' ')})`,
    )

    const broken = solveAssembly({
      ...input,
      origins: [],
    })
    check(
      broken.issues.some((issue) => issue.id === 'rail' && /start/.test(issue.message)) &&
        broken.freedom.carriage.dof === 6,
      `a joint whose origin is missing is reported and left out (${broken.issues.map((issue) => issue.message).join(' ')})`,
    )
  })

  test('the document adapter keeps nested occurrences with their parent', () => {
    const doc = emptyDocument('Joints')
    doc.components.push(
      { id: 'arm', name: 'Arm', source: { kind: 'design' }, bodies: [] },
      { id: 'screw', name: 'Screw', source: { kind: 'design' }, bodies: [] },
    )
    doc.occurrences.push(
      {
        id: 'a1',
        parentComponentId: 'root',
        componentId: 'arm',
        name: 'Arm 1',
        transform: identityMatrix(),
        visible: true,
        grounded: false,
      },
      {
        id: 's1',
        parentComponentId: 'arm',
        componentId: 'screw',
        name: 'Screw',
        transform: T(30, 0, 0),
        visible: true,
        grounded: false,
      },
    )
    const input = assemblyInputFromDocument(doc, {
      joints: [
        joint(
          'pivot',
          at('a1'),
          { kind: 'geometry', occurrencePath: [], frame: T(5, 5, 0), snap: null },
          revolute,
          { values: [90] },
        ),
      ],
    })
    const solved = solveAssembly(input)
    nearPoint(
      originOf(solved.transforms['a1/s1']),
      [5, 35, 0],
      'the screw inside the arm swings round with it',
    )
    check(
      solved.freedom['a1/s1']?.dof === 1 && solved.freedom.root?.dof === 0,
      'it shares the arm freedom while the root component stays fixed',
    )
    const updates = occurrenceUpdatesFromSolve(doc, solved)
    sameFrame(
      updates.transforms.a1 ?? identityMatrix(),
      M(T(5, 5, 0), R('z', 90)),
      'the arm occurrence gets its new placement',
    )
    check(
      !('s1' in updates.transforms) && updates.divergent.length === 0,
      'the screw keeps its placement inside the arm definition',
    )
  })

  return results
}
