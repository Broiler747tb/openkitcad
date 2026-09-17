import {
  frameToLocal,
  frameToWorld,
  makeFrame,
  v3,
  type Frame,
  type Vec3,
} from '../../../core/math'
import {
  FIT_CLASSES,
  fitParameterGap,
  isFitClass,
  linkFitClass,
  SNAP_MATERIALS,
  snapHookLength,
} from '../../../doc/fits'
import { findBody } from '../../../doc/model'
import { usePreferences } from '../../../doc/preferences'
import { bodyInstance, useStore } from '../../../doc/store'
import type {
  BayonetFeature,
  DovetailFeature,
  Feature,
  FitClass,
  FitFeature,
  FitPinsFeature,
  HingeFeature,
  LipGrooveFeature,
  OkcDocument,
  SnapFitFeature,
  SnapMaterial,
  SnapRetention,
  SnapRingFeature,
} from '../../../doc/types'
import type { MeshData } from '../../../kernel/types'
import { bodyPick, elementPick } from '../picks'
import type { CommandStart } from '../session'
import {
  defineCommand,
  type AnyCommandSpec,
  type CommandContext,
  type CommandHandle,
  type CommandValue,
  type LooseCommandValues,
  type SelectionPick,
} from '../types'
import { pointOnFace } from './placed'
import { componentOfBody, pickedFrame, planeValues } from './shared'

export const FIT_OPTIONS = [
  ...FIT_CLASSES.map(({ value, label, hint }) => ({ value, label, hint })),
  { value: 'custom', label: 'Custom', hint: 'A gap of your own, not tied to the printer table.' },
]

export const RETENTIONS = [
  { value: 'permanent', label: 'Permanent', hint: 'A square catch. Stays shut.' },
  {
    value: 'removable',
    label: 'Removable',
    hint: 'A sloped catch, so a firm pull opens it again.',
  },
]

export function classGap(doc: OkcDocument, fit: FitClass): number {
  const entry = FIT_CLASSES.find((candidate) => candidate.value === fit)!
  return fitParameterGap(doc, fit) ?? usePreferences.getState().values[entry.preference]
}

function fitInputs(fit: FitClass) {
  return [
    {
      id: 'fit',
      kind: 'choice',
      label: 'Fit',
      hint: 'How tight the two halves go together. Each class takes its gap from your printer fit table.',
      options: FIT_OPTIONS,
      default: fit,
    },
    {
      id: 'gap',
      kind: 'length',
      label: 'Gap',
      hint: 'Clearance on each side between the two halves.',
      default:
        usePreferences.getState().values[FIT_CLASSES.find((c) => c.value === fit)!.preference],
      min: 0,
      max: 5,
      field: 'gap',
    },
  ] as const
}

const MATE_INPUT = {
  id: 'mate',
  kind: 'selection',
  label: 'Other Part',
  hint: 'The body the matching half is cut into. Found for you when you click the face.',
  filter: ['body'],
  min: 1,
  max: 1,
  prompt: 'Select the other part',
} as const

function deriveFit(
  values: LooseCommandValues,
  changed: string,
  context: CommandContext,
): Record<string, CommandValue> | null {
  if (changed === 'fit' && isFitClass(values.fit)) return { gap: classGap(context.doc, values.fit) }
  if (
    changed === 'gap' &&
    isFitClass(values.fit) &&
    Math.abs((values.gap as number) - classGap(context.doc, values.fit)) > 1e-9
  ) {
    return { fit: 'custom' }
  }
  return null
}

function adjustFit(doc: OkcDocument, features: Feature[], values: LooseCommandValues) {
  const feature = features[0]
  if (!feature) return
  const fit = isFitClass(values.fit) ? values.fit : undefined
  linkFitClass(doc, feature.id, fit, fit ? classGap(doc, fit) : 0)
}

function mateOf(values: LooseCommandValues): string | undefined {
  const pick = (values.mate as readonly SelectionPick[])[0]
  return pick ? (pick.bodyId ?? pick.id) : undefined
}

function fitBase(
  context: CommandContext,
  role: string,
  name: string,
  bodyId: string,
  values: LooseCommandValues,
) {
  const mateBodyId = mateOf(values)
  return {
    id: context.editing?.id ?? context.id(role),
    name: context.editing?.name ?? name,
    componentId:
      context.editing?.componentId ?? componentOfBody(context.doc, bodyId, context.componentId),
    bodyId,
    ...(mateBodyId ? { mateBodyId } : {}),
    gap: values.gap as number,
    ...(isFitClass(values.fit) ? { fitClass: values.fit } : {}),
  }
}

function mateProblem(
  doc: OkcDocument,
  bodyId: string | undefined,
  values: LooseCommandValues,
): Record<string, string> | null {
  const mateBodyId = mateOf(values)
  if (!bodyId || !mateBodyId) return null
  if (mateBodyId === bodyId) return { mate: 'Pick the other part, not the one the fit is on.' }
  const own = findBody(doc, bodyId)?.component.id
  const other = findBody(doc, mateBodyId)?.component.id
  if (own && other && own !== other) {
    return { mate: 'Both parts have to be in the same component for now.' }
  }
  return null
}

function round(value: number, places = 2): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function bodyMesh(bodyId: string): MeshData | null {
  const state = useStore.getState()
  const instance = bodyInstance(state, bodyId)
  return instance ? (state.meshes.get(instance.meshKey)?.mesh ?? null) : null
}

function vertex(mesh: MeshData, index: number): Vec3 {
  return [mesh.vertices[index * 3], mesh.vertices[index * 3 + 1], mesh.vertices[index * 3 + 2]]
}

function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = v3.sub(b, a)
  const ac = v3.sub(c, a)
  const ap = v3.sub(p, a)
  const d1 = v3.dot(ab, ap)
  const d2 = v3.dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return a
  const bp = v3.sub(p, b)
  const d3 = v3.dot(ab, bp)
  const d4 = v3.dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return b
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return v3.add(a, v3.scale(ab, d1 / (d1 - d3)))
  const cp = v3.sub(p, c)
  const d5 = v3.dot(ab, cp)
  const d6 = v3.dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return c
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return v3.add(a, v3.scale(ac, d2 / (d2 - d6)))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return v3.add(b, v3.scale(v3.sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))))
  }
  const denominator = 1 / (va + vb + vc)
  return v3.add(a, v3.add(v3.scale(ab, vb * denominator), v3.scale(ac, vc * denominator)))
}

function meshDistance(mesh: MeshData, point: Vec3, limit: number): number | null {
  let best = limit
  let found = false
  const { triangles } = mesh
  for (let t = 0; t < triangles.length; t += 3) {
    const a = vertex(mesh, triangles[t])
    const b = vertex(mesh, triangles[t + 1])
    const c = vertex(mesh, triangles[t + 2])
    let outside = 0
    for (let axis = 0; axis < 3; axis++) {
      const low = Math.min(a[axis], b[axis], c[axis])
      const high = Math.max(a[axis], b[axis], c[axis])
      outside = Math.max(outside, low - point[axis], point[axis] - high)
    }
    if (outside > best) continue
    const distance = v3.dist(point, closestOnTriangle(point, a, b, c))
    if (distance <= best) {
      best = distance
      found = true
    }
  }
  return found ? best : null
}

function nearestBody(pick: SelectionPick, lift: number, reach: number): SelectionPick[] {
  const state = useStore.getState()
  const bodyId = pick.bodyId
  if (!bodyId || !pick.point || !pick.normal) return []
  const found = findBody(state.doc, bodyId)
  if (!found) return []
  const probe = v3.add(pick.point, v3.scale(v3.norm(pick.normal), lift))
  let best: { id: string; distance: number } | null = null
  for (const body of found.component.bodies) {
    if (body.id === bodyId) continue
    const mesh = bodyMesh(body.id)
    if (!mesh) continue
    const distance = meshDistance(mesh, probe, best?.distance ?? reach)
    if (distance !== null && (!best || distance < best.distance)) best = { id: body.id, distance }
  }
  const picked = best ? bodyPick(state.doc, best.id) : null
  return picked ? [picked] : []
}

interface Wall {
  foot: Vec3
  inward: Vec3
  distance: number
}

function wallNear(
  mesh: MeshData,
  origin: Vec3,
  normal: Vec3,
  depth: number,
  reach: number,
  accept: (inward: Vec3) => boolean = () => true,
): Wall | null {
  const n = v3.norm(normal)
  const centre = v3.add(origin, v3.scale(n, depth))
  const { triangles, normals } = mesh
  let best: Wall | null = null
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [0, 1, 2].map((k) => vertex(mesh, triangles[t + k]))
    const heights = corners.map((corner) => v3.dot(v3.sub(corner, centre), n))
    if (heights.every((h) => h > 0) || heights.every((h) => h < 0)) continue
    const outward = v3.norm(
      [0, 1, 2].reduce<Vec3>(
        (sum, k) => {
          const index = triangles[t + k] * 3
          return v3.add(sum, [normals[index], normals[index + 1], normals[index + 2]])
        },
        [0, 0, 0],
      ),
    )
    const across = v3.sub(outward, v3.scale(n, v3.dot(outward, n)))
    if (v3.len(across) < 0.7) continue
    const inward = v3.norm(v3.scale(across, -1))
    if (!accept(inward)) continue
    const crossings: Vec3[] = []
    for (let k = 0; k < 3; k++) {
      const [ha, hb] = [heights[k], heights[(k + 1) % 3]]
      if ((ha <= 0 && hb >= 0) || (ha >= 0 && hb <= 0)) {
        const span = ha - hb
        const s = Math.abs(span) < 1e-12 ? 0 : ha / span
        crossings.push(v3.add(corners[k], v3.scale(v3.sub(corners[(k + 1) % 3], corners[k]), s)))
      }
    }
    if (crossings.length < 2) continue
    const [p, q] = crossings
    const along = v3.sub(q, p)
    const length = v3.dot(along, along)
    const s =
      length < 1e-12 ? 0 : Math.max(0, Math.min(1, v3.dot(v3.sub(centre, p), along) / length))
    const foot = v3.add(p, v3.scale(along, s))
    const distance = v3.dist(foot, centre)
    if (distance > reach || (best && distance >= best.distance)) continue
    best = { foot: v3.sub(foot, v3.scale(n, depth)), inward, distance }
  }
  return best
}

function faceFrameOf(pick: SelectionPick): Frame | null {
  if (!pick.point || !pick.normal) return null
  const normal = v3.norm(pick.normal)
  return makeFrame(v3.scale(normal, v3.dot(pick.point, normal)), normal)
}

function placeOn(frame: Frame, point: Vec3, direction: Vec3) {
  const [x, y] = frameToLocal(frame, point)
  const angle =
    (Math.atan2(v3.dot(direction, frame.yDir), v3.dot(direction, frame.xDir)) * 180) / Math.PI
  return { x: round(x), y: round(y), angle: round(angle, 1) }
}

function snapPlacement(pick: SelectionPick): Record<string, CommandValue> {
  const mate = nearestBody(pick, 0.5, 25)
  const base = { ...pointOnFace(pick), mate }
  const frame = faceFrameOf(pick)
  const mesh = mate[0] ? bodyMesh(mate[0].bodyId ?? mate[0].id) : null
  if (!frame || !mesh || !pick.point) return base
  const wall = wallNear(mesh, pick.point, frame.normal, 2, 25)
  return wall ? { ...base, ...placeOn(frame, wall.foot, wall.inward) } : base
}

function hingePlacement(pick: SelectionPick): Record<string, CommandValue> {
  const mate = nearestBody(pick, -0.5, 30)
  const base = { ...pointOnFace(pick), mate }
  const frame = faceFrameOf(pick)
  const theirMesh = mate[0] ? bodyMesh(mate[0].bodyId ?? mate[0].id) : null
  if (!frame || !theirMesh || !pick.point || !pick.bodyId) return base
  const theirs = wallNear(theirMesh, pick.point, frame.normal, -1, 30)
  if (!theirs) return base
  const ownMesh = bodyMesh(pick.bodyId)
  const ours =
    ownMesh &&
    wallNear(
      ownMesh,
      theirs.foot,
      frame.normal,
      -1,
      6,
      (inward) => v3.dot(inward, theirs.inward) < -0.9,
    )
  const seam = ours ? v3.scale(v3.add(theirs.foot, ours.foot), 0.5) : theirs.foot
  return { ...base, ...placeOn(frame, seam, v3.cross(frame.normal, theirs.inward)) }
}

function mateOnly(pick: SelectionPick): Record<string, CommandValue> {
  return { mate: nearestBody(pick, 0.5, 10) }
}

function pinPick(pick: SelectionPick): SelectionPick {
  const { x, y } = pointOnFace(pick)
  return { ...pick, id: `${pick.id}@${x},${y}`, label: `Pin at ${x}, ${y}` }
}

function mergePins(current: readonly SelectionPick[], pick: SelectionPick): SelectionPick[] | null {
  if (!pick.face || !pick.point || !pick.normal) return null
  const near = current.findIndex(
    (candidate) => candidate.point && v3.dist(candidate.point, pick.point!) < 2,
  )
  if (near >= 0) return current.filter((_, index) => index !== near)
  const same = current.filter(
    (candidate) => candidate.bodyId === pick.bodyId && candidate.face?.name === pick.face!.name,
  )
  return [...same, pinPick(pick)]
}

function facePlane(picks: readonly SelectionPick[]) {
  const face = picks[0].face!
  return { face, plane: { kind: 'face' as const, face, offset: 0 } }
}

function arrow(
  values: LooseCommandValues,
  context: CommandContext,
  input: string,
  at: [number, number],
): CommandHandle[] {
  const picks = values.face as readonly SelectionPick[]
  const face = picks[0]?.face
  const frame = face && pickedFrame(picks, context.editing?.id)
  if (!face || !frame) return []
  return [
    {
      kind: 'arrow',
      input,
      componentId: componentOfBody(context.doc, face.bodyId, context.componentId),
      anchor: { point: frameToWorld(frame, at), direction: frame.normal },
    },
  ]
}

export const snapFitCommand = defineCommand({
  id: 'snapFit',
  label: 'Snap Fit',
  hint: 'A springy hook on one part that clicks into a catch cut in the other.',
  icon: '⌐',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The face the hook grows out of. Click near the wall it should catch and it lines up for you.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Click the face, near the wall to catch',
      fills: snapPlacement,
    },
    MATE_INPUT,
    { id: 'x', kind: 'length', label: 'Position X', hint: 'Along the face.', default: 0 },
    { id: 'y', kind: 'length', label: 'Position Y', hint: 'Across the face.', default: 0 },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Hook Direction',
      hint: 'Which way the hook points, round the face.',
      default: 0,
    },
    {
      id: 'length',
      kind: 'length',
      label: 'Arm Length',
      hint: 'Longer arms bend more gently and last longer.',
      default: 12,
      min: 0,
      exclusiveMin: true,
      field: 'length',
    },
    {
      id: 'thickness',
      kind: 'length',
      label: 'Arm Thickness',
      hint: 'A few perimeters thick. Thinner flexes more easily.',
      default: 1.6,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    {
      id: 'width',
      kind: 'length',
      label: 'Arm Width',
      default: 6,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'hookDepth',
      kind: 'length',
      label: 'Hook Depth',
      hint: 'How far the hook reaches into the catch.',
      default: 1,
      min: 0,
      exclusiveMin: true,
      field: 'hookDepth',
    },
    {
      id: 'retention',
      kind: 'choice',
      label: 'Catch',
      options: RETENTIONS,
      default: 'permanent',
      display: 'buttons',
    },
    {
      id: 'material',
      kind: 'choice',
      label: 'Material',
      hint: 'Sets how far the arm may bend before it risks cracking.',
      options: SNAP_MATERIALS.map(({ value, label, hint }) => ({ value, label, hint })),
      default: 'petg',
    },
    {
      id: 'through',
      kind: 'toggle',
      label: 'Window Through Wall',
      hint: 'Cut the catch right through, so the hook can be pressed from outside to open it.',
      default: false,
    },
    ...fitInputs('snug'),
  ],
  validate(values, context) {
    const shortest =
      snapHookLength({
        hookDepth: values.hookDepth,
        retention: values.retention as SnapRetention,
      }) + values.thickness
    if (values.length < shortest) {
      return { length: `Too short for this hook. Make it at least ${shortest.toFixed(1)} mm.` }
    }
    return mateProblem(context.doc, values.face[0]?.face?.bodyId, values)
  },
  build(values, context) {
    const { face, plane } = facePlane(values.face)
    const feature: SnapFitFeature = {
      ...fitBase(context, 'snapFit', 'Snap Fit', face.bodyId, values),
      kind: 'snapFit',
      plane,
      position: [values.x, values.y],
      angle: values.angle,
      length: values.length,
      thickness: values.thickness,
      width: values.width,
      hookDepth: values.hookDepth,
      retention: values.retention as SnapRetention,
      material: values.material as SnapMaterial,
      through: values.through,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
  handles: (values, context) => arrow(values, context, 'length', [values.x, values.y]),
})

export const fitPinsCommand = defineCommand({
  id: 'fitPins',
  label: 'Alignment Pins',
  hint: 'Pins on one part that press into matching sockets in the other, so the halves line up.',
  icon: '⫯',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Pins',
      hint: 'Click the face once for each pin. Click a pin again to remove it.',
      filter: ['face'],
      min: 1,
      max: 24,
      prompt: 'Click where each pin goes',
      merge: mergePins,
      fills: mateOnly,
    },
    MATE_INPUT,
    {
      id: 'diameter',
      kind: 'length',
      label: 'Diameter',
      default: 3,
      min: 0,
      exclusiveMin: true,
      field: 'diameter',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Height',
      default: 4,
      min: 0,
      exclusiveMin: true,
      field: 'height',
    },
    ...fitInputs('press'),
  ],
  validate(values, context) {
    if (values.face.some((pick) => !pick.point)) {
      return { face: 'Click on the face where each pin goes.' }
    }
    if (new Set(values.face.map((pick) => `${pick.bodyId}|${pick.face?.name}`)).size > 1) {
      return { face: 'Put all the pins on one face.' }
    }
    return mateProblem(context.doc, values.face[0]?.face?.bodyId, values)
  },
  build(values, context) {
    const { face, plane } = facePlane(values.face)
    const feature: FitPinsFeature = {
      ...fitBase(context, 'fitPins', 'Alignment Pins', face.bodyId, values),
      kind: 'fitPins',
      plane,
      positions: values.face.map((pick) => {
        const { x, y } = pointOnFace(pick)
        return [x ?? 0, y ?? 0]
      }),
      diameter: values.diameter,
      height: values.height,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

export const lipGrooveCommand = defineCommand({
  id: 'lipGroove',
  label: 'Lip and Groove',
  hint: 'A raised lip round the edge of one part that sits in a groove in the other, so the seam lines up and hides the gap.',
  icon: '⊔',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The face where the two parts meet. The lip follows its outside edge.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Click the face where the parts meet',
      fills: mateOnly,
    },
    MATE_INPUT,
    {
      id: 'width',
      kind: 'length',
      label: 'Lip Width',
      default: 1,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Lip Height',
      default: 2,
      min: 0,
      exclusiveMin: true,
      field: 'height',
    },
    {
      id: 'inset',
      kind: 'length',
      label: 'Inset',
      hint: 'How far in from the outside edge the lip starts. Keep lip and inset inside the wall.',
      default: 1,
      min: 0,
      field: 'inset',
    },
    ...fitInputs('snug'),
  ],
  validate: (values, context) => mateProblem(context.doc, values.face[0]?.face?.bodyId, values),
  build(values, context) {
    const { face, plane } = facePlane(values.face)
    const feature: LipGrooveFeature = {
      ...fitBase(context, 'lipGroove', 'Lip and Groove', face.bodyId, values),
      kind: 'lipGroove',
      plane,
      width: values.width,
      height: values.height,
      inset: values.inset,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

export const dovetailCommand = defineCommand({
  id: 'dovetail',
  label: 'Dovetail',
  hint: 'A flared rail on one part that slides into a matching slot in the other and cannot lift out.',
  icon: '⏢',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The face the rail stands on.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Click the face for the rail',
      fills: (pick) => ({ ...pointOnFace(pick), ...mateOnly(pick) }),
    },
    MATE_INPUT,
    { id: 'x', kind: 'length', label: 'Position X', hint: 'Centre of the rail.', default: 0 },
    { id: 'y', kind: 'length', label: 'Position Y', hint: 'Centre of the rail.', default: 0 },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Direction',
      hint: 'Which way the rail runs. The slot opens towards the start.',
      default: 0,
    },
    {
      id: 'length',
      kind: 'length',
      label: 'Length',
      default: 20,
      min: 0,
      exclusiveMin: true,
      field: 'length',
    },
    {
      id: 'width',
      kind: 'length',
      label: 'Width',
      hint: 'Across the narrow root of the rail.',
      default: 6,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Height',
      default: 3,
      min: 0,
      exclusiveMin: true,
      field: 'height',
    },
    {
      id: 'flankAngle',
      kind: 'angle',
      label: 'Flank Angle',
      hint: 'How far the sides lean out. 15° to 25° prints cleanly and still locks.',
      default: 20,
      min: 0,
      max: 40,
      field: 'flankAngle',
    },
    {
      id: 'through',
      kind: 'toggle',
      label: 'Open Both Ends',
      hint: 'Let the part slide right through instead of stopping at the end of the rail.',
      default: false,
    },
    ...fitInputs('sliding'),
  ],
  validate: (values, context) => mateProblem(context.doc, values.face[0]?.face?.bodyId, values),
  build(values, context) {
    const { face, plane } = facePlane(values.face)
    const feature: DovetailFeature = {
      ...fitBase(context, 'dovetail', 'Dovetail', face.bodyId, values),
      kind: 'dovetail',
      plane,
      position: [values.x, values.y],
      angle: values.angle,
      length: values.length,
      width: values.width,
      height: values.height,
      flankAngle: values.flankAngle,
      through: values.through,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

const ROUND_FACE = {
  id: 'face',
  kind: 'selection',
  label: 'Round Face',
  hint: 'The round side of a post or hole. Click near the end the other part goes on from.',
  filter: ['face'],
  min: 1,
  max: 1,
  prompt: 'Click the round face, near its open end',
  fills: mateOnly,
} as const

const FLIP_END = {
  id: 'flipEnd',
  kind: 'toggle',
  label: 'Other End',
  hint: 'Measure from the other end of the round face.',
  default: false,
} as const

function anchorOf(picks: readonly SelectionPick[]): Vec3 {
  return picks[0]?.point ?? [0, 0, 0]
}

export const snapRingCommand = defineCommand({
  id: 'snapRing',
  label: 'Snap Ring',
  hint: 'A bead round a post that clicks into a groove in a cap or socket, like a pen lid.',
  icon: '◉',
  inputs: [
    ROUND_FACE,
    MATE_INPUT,
    FLIP_END,
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance from End',
      hint: 'Where the bead starts, measured from the open end.',
      default: 2,
      min: 0,
      field: 'distance',
    },
    {
      id: 'bead',
      kind: 'length',
      label: 'Bead Height',
      hint: 'How far the bead stands proud. Around 0.3 to 0.6 mm for printed parts.',
      default: 0.4,
      min: 0,
      exclusiveMin: true,
      field: 'bead',
    },
    {
      id: 'retention',
      kind: 'choice',
      label: 'Catch',
      options: RETENTIONS,
      default: 'removable',
      display: 'buttons',
    },
    {
      id: 'slots',
      kind: 'integer',
      label: 'Flex Slots',
      hint: 'Slits in the end of the post so it can squeeze in. 0 for none.',
      default: 0,
      min: 0,
      max: 12,
    },
    ...fitInputs('snug'),
  ],
  validate: (values, context) => mateProblem(context.doc, values.face[0]?.face?.bodyId, values),
  build(values, context) {
    const face = values.face[0].face!
    const feature: SnapRingFeature = {
      ...fitBase(context, 'snapRing', 'Snap Ring', face.bodyId, values),
      kind: 'snapRing',
      face,
      anchor: anchorOf(values.face),
      flipEnd: values.flipEnd,
      distance: values.distance,
      bead: values.bead,
      retention: values.retention as SnapRetention,
      slots: values.slots,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

export const bayonetCommand = defineCommand({
  id: 'bayonet',
  label: 'Bayonet',
  hint: 'Lugs on one part drop into L-shaped slots in the other and lock with a twist.',
  icon: '⟳',
  inputs: [
    ROUND_FACE,
    MATE_INPUT,
    FLIP_END,
    {
      id: 'distance',
      kind: 'length',
      label: 'Distance from End',
      hint: 'Where the lugs sit, measured from the open end.',
      default: 2,
      min: 0,
      field: 'distance',
    },
    { id: 'lugs', kind: 'integer', label: 'Lugs', default: 3, min: 1, max: 8 },
    {
      id: 'width',
      kind: 'length',
      label: 'Lug Width',
      default: 4,
      min: 0,
      exclusiveMin: true,
      field: 'width',
    },
    {
      id: 'height',
      kind: 'length',
      label: 'Lug Height',
      default: 2,
      min: 0,
      exclusiveMin: true,
      field: 'height',
    },
    {
      id: 'thickness',
      kind: 'length',
      label: 'Lug Depth',
      hint: 'How far each lug sticks out.',
      default: 1.2,
      min: 0,
      exclusiveMin: true,
      field: 'thickness',
    },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Twist',
      hint: 'How far it turns to lock.',
      default: 45,
      min: 0,
      max: 180,
      exclusiveMin: true,
      field: 'angle',
    },
    {
      id: 'detent',
      kind: 'toggle',
      label: 'Click Stop',
      hint: 'A small bump the lug rides over at the end of the turn, so it clicks and stays locked.',
      default: true,
    },
    ...fitInputs('sliding'),
  ],
  validate: (values, context) => mateProblem(context.doc, values.face[0]?.face?.bodyId, values),
  build(values, context) {
    const face = values.face[0].face!
    const feature: BayonetFeature = {
      ...fitBase(context, 'bayonet', 'Bayonet', face.bodyId, values),
      kind: 'bayonet',
      face,
      anchor: anchorOf(values.face),
      flipEnd: values.flipEnd,
      distance: values.distance,
      lugs: values.lugs,
      width: values.width,
      height: values.height,
      thickness: values.thickness,
      angle: values.angle,
      detent: values.detent,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

export const hingeCommand = defineCommand({
  id: 'hinge',
  label: 'Print-in-place Hinge',
  hint: 'Interlocking knuckles printed already joined, so two parts swing without any pin.',
  icon: '⎍',
  inputs: [
    {
      id: 'face',
      kind: 'selection',
      label: 'Face',
      hint: 'The top face of one part, next to the other. The hinge line snaps to the gap between them.',
      filter: ['face'],
      min: 1,
      max: 1,
      prompt: 'Click the top face beside the other part',
      fills: hingePlacement,
    },
    MATE_INPUT,
    { id: 'x', kind: 'length', label: 'Position X', hint: 'Middle of the hinge.', default: 0 },
    { id: 'y', kind: 'length', label: 'Position Y', hint: 'Middle of the hinge.', default: 0 },
    {
      id: 'angle',
      kind: 'angle',
      label: 'Direction',
      hint: 'Which way the hinge line runs.',
      default: 0,
    },
    {
      id: 'length',
      kind: 'length',
      label: 'Length',
      default: 20,
      min: 0,
      exclusiveMin: true,
      field: 'length',
    },
    { id: 'knuckles', kind: 'integer', label: 'Knuckles', default: 5, min: 2, max: 15 },
    {
      id: 'diameter',
      kind: 'length',
      label: 'Diameter',
      default: 5,
      min: 0,
      exclusiveMin: true,
      field: 'diameter',
    },
    ...fitInputs('loose'),
  ],
  validate: (values, context) => mateProblem(context.doc, values.face[0]?.face?.bodyId, values),
  build(values, context) {
    const { face, plane } = facePlane(values.face)
    const feature: HingeFeature = {
      ...fitBase(context, 'hinge', 'Hinge', face.bodyId, values),
      kind: 'hinge',
      plane,
      position: [values.x, values.y],
      angle: values.angle,
      length: values.length,
      knuckles: values.knuckles,
      diameter: values.diameter,
    }
    return [feature]
  },
  derive: deriveFit,
  adjust: (doc, features, _context, values) => adjustFit(doc, features, values),
})

export const FIT_COMMANDS: Readonly<Record<string, AnyCommandSpec>> = {
  snapFit: snapFitCommand as unknown as AnyCommandSpec,
  fitPins: fitPinsCommand as unknown as AnyCommandSpec,
  lipGroove: lipGrooveCommand as unknown as AnyCommandSpec,
  dovetail: dovetailCommand as unknown as AnyCommandSpec,
  snapRing: snapRingCommand as unknown as AnyCommandSpec,
  bayonet: bayonetCommand as unknown as AnyCommandSpec,
  hinge: hingeCommand as unknown as AnyCommandSpec,
}

const DEFAULT_CLASS: Record<string, FitClass> = {
  snapFit: 'snug',
  fitPins: 'press',
  lipGroove: 'snug',
  dovetail: 'sliding',
  snapRing: 'snug',
  bayonet: 'sliding',
  hinge: 'loose',
}

export function fitStartOptions(id: string, faces: readonly SelectionPick[]): CommandStart | null {
  const fit = DEFAULT_CLASS[id]
  if (!fit) return null
  const doc = useStore.getState().doc
  const pick = faces[0]
  const placement = !pick
    ? {}
    : id === 'snapFit'
      ? snapPlacement(pick)
      : id === 'hinge'
        ? hingePlacement(pick)
        : id === 'dovetail'
          ? { ...pointOnFace(pick), ...mateOnly(pick) }
          : mateOnly(pick)
  const face = !pick ? [] : id === 'fitPins' ? [pinPick(pick)] : [pick]
  return { initial: { face, ...placement, fit, gap: classGap(doc, fit) } }
}

function fitShared(doc: OkcDocument, feature: FitFeature) {
  const mate = feature.mateBodyId ? bodyPick(doc, feature.mateBodyId) : null
  return {
    mate: mate ? [mate] : [],
    fit: feature.fitClass ?? 'custom',
    gap: feature.gap,
  }
}

export function fitEditOptions(
  doc: OkcDocument,
  feature: Feature,
): [AnyCommandSpec, CommandStart] | null {
  switch (feature.kind) {
    case 'snapFit':
      return [
        FIT_COMMANDS.snapFit,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            ...fitShared(doc, feature),
            x: feature.position[0],
            y: feature.position[1],
            angle: feature.angle,
            length: feature.length,
            thickness: feature.thickness,
            width: feature.width,
            hookDepth: feature.hookDepth,
            retention: feature.retention,
            material: feature.material,
            through: feature.through,
          },
        },
      ]
    case 'fitPins': {
      if (feature.plane.kind !== 'face') return null
      const frame = useStore.getState().planes.get(feature.id)
      const face = feature.plane.face
      const picks = frame
        ? feature.positions.flatMap((position) => {
            const pick = elementPick(doc, face, undefined, {
              point: frameToWorld(frame, position),
              normal: frame.normal,
            })
            return pick ? [pinPick(pick)] : []
          })
        : planeValues(doc, feature.plane)
      return [
        FIT_COMMANDS.fitPins,
        {
          initial: {
            face: picks,
            ...fitShared(doc, feature),
            diameter: feature.diameter,
            height: feature.height,
          },
        },
      ]
    }
    case 'lipGroove':
      return [
        FIT_COMMANDS.lipGroove,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            ...fitShared(doc, feature),
            width: feature.width,
            height: feature.height,
            inset: feature.inset,
          },
        },
      ]
    case 'dovetail':
      return [
        FIT_COMMANDS.dovetail,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            ...fitShared(doc, feature),
            x: feature.position[0],
            y: feature.position[1],
            angle: feature.angle,
            length: feature.length,
            width: feature.width,
            height: feature.height,
            flankAngle: feature.flankAngle,
            through: feature.through,
          },
        },
      ]
    case 'snapRing':
    case 'bayonet': {
      const pick = elementPick(doc, feature.face, undefined, {
        point: feature.anchor,
        normal: [0, 0, 1],
      })
      const shared = {
        face: pick ? [pick] : [],
        ...fitShared(doc, feature),
        flipEnd: feature.flipEnd,
        distance: feature.distance,
      }
      if (feature.kind === 'snapRing') {
        return [
          FIT_COMMANDS.snapRing,
          {
            initial: {
              ...shared,
              bead: feature.bead,
              retention: feature.retention,
              slots: feature.slots,
            },
          },
        ]
      }
      return [
        FIT_COMMANDS.bayonet,
        {
          initial: {
            ...shared,
            lugs: feature.lugs,
            width: feature.width,
            height: feature.height,
            thickness: feature.thickness,
            angle: feature.angle,
            detent: feature.detent,
          },
        },
      ]
    }
    case 'hinge':
      return [
        FIT_COMMANDS.hinge,
        {
          initial: {
            face: planeValues(doc, feature.plane),
            ...fitShared(doc, feature),
            x: feature.position[0],
            y: feature.position[1],
            angle: feature.angle,
            length: feature.length,
            knuckles: feature.knuckles,
            diameter: feature.diameter,
          },
        },
      ]
  }
  return null
}
