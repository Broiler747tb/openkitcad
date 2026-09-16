import type { Vec3 } from '../core/math'
import { refreshJointFrames } from '../assembly/follow'
import { poseStudy, studyDrives, trackValue } from '../assembly/study'
import { applyAssemblyResult, originFrame, solveDocument } from '../assembly/fromDocument'
import { columnOf, dot, originOf } from '../assembly/frames'
import { edgeSnap, faceSnap, frameAt, snapFromMesh } from '../assembly/snaps'
import {
  findFeature,
  findOccurrence,
  identityMatrix,
  multiplyMatrices,
  pathMatrix,
  rotationMatrix,
  translationMatrix,
} from '../doc/model'
import {
  deleteFeatures,
  dependentClosure,
  insertFeatures,
  placedInstances,
  removeOccurrencesFromDocument,
  replaceFeatureInDocument,
} from '../doc/store'
import {
  emptyDocument,
  type Feature,
  type JointFeature,
  type JointOriginFeature,
  type JointSide,
  type Matrix4,
  type OkcDocument,
} from '../doc/types'
import type { BodyMesh, Instance } from '../kernel/types'
import { featurePick, jointSnapPick, occurrencePick } from '../ui/command/picks'
import {
  driveJointsCommand,
  jointCommand,
  jointOriginCommand,
  motionLinkCommand,
  rigidGroupCommand,
} from '../ui/command/specs/assemble'
import { createCommandState, evaluateCommand } from '../ui/command/state'
import type {
  AnyCommandSpec,
  CommandContext,
  CommandInitialValues,
  LooseCommandValues,
} from '../ui/command/types'
import type { TestResult } from './selftest'

interface FaceSpec {
  name: string
  triangles: Vec3[][]
}

interface EdgeSpec {
  name: string
  points: Vec3[]
}

function meshOf(faces: FaceSpec[], edges: EdgeSpec[], bounds?: BodyMesh['bounds']): BodyMesh {
  const vertices: number[] = []
  const triangles: number[] = []
  const faceGroups: BodyMesh['mesh']['faceGroups'] = []
  const all: Vec3[] = []
  faces.forEach((face, faceId) => {
    const start = triangles.length
    for (const triangle of face.triangles) {
      for (const point of triangle) {
        triangles.push(vertices.length / 3)
        vertices.push(...point)
        all.push(point)
      }
    }
    faceGroups.push({ start, count: triangles.length - start, faceId, name: face.name })
  })
  const lines: number[] = []
  const edgeGroups: BodyMesh['edges']['edgeGroups'] = []
  edges.forEach((edge, edgeId) => {
    const start = lines.length / 3
    for (let i = 0; i + 1 < edge.points.length; i++) {
      lines.push(...edge.points[i], ...edge.points[i + 1])
      all.push(edge.points[i], edge.points[i + 1])
    }
    edgeGroups.push({ start, count: lines.length / 3 - start, edgeId, name: edge.name })
  })
  const low = [0, 1, 2].map((axis) => Math.min(...all.map((point) => point[axis])))
  const high = [0, 1, 2].map((axis) => Math.max(...all.map((point) => point[axis])))
  return {
    key: 'mesh',
    bodyId: 'body',
    componentId: 'component',
    name: 'Body',
    colour: '#cccccc',
    mesh: {
      vertices: new Float32Array(vertices),
      triangles: new Uint32Array(triangles),
      normals: new Float32Array(vertices.length),
      faceGroups,
    },
    edges: { lines: new Float32Array(lines), edgeGroups },
    volume: 0,
    bounds: bounds ?? [low[0], low[1], low[2], high[0], high[1], high[2]],
  }
}

function square(z: number, size: number, up: boolean): Vec3[][] {
  const a: Vec3 = [0, 0, z]
  const b: Vec3 = [size, 0, z]
  const c: Vec3 = [size, size, z]
  const d: Vec3 = [0, size, z]
  return up
    ? [
        [a, b, c],
        [a, c, d],
      ]
    : [
        [a, c, b],
        [a, d, c],
      ]
}

function cylinderFace(
  centre: Vec3,
  axis: Vec3,
  across: Vec3,
  radius: number,
  from: number,
  to: number,
  segments: number,
): Vec3[][] {
  const other: Vec3 = [
    axis[1] * across[2] - axis[2] * across[1],
    axis[2] * across[0] - axis[0] * across[2],
    axis[0] * across[1] - axis[1] * across[0],
  ]
  const at = (angle: number, height: number): Vec3 =>
    [0, 1, 2].map(
      (i) =>
        centre[i] +
        radius * (Math.cos(angle) * across[i] + Math.sin(angle) * other[i]) +
        height * axis[i],
    ) as Vec3
  const out: Vec3[][] = []
  for (let i = 0; i < segments; i++) {
    const t0 = (2 * Math.PI * i) / segments
    const t1 = (2 * Math.PI * (i + 1)) / segments
    const a = at(t0, from)
    const b = at(t1, from)
    const c = at(t1, to)
    const d = at(t0, to)
    out.push([a, b, c], [a, c, d])
  }
  return out
}

function circle(centre: Vec3, radius: number, segments: number): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / segments
    return [
      centre[0] + radius * Math.cos(angle),
      centre[1] + radius * Math.sin(angle),
      centre[2],
    ] as Vec3
  })
}

function assemblyDoc(): OkcDocument {
  const doc = emptyDocument('Assembly')
  const component = (id: string, name: string) =>
    doc.components.push({ id, name, source: { kind: 'design' }, bodies: [] })
  const occurrence = (id: string, componentId: string, name: string, transform: Matrix4) =>
    doc.occurrences.push({
      id,
      parentComponentId: doc.rootComponentId,
      componentId,
      name,
      transform,
      visible: true,
      grounded: false,
    })
  component('c-plate', 'Plate')
  component('c-block', 'Block')
  component('c-cap', 'Cap')
  component('c-wheel', 'Wheel')
  occurrence('o-plate', 'c-plate', 'Plate:1', identityMatrix())
  occurrence(
    'o-block',
    'c-block',
    'Block:1',
    multiplyMatrices(translationMatrix([40, 25, 7]), rotationMatrix('z', 30)),
  )
  occurrence('o-cap', 'c-cap', 'Cap:1', translationMatrix([40, 25, 20]))
  occurrence(
    'o-wheel',
    'c-wheel',
    'Wheel:1',
    multiplyMatrices(translationMatrix([-30, 10, 3]), rotationMatrix('x', 20)),
  )
  return doc
}

let serial = 0

function contextFor(doc: OkcDocument, editing?: Feature): CommandContext {
  return {
    doc,
    unit: doc.units,
    componentId: doc.rootComponentId,
    id: (role) => `${role}-${++serial}`,
    editing,
    editingFeatureId: editing?.id,
  }
}

function side(path: string[], origin: Vec3, normal: Vec3, name: string): JointSide {
  return {
    occurrencePath: path,
    snap: { ref: { bodyId: `${path[0]}-body`, kind: 'face', name }, keypoint: 'centre' },
    frame: frameAt(origin, normal),
  }
}

function built(spec: unknown, doc: OkcDocument, initial: CommandInitialValues, editing?: Feature) {
  const command = spec as AnyCommandSpec
  const context = contextFor(doc, editing)
  const state = createCommandState(command, context, initial)
  const result = evaluateCommand(command, state, context, { build: true })
  return { command, context, result }
}

function commit(spec: unknown, doc: OkcDocument, initial: CommandInitialValues): Feature[] {
  const { command, context, result } = built(spec, doc, initial)
  if (!result.features) {
    throw new Error(result.buildError ?? result.formError ?? JSON.stringify(result.fieldErrors))
  }
  insertFeatures(doc, result.features)
  command.adjust?.(doc, result.features, context, result.values as LooseCommandValues)
  return result.features
}

function worldFrame(doc: OkcDocument, joint: JointSide): Matrix4 {
  return multiplyMatrices(pathMatrix(doc, joint.occurrencePath) ?? identityMatrix(), joint.frame)
}

export function runAssemblyTest(): TestResult[] {
  const results: TestResult[] = []
  let current = ''
  const check = (pass: boolean, detail: string) =>
    results.push({ name: `Assembly: ${current}`, pass, detail })
  const test = (name: string, body: () => void) => {
    current = name
    try {
      body()
    } catch (error) {
      check(false, `threw: ${(error as Error).stack ?? String(error)}`)
    }
  }
  const show = (value: number) => Number(value.toFixed(5)).toString()
  const showPoint = (point: ArrayLike<number>) => `[${Array.from(point).map(show).join(', ')}]`
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

  const top = square(10, 10, true)
  const bottom = square(0, 10, false)

  test('a flat face snaps to its centre with the outward normal', () => {
    const mesh = meshOf(
      [
        { name: 'top', triangles: top },
        { name: 'bottom', triangles: bottom },
      ],
      [],
    )
    const upper = faceSnap(mesh, 'top')!
    nearPoint(originOf(upper.frame), [5, 5, 10], 'top origin', 1e-5)
    nearPoint(columnOf(upper.frame, 2), [0, 0, 1], 'top axis', 1e-6)
    check(upper.keypoint === 'centre', upper.keypoint)
    const lower = faceSnap(mesh, 'bottom')!
    nearPoint(originOf(lower.frame), [5, 5, 0], 'bottom origin', 1e-5)
    nearPoint(columnOf(lower.frame, 2), [0, 0, -1], 'bottom axis', 1e-6)
  })

  test('snap frames are right-handed and orthonormal', () => {
    const frame = frameAt([1, 2, 3], [0.3, -0.4, 0.8], [1, 1, 0])
    const x = columnOf(frame, 0)
    const y = columnOf(frame, 1)
    const z = columnOf(frame, 2)
    near(dot(x, x), 1, '|x|²', 1e-12)
    near(dot(y, y), 1, '|y|²', 1e-12)
    near(dot(x, y), 0, 'x·y', 1e-12)
    near(dot(x, z), 0, 'x·z', 1e-12)
    const handed = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    near(dot(handed as Vec3, z), 1, '(x×y)·z', 1e-12)
  })

  test('a cylinder snaps to its axis at the end nearest the cursor', () => {
    const mesh = meshOf(
      [{ name: 'side', triangles: cylinderFace([2, -1, 0], [0, 0, 1], [1, 0, 0], 3, 0, 8, 32) }],
      [],
    )
    const upper = faceSnap(mesh, 'side', [5, -1, 7.5])!
    nearPoint(originOf(upper.frame), [2, -1, 8], 'top end', 1e-4)
    nearPoint(columnOf(upper.frame, 2), [0, 0, 1], 'points out of the top', 1e-6)
    check(upper.keypoint === 'centre', upper.keypoint)
    const lower = faceSnap(mesh, 'side', [2, 2, 0.4])!
    nearPoint(originOf(lower.frame), [2, -1, 0], 'bottom end', 1e-4)
    nearPoint(columnOf(lower.frame, 2), [0, 0, -1], 'points out of the bottom', 1e-6)
    const middle = faceSnap(mesh, 'side', [5, -1, 4.2])!
    nearPoint(originOf(middle.frame), [2, -1, 4], 'middle', 1e-4)
    check(middle.keypoint === 'middle', middle.keypoint)
  })

  test('a cylinder lying along x still finds its axis', () => {
    const mesh = meshOf(
      [{ name: 'shaft', triangles: cylinderFace([0, 1, 2], [1, 0, 0], [0, 1, 0], 2, -3, 5, 40) }],
      [],
    )
    const end = faceSnap(mesh, 'shaft', [4.7, 3, 2])!
    nearPoint(originOf(end.frame), [5, 1, 2], 'far end', 1e-4)
    nearPoint(columnOf(end.frame, 2), [1, 0, 0], 'axis', 1e-6)
  })

  test('a round edge snaps to its centre', () => {
    const rim = circle([1, 2, 3], 4, 48)
    const mesh = meshOf([], [{ name: 'rim', points: rim }], [-3, -2, -5, 5, 6, 3])
    const snap = edgeSnap(mesh, 'rim')!
    nearPoint(originOf(snap.frame), [1, 2, 3], 'centre', 1e-4)
    nearPoint(columnOf(snap.frame, 2), [0, 0, 1], 'away from the body', 1e-6)
    check(snap.keypoint === 'centre', snap.keypoint)
    const underside = edgeSnap(mesh, 'rim', undefined, [0, 0, -1])!
    nearPoint(columnOf(underside.frame, 2), [0, 0, -1], 'follows the face under the cursor', 1e-6)
  })

  test('unnamed faces and edges are found by their id', () => {
    const mesh = meshOf(
      [
        { name: '', triangles: bottom },
        { name: '', triangles: top },
      ],
      [{ name: '', points: circle([1, 2, 3], 4, 48) }],
    )
    const face = faceSnap(mesh, '', undefined, 1)!
    nearPoint(originOf(face.frame), [5, 5, 10], 'second face, not the first', 1e-5)
    const edge = edgeSnap(mesh, '', undefined, undefined, 0)!
    nearPoint(originOf(edge.frame), [1, 2, 3], 'edge by id', 1e-4)
  })

  test('a straight edge snaps to its middle or an end', () => {
    const points: Vec3[] = [0, 2.5, 5, 7.5, 10].map((x) => [x, 0, 0])
    const mesh = meshOf([], [{ name: 'edge', points }])
    const middle = edgeSnap(mesh, 'edge', [5.2, 0.1, 0])!
    nearPoint(originOf(middle.frame), [5, 0, 0], 'middle', 1e-6)
    check(middle.keypoint === 'middle', middle.keypoint)
    const end = edgeSnap(mesh, 'edge', [0.3, 0, 0])!
    nearPoint(originOf(end.frame), [0, 0, 0], 'start', 1e-6)
    check(end.keypoint === 'point', end.keypoint)
    const point = snapFromMesh(mesh, 'vertex', '', [10, 0, 0], [0, 0, 1])!
    nearPoint(originOf(point.frame), [10, 0, 0], 'corner', 1e-6)
  })

  test('snap picks keep their side through a command', () => {
    const doc = assemblyDoc()
    const one = side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom')
    const two = side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top')
    const pickOne = jointSnapPick(doc, one)
    const pickTwo = jointSnapPick(doc, two)
    check(pickOne.label === 'Centre of Block:1', pickOne.label)
    check(pickOne.id !== pickTwo.id, `${pickOne.id} / ${pickTwo.id}`)
    check(jointSnapPick(doc, one).id === pickOne.id, 'same snap, same id')
    const { result } = built(jointCommand, doc, { one: [pickOne], two: [pickTwo] })
    const joint = result.features?.[0] as JointFeature | undefined
    check(!!joint && JSON.stringify(joint.one) === JSON.stringify(one), JSON.stringify(joint?.one))
    check(!!joint && JSON.stringify(joint.two) === JSON.stringify(two), JSON.stringify(joint?.two))
  })

  const place = (initial: CommandInitialValues, setup?: (doc: OkcDocument) => void) => {
    const doc = assemblyDoc()
    setup?.(doc)
    const one = side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom')
    const two = side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top')
    const plateBefore = [...findOccurrence(doc, 'o-plate')!.transform]
    const blockBefore = [...findOccurrence(doc, 'o-block')!.transform]
    const [joint] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, one)],
      two: [jointSnapPick(doc, two)],
      ...initial,
    }) as JointFeature[]
    return {
      doc,
      joint,
      a: worldFrame(doc, joint.one),
      b: worldFrame(doc, joint.two),
      plateBefore,
      blockBefore,
    }
  }

  test('a joint mates component 1 onto component 2', () => {
    const { doc, a, b, plateBefore } = place({})
    nearPoint(originOf(a), originOf(b), 'snap points meet', 1e-6)
    near(dot(columnOf(a, 2), columnOf(b, 2)), -1, 'faces meet head on', 1e-9)
    check(
      JSON.stringify(findOccurrence(doc, 'o-plate')!.transform) === JSON.stringify(plateBefore),
      'component 2 stays where it was',
    )
    nearPoint(originOf(findOccurrence(doc, 'o-block')!.transform), [15, 5, 4], 'block moved', 1e-6)
  })

  test('Flip turns component 1 over', () => {
    const { a, b } = place({ flip: true })
    nearPoint(originOf(a), originOf(b), 'snap points meet', 1e-6)
    near(dot(columnOf(a, 2), columnOf(b, 2)), 1, 'axes now agree', 1e-9)
  })

  test('Offset lifts component 1 along the joint axis', () => {
    const { a, b } = place({ offset: 3 })
    const lifted: Vec3 = [b[12] + 3 * b[8], b[13] + 3 * b[9], b[14] + 3 * b[10]]
    nearPoint(originOf(a), lifted, 'three millimetres up', 1e-6)
  })

  test('Angle turns component 1 about the joint axis', () => {
    const { a, b } = place({ angle: 90 })
    near(dot(columnOf(a, 0), columnOf(b, 0)), 0, 'x against x', 1e-9)
    near(dot(columnOf(a, 0), columnOf(b, 1)), 1, 'x lands on y', 1e-9)
  })

  test('a grounded component 1 pulls component 2 to it instead', () => {
    const { doc, a, b, blockBefore } = place({}, (draft) => {
      findOccurrence(draft, 'o-block')!.grounded = true
    })
    nearPoint(originOf(a), originOf(b), 'snap points meet', 1e-6)
    check(
      JSON.stringify(findOccurrence(doc, 'o-block')!.transform) === JSON.stringify(blockBefore),
      'the grounded block did not move',
    )
  })

  test('joints refuse impossible picks', () => {
    const doc = assemblyDoc()
    const same = built(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [jointSnapPick(doc, side(['o-block'], [5, 5, 10], [0, 0, 1], 'top'))],
    }).result
    check(!!same.fieldErrors.two, same.fieldErrors.two ?? 'no error')
    findOccurrence(doc, 'o-block')!.grounded = true
    const both = built(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [jointSnapPick(doc, side([], [0, 0, 0], [0, 0, 1], 'top'))],
    }).result
    check(!!both.formError && !both.valid, both.formError ?? 'no error')
  })

  const hinge = (doc: OkcDocument) => {
    findOccurrence(doc, 'o-plate')!.grounded = true
    return commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [jointSnapPick(doc, side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top'))],
      motion: 'revolute',
    })[0] as JointFeature
  }

  test('Drive Joints turns a revolute joint to an exact angle', () => {
    const doc = assemblyDoc()
    const joint = hinge(doc)
    const before = worldFrame(doc, joint.one)
    const values = { joint: [featurePick(doc, joint.id)!], rotation: 45 }
    const { command, context, result } = built(driveJointsCommand, doc, values)
    check(result.valid && !!result.features, result.formError ?? 'valid')
    command.adjust?.(doc, [], context, result.values as LooseCommandValues)
    const driven = findFeature(doc, joint.id) as JointFeature
    near(driven.values[0], 45, 'stored angle', 1e-6)
    const after = worldFrame(doc, driven.one)
    nearPoint(originOf(after), originOf(before), 'turns in place', 1e-6)
    near(dot(columnOf(after, 0), columnOf(before, 0)), Math.SQRT1_2, 'turned 45°', 1e-6)
  })

  test('Drive Joints refuses a rigid joint', () => {
    const doc = assemblyDoc()
    const [joint] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [jointSnapPick(doc, side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top'))],
    })
    const { result } = built(driveJointsCommand, doc, { joint: [featurePick(doc, joint.id)!] })
    check(!!result.fieldErrors.joint, result.fieldErrors.joint ?? 'no error')
  })

  test('a motion link turns the second joint by the ratio', () => {
    const doc = assemblyDoc()
    const first = hinge(doc)
    const [second] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-wheel'], [0, 0, 0], [0, 0, -1], 'hub'))],
      two: [jointSnapPick(doc, side(['o-plate'], [60, 10, 4], [0, 0, 1], 'top'))],
      motion: 'revolute',
    }) as JointFeature[]
    const [link] = commit(motionLinkCommand, doc, {
      a: [featurePick(doc, first.id)!],
      b: [featurePick(doc, second.id)!],
      aAngle: 360,
      bAngle: 720,
    })
    check(link.kind === 'motionLink' && Math.abs(link.ratio - 2) < 1e-12, JSON.stringify(link))
    const result = solveDocument(doc, { drive: [{ jointId: first.id, dof: 0, value: 30 }] })
    applyAssemblyResult(doc, result)
    near((findFeature(doc, first.id) as JointFeature).values[0], 30, 'driven joint', 1e-5)
    near((findFeature(doc, second.id) as JointFeature).values[0], 60, 'linked joint', 1e-4)
  })

  test('a rigid group carries its members together', () => {
    const doc = assemblyDoc()
    commit(rigidGroupCommand, doc, {
      members: [occurrencePick(doc, 'o-block')!, occurrencePick(doc, 'o-cap')!],
    })
    const relative = (d: OkcDocument) => {
      const block = findOccurrence(d, 'o-block')!.transform
      const cap = findOccurrence(d, 'o-cap')!.transform
      return [cap[12] - block[12], cap[13] - block[13], cap[14] - block[14]] as Vec3
    }
    const before = relative(doc)
    const joint = hinge(doc)
    applyAssemblyResult(
      doc,
      solveDocument(doc, { drive: [{ jointId: joint.id, dof: 0, value: 0 }] }),
    )
    const blockTurn = findOccurrence(doc, 'o-block')!.transform
    const capTurn = findOccurrence(doc, 'o-cap')!.transform
    near(
      dot(columnOf(blockTurn, 0), columnOf(capTurn, 0)),
      Math.cos(Math.PI / 6),
      'kept the relative turn',
      1e-6,
    )
    const moved = relative(doc)
    near(Math.hypot(...moved), Math.hypot(...before), 'kept their distance', 1e-6)
  })

  test('deleting a component removes its joints and their links', () => {
    const doc = assemblyDoc()
    const first = hinge(doc)
    const [second] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-wheel'], [0, 0, 0], [0, 0, -1], 'hub'))],
      two: [jointSnapPick(doc, side(['o-plate'], [60, 10, 4], [0, 0, 1], 'top'))],
      motion: 'revolute',
    })
    commit(motionLinkCommand, doc, {
      a: [featurePick(doc, first.id)!],
      b: [featurePick(doc, second.id)!],
    })
    commit(rigidGroupCommand, doc, {
      members: [occurrencePick(doc, 'o-block')!, occurrencePick(doc, 'o-cap')!],
    })
    removeOccurrencesFromDocument(doc, ['o-block'])
    const kinds = doc.timeline.map((feature) => feature.kind)
    check(
      kinds.length === 1 && kinds[0] === 'joint' && doc.timeline[0].id === second.id,
      kinds.join(', '),
    )
  })

  test('moved components show at their new place before the kernel answers', () => {
    const doc = assemblyDoc()
    const instance = (path: string[], matrix: Matrix4): Instance => ({
      id: path.join('/') + '|body',
      kind: 'body',
      path,
      componentId: 'c',
      bodyId: 'body',
      meshKey: 'mesh',
      matrix,
      visible: true,
      negative: false,
    })
    const instances = [
      instance(['o-plate'], findOccurrence(doc, 'o-plate')!.transform),
      instance(['o-block'], findOccurrence(doc, 'o-block')!.transform),
    ]
    check(placedInstances(instances, doc) === instances, 'nothing moved, nothing replaced')
    findOccurrence(doc, 'o-block')!.transform = translationMatrix([1, 2, 3])
    const placed = placedInstances(instances, doc)
    check(placed[0] === instances[0], 'the plate keeps its instance')
    nearPoint(originOf(placed[1].matrix), [1, 2, 3], 'the block follows its occurrence')
  })

  test('a joint origin applies its offset, angle and flip in its own axes', () => {
    const frame = originFrame({
      base: frameAt([1, 2, 3], [0, 0, 1]),
      offset: [2, 0, 1],
      angle: 90,
      flip: true,
    })
    nearPoint(originOf(frame), [3, 2, 4], 'offset along its axes', 1e-9)
    nearPoint(columnOf(frame, 0), [0, 1, 0], 'x turned a quarter', 1e-9)
    nearPoint(columnOf(frame, 2), [0, 0, -1], 'z flipped', 1e-9)
  })

  const originDoc = () => {
    const doc = assemblyDoc()
    findOccurrence(doc, 'o-plate')!.grounded = true
    const [origin] = commit(jointOriginCommand, doc, {
      snap: [jointSnapPick(doc, side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top'))],
      offsetX: 5,
    }) as JointOriginFeature[]
    const originPick = jointSnapPick(doc, {
      occurrencePath: ['o-plate'],
      snap: { ref: null, keypoint: 'origin', originId: origin.id },
      frame: originFrame(origin),
    })
    const [joint] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [originPick],
    }) as JointFeature[]
    return { doc, origin, joint }
  }

  test('a joint can snap to a joint origin', () => {
    const { doc, origin, joint } = originDoc()
    check(origin.componentId === 'c-plate', origin.componentId)
    check(joint.two.snap.originId === origin.id, JSON.stringify(joint.two.snap))
    nearPoint(originOf(worldFrame(doc, joint.one)), [25, 10, 4], 'block sits on the origin', 1e-6)
  })

  test('moving a joint origin carries the joints that use it', () => {
    const { doc, origin } = originDoc()
    const { command, context, result } = built(
      jointOriginCommand,
      doc,
      {
        snap: [jointSnapPick(doc, side(['o-plate'], [20, 10, 4], [0, 0, 1], 'top'))],
        offsetX: 5,
        offsetY: 7,
      },
      origin,
    )
    replaceFeatureInDocument(doc, origin.id, result.features!)
    command.adjust?.(doc, result.features!, context, result.values as LooseCommandValues)
    const joint = doc.timeline.find((feature) => feature.kind === 'joint') as JointFeature
    nearPoint(originOf(joint.two.frame), [25, 17, 4], 'the joint read the new origin', 1e-9)
    nearPoint(originOf(worldFrame(doc, joint.one)), [25, 17, 4], 'and the block followed', 1e-6)
  })

  test('a joint follows its face when the body is rebuilt bigger', () => {
    const doc = assemblyDoc()
    findOccurrence(doc, 'o-plate')!.grounded = true
    const [joint] = commit(jointCommand, doc, {
      one: [jointSnapPick(doc, side(['o-block'], [5, 5, 0], [0, 0, -1], 'bottom'))],
      two: [jointSnapPick(doc, side(['o-plate'], [5, 5, 10], [0, 0, 1], 'top'))],
    }) as JointFeature[]
    const plate = (height: number) => ({
      ...meshOf([{ name: 'top', triangles: square(height, 10, true) }], []),
      key: `plate-${height}`,
      bodyId: 'o-plate-body',
    })
    const instances = [
      {
        id: 'o-plate|o-plate-body',
        kind: 'body' as const,
        path: ['o-plate'],
        componentId: 'c-plate',
        bodyId: 'o-plate-body',
        meshKey: 'plate-10',
        matrix: identityMatrix(),
        visible: true,
        negative: false,
      },
    ]
    const same = new Map([['plate-10', plate(10)]])
    check(!refreshJointFrames(doc, instances, same), 'unchanged geometry changes nothing')
    const taller = new Map([['plate-10', plate(14)]])
    check(refreshJointFrames(doc, instances, taller), 'taller geometry is noticed')
    applyAssemblyResult(doc, solveDocument(doc))
    const live = doc.timeline.find((feature) => feature.id === joint.id) as JointFeature
    nearPoint(originOf(live.two.frame), [5, 5, 14], 'the snap moved up with the face', 1e-5)
    nearPoint(originOf(worldFrame(doc, live.one)), [5, 5, 14], 'and the block rode up', 1e-5)
    check(!refreshJointFrames(doc, instances, taller), 'and then it settles')
  })

  test('a motion study track interpolates between its keys', () => {
    const track = {
      jointId: 'j',
      dof: 0,
      keys: [
        { step: 40, value: 90 },
        { step: 0, value: 0 },
        { step: 60, value: 30 },
      ],
    }
    near(trackValue(track, -5, 7), 0, 'before the first key', 1e-12)
    near(trackValue(track, 10, 7), 22.5, 'a quarter of the way', 1e-12)
    near(trackValue(track, 50, 7), 60, 'between the later keys', 1e-12)
    near(trackValue(track, 80, 7), 30, 'after the last key', 1e-12)
    near(trackValue({ ...track, keys: [] }, 10, 7), 7, 'no keys keeps the joint', 1e-12)
  })

  test('a motion study poses the joints at a step', () => {
    const doc = assemblyDoc()
    const joint = hinge(doc)
    const study = {
      tracks: [
        {
          jointId: joint.id,
          dof: 0,
          keys: [
            { step: 0, value: 0 },
            { step: 10, value: 90 },
          ],
        },
        { jointId: 'missing', dof: 0, keys: [{ step: 0, value: 5 }] },
      ],
    }
    check(studyDrives(doc, study, 5).length === 1, 'missing joints are skipped')
    check(poseStudy(doc, study, 5), 'solved without conflicts')
    near((findFeature(doc, joint.id) as JointFeature).values[0], 45, 'halfway through', 1e-6)
    ;(findFeature(doc, joint.id) as JointFeature).locked = true
    check(!studyDrives(doc, study, 8).length, 'locked joints are left alone')
  })

  test('deleting a joint origin deletes the joints built on it', () => {
    const { doc, origin } = originDoc()
    deleteFeatures(doc, dependentClosure(doc, [origin.id]))
    check(!doc.timeline.length, doc.timeline.map((feature) => feature.kind).join(', '))
  })

  test('editing a joint keeps its driven position when the motion stays', () => {
    const doc = assemblyDoc()
    const joint = hinge(doc)
    joint.values = [45]
    joint.limits = [{ min: -90, max: 90 }]
    const picks = {
      one: [jointSnapPick(doc, joint.one)],
      two: [jointSnapPick(doc, joint.two)],
    }
    const same = built(jointCommand, doc, { ...picks, motion: 'revolute' }, joint).result
    const kept = same.features?.[0] as JointFeature
    check(kept?.values[0] === 45 && kept.limits[0]?.max === 90, JSON.stringify(kept?.values))
    const changed = built(jointCommand, doc, { ...picks, motion: 'slider' }, joint).result
    const reset = changed.features?.[0] as JointFeature
    check(reset?.values[0] === 0 && !reset.limits.length, JSON.stringify(reset?.values))
  })

  return results
}
