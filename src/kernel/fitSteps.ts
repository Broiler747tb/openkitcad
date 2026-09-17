import {
  basicFaceExtrusion,
  cast,
  downcast,
  draw,
  getOC,
  makeBox,
  makeCylinder,
  makeFace,
  measureVolume,
  Plane,
  Vector,
  Wire,
} from 'replicad'
import { frameToWorld, v3, type Frame, type Vec2, type Vec3 } from '../core/math'
import {
  shortestSnapArm,
  SNAP_LAND,
  SNAP_LEAD_ANGLE,
  SNAP_MATERIALS,
  snapStrain,
  snapStrainLimit,
} from '../doc/fits'
import type {
  BayonetFeature,
  DovetailFeature,
  ElementRef,
  Feature,
  FitFeature,
  FitPinsFeature,
  HingeFeature,
  LipGrooveFeature,
  SnapFitFeature,
  SnapMaterial,
  SnapRetention,
  SnapRingFeature,
} from '../doc/types'
import {
  cut,
  fuse,
  nameShape,
  NamingError,
  resolveElement,
  sampleEdge,
  Scratch,
  subShapes,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import type { SolidStage } from './solidSteps'

const EMBED = 0.2
const REACH = 400
const PROBE = 0.05
const LEAD = Math.tan((SNAP_LEAD_ANGLE * Math.PI) / 180)

type Profile = Array<[number, number]>

interface Step {
  kind: 'fuse' | 'cut'
  solids: any[]
}

interface FitGeometry {
  male: Step[]
  mate: Step[]
}

interface RoundFace {
  frame: Frame
  radius: number
  length: number
  convex: boolean
}

const FIT_KINDS = new Set<Feature['kind']>([
  'snapFit',
  'fitPins',
  'lipGroove',
  'dovetail',
  'snapRing',
  'bayonet',
  'hinge',
])

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function localFrame(frame: Frame, position: Vec2, angle: number): Frame {
  const theta = (angle * Math.PI) / 180
  const u = v3.norm(
    v3.add(v3.scale(frame.xDir, Math.cos(theta)), v3.scale(frame.yDir, Math.sin(theta))),
  )
  return {
    origin: frameToWorld(frame, position),
    xDir: u,
    yDir: v3.cross(frame.normal, u),
    normal: frame.normal,
  }
}

export function place(shape: any, frame: Frame): any {
  const oc = getOC() as any
  const { xDir: x, yDir: y, normal: z, origin: o } = frame
  const trsf = new oc.gp_Trsf_1()
  trsf.SetValues(x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2])
  const builder = new oc.BRepBuilderAPI_Transform_2(shape.wrapped, trsf, true)
  try {
    return cast(builder.ModifiedShape(shape.wrapped))
  } finally {
    builder.delete()
    trsf.delete()
    quietly(shape)
  }
}

function outline(points: Profile) {
  const clean = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 1e-9,
  )
  const pen = draw(clean[0])
  for (const point of clean.slice(1)) pen.lineTo(point)
  return pen.close()
}

function prismAcross(points: Profile, width: number): any {
  const plane = new Plane([0, width / 2, 0], [1, 0, 0], [0, -1, 0])
  return (outline(points).sketchOnPlane(plane) as any).extrude(width)
}

function prismAlong(points: Profile, from: number, to: number): any {
  const plane = new Plane([from, 0, 0], [0, 1, 0], [1, 0, 0])
  return (outline(points).sketchOnPlane(plane) as any).extrude(to - from)
}

function turned(points: Profile, from = 0, span = 360): any {
  const plane = new Plane([0, 0, 0], [1, 0, 0], [0, -1, 0])
  const solid = (outline(points).sketchOnPlane(plane) as any).revolve([0, 0, 1], {
    origin: [0, 0, 0],
    angle: span,
  })
  return from ? solid.rotate(from, [0, 0, 0], [0, 0, 1]) : solid
}

function rodAlongU(radius: number, from: number, to: number): any {
  return makeCylinder(radius, to - from, [from, 0, 0], [1, 0, 0])
}

function overlaps(body: any, solid: any): boolean {
  let common: any
  try {
    common = body.intersect(solid)
    return measureVolume(common) > 1e-3
  } catch {
    return true
  } finally {
    quietly(common)
  }
}

function firstSpan(body: any, frame: Frame, from: number, to: number): [number, number] | null {
  const oc = getOC() as any
  const probe = place(makeBox([from, -PROBE, -PROBE], [to, PROBE, PROBE]), frame)
  let hit: any
  try {
    hit = body.intersect(probe)
  } catch {
    return null
  } finally {
    quietly(probe)
  }
  const scratch = new Scratch()
  try {
    let best: [number, number] | null = null
    for (const solid of subShapes(oc, hit.wrapped, 'TopAbs_SOLID', scratch)) {
      const box = scratch.track(new oc.Bnd_Box_1())
      oc.BRepBndLib.AddOptimal(solid, box, false, false)
      if (box.IsVoid()) continue
      const low = scratch.track(box.CornerMin())
      const high = scratch.track(box.CornerMax())
      let min = Infinity
      let max = -Infinity
      for (const x of [low.X(), high.X()])
        for (const y of [low.Y(), high.Y()])
          for (const z of [low.Z(), high.Z()]) {
            const along = v3.dot(v3.sub([x, y, z], frame.origin), frame.xDir)
            min = Math.min(min, along)
            max = Math.max(max, along)
          }
      if (!best || min < best[0]) best = [min, max]
    }
    return best
  } finally {
    scratch.release()
    quietly(hit)
  }
}

function distanceBetween(a: any, b: any): number | null {
  const oc = getOC() as any
  const progress = new oc.Message_ProgressRange_1()
  const measure = new oc.BRepExtrema_DistShapeShape_1()
  try {
    measure.LoadS1(a.wrapped)
    measure.LoadS2(b.wrapped)
    measure.Perform(progress)
    return measure.IsDone() ? measure.Value() : null
  } catch {
    return null
  } finally {
    measure.delete()
    progress.delete()
  }
}

function faceShape(stage: SolidStage, ref: ElementRef): OcShape | null {
  const body = stage.bodies.get(ref.bodyId)
  if (!body) return null
  const resolution = resolveElement(body.map, {
    bodyId: ref.bodyId,
    kind: 'face',
    name: ref.name,
  })
  if (!resolution.ok) throw new NamingError(resolution.error)
  return resolution.element.shape
}

function roundFace(
  stage: SolidStage,
  ref: ElementRef,
  anchor: Vec3,
  flipEnd: boolean,
): RoundFace | null {
  const oc = getOC() as any
  const shape = faceShape(stage, ref)
  if (!shape) return null
  const scratch = new Scratch()
  const face = scratch.track(oc.TopoDS.Face_1(shape))
  const surface = scratch.track(new oc.BRepAdaptor_Surface_2(face, true))
  try {
    if (surface.GetType() !== (oc.GeomAbs_SurfaceType.GeomAbs_Cylinder as unknown)) {
      stage.report(
        'error',
        'This fit goes on a round face.',
        'Pick the curved side of a round post or a round hole.',
      )
      return null
    }
    const cylinder = scratch.track(surface.Cylinder())
    const axis = scratch.track(cylinder.Axis())
    const location = scratch.track(axis.Location())
    const direction = scratch.track(axis.Direction())
    const radius = cylinder.Radius()
    const origin: Vec3 = [location.X(), location.Y(), location.Z()]
    const dir = v3.norm([direction.X(), direction.Y(), direction.Z()])
    const along = (point: Vec3) => v3.dot(v3.sub(point, origin), dir)
    let low = Infinity
    let high = -Infinity
    for (const edge of subShapes(oc, shape, 'TopAbs_EDGE', scratch)) {
      for (const point of sampleEdge(oc, edge, 5)) {
        low = Math.min(low, along(point))
        high = Math.max(high, along(point))
      }
    }
    if (!(high - low > 1e-6)) {
      stage.report('error', 'This round face has no length to fit anything on.')
      return null
    }
    const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2
    const v = (surface.FirstVParameter() + surface.LastVParameter()) / 2
    const props = scratch.track(new oc.BRepGProp_Face_2(face, false))
    const point = scratch.track(new oc.gp_Pnt_1())
    const normal = scratch.track(new oc.gp_Vec_1())
    props.Normal(u, v, point, normal)
    const onFace: Vec3 = [point.X(), point.Y(), point.Z()]
    const radial = v3.sub(onFace, v3.add(origin, v3.scale(dir, along(onFace))))
    const convex = v3.dot(radial, [normal.X(), normal.Y(), normal.Z()]) > 0
    const at = along(anchor)
    const fromLow = Math.abs(at - low) <= Math.abs(high - at) ? !flipEnd : flipEnd
    const z = fromLow ? dir : v3.scale(dir, -1)
    const base = v3.add(origin, v3.scale(dir, fromLow ? low : high))
    const offset = v3.sub(anchor, base)
    let x = v3.sub(offset, v3.scale(z, v3.dot(offset, z)))
    if (v3.len(x) < 1e-6) x = v3.cross(z, Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
    x = v3.norm(x)
    return {
      frame: { origin: base, xDir: x, yDir: v3.cross(z, x), normal: z },
      radius,
      length: high - low,
      convex,
    }
  } finally {
    scratch.release()
  }
}

function positive(stage: Pick<SolidStage, 'report'>, values: Record<string, number>): boolean {
  const bad = Object.entries(values).filter(([, value]) => !(value > 0))
  if (!bad.length) return true
  stage.report(
    'error',
    `${bad.map(([name]) => name).join(', ')} ${bad.length > 1 ? 'have' : 'has'} to be above zero.`,
  )
  return false
}

function gapOk(stage: Pick<SolidStage, 'report'>, gap: number): boolean {
  if (gap >= 0 && gap <= 5) return true
  stage.report('error', 'The gap has to be between 0 and 5 mm.')
  return false
}

function mateShape(stage: SolidStage, feature: FitFeature): any {
  return feature.mateBodyId ? (stage.bodies.get(feature.mateBodyId)?.shape ?? null) : null
}

export interface HookSize {
  length: number
  thickness: number
  width: number
  hookDepth: number
  retention: SnapRetention
}

export function hookArmEnd(size: HookSize): number {
  const back = size.retention === 'removable' ? size.hookDepth : 0
  return size.length - size.hookDepth / LEAD - SNAP_LAND - back
}

export function checkHook(
  stage: Pick<SolidStage, 'report'>,
  size: HookSize & { material: SnapMaterial },
  gap: number,
): boolean {
  const { thickness: t, width: w, length: l, hookDepth: h } = size
  if (
    !positive(stage, { Length: l, Thickness: t, Width: w, 'Hook depth': h }) ||
    !gapOk(stage, gap)
  ) {
    return false
  }
  const back = size.retention === 'removable' ? h : 0
  if (hookArmEnd(size) < t) {
    stage.report(
      'error',
      'The arm is too short for a hook this deep.',
      `Make it at least ${(h / LEAD + SNAP_LAND + back + t).toFixed(1)} mm long, or the hook shallower.`,
    )
    return false
  }
  const strain = snapStrain(size)
  const limit = snapStrainLimit(size.material)
  if (strain > limit) {
    const material = SNAP_MATERIALS.find((entry) => entry.value === size.material)?.label
    stage.report(
      'warning',
      `This hook bends ${(strain * 100).toFixed(1)}% as it clicks in, more than ${material ?? 'the plastic'} takes (${(limit * 100).toFixed(0)}%), so it may crack.`,
      `Make the arm at least ${shortestSnapArm(size).toFixed(1)} mm long, thinner, or the hook shallower.`,
    )
  }
  return true
}

export function hookSolids(
  frame: Frame,
  size: HookSize,
  gap: number,
  depth: number,
  outerRoot: boolean,
): { arm: any; cuts: any[] } {
  const { thickness: t, width: w, length: l, hookDepth: h } = size
  const g = gap
  const back = size.retention === 'removable' ? h : 0
  const armEnd = hookArmEnd(size)
  const root = Math.min(t * 0.5, armEnd * 0.3)
  const tip: Profile = [
    [0, armEnd],
    [h, armEnd + back],
    [h, armEnd + back + SNAP_LAND],
    [0, l],
    [-t, l],
    [-t, root],
    [-t - root, 0],
  ]
  const foot: Profile = outerRoot
    ? [
        [-t - root, -EMBED],
        [root, -EMBED],
        [root, 0],
        [0, root],
      ]
    : [
        [-t - root, -EMBED],
        [0, -EMBED],
      ]
  const arm = place(prismAcross([...foot, ...tip], w), frame)
  const cuts = [
    place(makeBox([-t - root - h - g, -w / 2 - g, -EMBED], [g, w / 2 + g, l + g]), frame),
  ]
  if (outerRoot) {
    cuts.push(
      place(
        prismAcross(
          [
            [-g, -EMBED],
            [root + 2 * g + EMBED, -EMBED],
            [-g, root + 3 * g],
          ],
          w + 2 * g,
        ),
        frame,
      ),
    )
  }
  cuts.push(place(makeBox([-g, -w / 2 - g, armEnd - g], [depth, w / 2 + g, l + g]), frame))
  return { arm, cuts }
}

function snapFitGeometry(stage: SolidStage, feature: SnapFitFeature): FitGeometry | null {
  const { length: l, hookDepth: h, gap: g } = feature
  if (!checkHook(stage, feature, g)) return null
  const armEnd = hookArmEnd(feature)
  const frame = localFrame(stage.planeOf(feature.plane), feature.position, feature.angle)
  const mate = mateShape(stage, feature)
  let depth = h + g
  if (mate) {
    const hookFrame = {
      ...frame,
      origin: v3.add(frame.origin, v3.scale(frame.normal, (armEnd + l) / 2)),
    }
    const span = firstSpan(mate, hookFrame, -g, REACH)
    if (!span || span[0] > h - 1e-3) {
      stage.report(
        'warning',
        `The hook does not reach ${stage.bodyName(feature.mateBodyId!)}.`,
        'Put the arm against a wall of the other part, with the hook pointing into the wall.',
      )
    } else if (feature.through) {
      depth = Math.max(depth, span[1] + 0.5)
    }
  }
  const { arm, cuts } = hookSolids(frame, feature, g, depth, true)
  return {
    male: [{ kind: 'fuse', solids: [arm] }],
    mate: [{ kind: 'cut', solids: cuts }],
  }
}

function pinsGeometry(stage: SolidStage, feature: FitPinsFeature): FitGeometry | null {
  const radius = feature.diameter / 2
  const height = feature.height
  const g = feature.gap
  if (!positive(stage, { Diameter: radius, Height: height }) || !gapOk(stage, g)) return null
  if (!feature.positions.length) {
    stage.report('error', 'There are no pins to place.', 'Click the face where each pin goes.')
    return null
  }
  const base = stage.planeOf(feature.plane)
  const chamfer = Math.min(radius * 0.4, 0.6, height * 0.3)
  const entry = Math.min(0.4, radius * 0.3)
  const socket = radius + g
  const floor = height + Math.max(0.3, g)
  const mate = mateShape(stage, feature)
  const pins: any[] = []
  const sockets: any[] = []
  let missed = 0
  let shallow = 0
  for (const position of feature.positions) {
    const frame = localFrame(base, position, 0)
    pins.push(
      place(
        turned([
          [0, -EMBED],
          [radius, -EMBED],
          [radius, height - chamfer],
          [radius - chamfer, height],
          [0, height],
        ]),
        frame,
      ),
    )
    sockets.push(
      place(
        turned([
          [0, -EMBED],
          [socket + entry + EMBED, -EMBED],
          [socket, entry],
          [socket, floor],
          [0, floor],
        ]),
        frame,
      ),
    )
    if (mate) {
      const upFrame = {
        origin: frame.origin,
        xDir: frame.normal,
        yDir: frame.xDir,
        normal: frame.yDir,
      }
      const span = firstSpan(mate, upFrame, -EMBED, REACH)
      if (!span || span[0] > height * 0.5) missed++
      else if (span[1] < floor + 0.4) shallow++
    }
  }
  const mateName = feature.mateBodyId ? stage.bodyName(feature.mateBodyId) : ''
  if (missed) {
    stage.report(
      'warning',
      `${missed === feature.positions.length ? 'The pins miss' : `${missed} of the pins miss`} ${mateName}.`,
      'The other part has to sit right against this face where the pins are.',
    )
  }
  if (shallow) {
    stage.report(
      'warning',
      `${mateName} is too thin for ${shallow === 1 ? 'a socket this deep' : 'sockets this deep'}, so the pins will show through.`,
      'Make the pins shorter, or the other part thicker there.',
    )
  }
  return {
    male: [{ kind: 'fuse', solids: pins }],
    mate: [{ kind: 'cut', solids: sockets }],
  }
}

function wireSize(wire: any): number {
  const box = wire.boundingBox
  try {
    return box.width + box.height + box.depth
  } finally {
    quietly(box)
  }
}

function insetWire(outer: any, distance: number): any {
  if (Math.abs(distance) < 1e-9) return outer.clone()
  const size = wireSize(outer)
  const first = outer.clone().offset2D(-distance)
  if (wireSize(first) < size === distance > 0) return first
  quietly(first)
  return outer.clone().offset2D(distance)
}

function band(outer: any, near: number, far: number, from: number, to: number, normal: Vec3): any {
  const prism = (distance: number) => {
    const wire = insetWire(outer, distance)
    const face = makeFace(wire)
    quietly(wire)
    const lifted = face.translate(v3.scale(normal, from))
    const direction = new Vector(v3.scale(normal, to - from))
    try {
      return basicFaceExtrusion(lifted, direction)
    } finally {
      quietly(direction)
      quietly(lifted)
    }
  }
  const outside = prism(near)
  const inside = prism(far)
  try {
    return outside.cut(inside)
  } finally {
    quietly(outside)
    quietly(inside)
  }
}

function lipGeometry(stage: SolidStage, feature: LipGrooveFeature): FitGeometry | null {
  const { width, height, inset, gap: g } = feature
  if (!positive(stage, { Width: width, Height: height }) || !gapOk(stage, g)) return null
  if (!(inset >= 0)) {
    stage.report('error', 'The inset cannot be negative.')
    return null
  }
  if (feature.plane.kind !== 'face') {
    stage.report('error', 'A lip runs round a face.', 'Pick the face where the two parts meet.')
    return null
  }
  const oc = getOC() as any
  const frame = stage.planeOf(feature.plane)
  const shape = faceShape(stage, feature.plane.face)
  if (!shape) return null
  const faceCast = oc.TopoDS.Face_1(shape)
  const outer = new Wire(oc.BRepTools.OuterWire(faceCast))
  faceCast.delete()
  try {
    let lip: any
    let groove: any
    try {
      lip = band(outer, inset, inset + width, -EMBED, height, frame.normal)
      groove = band(outer, inset - g, inset + width + g, -EMBED, height + g, frame.normal)
    } catch {
      quietly(lip)
      stage.report(
        'error',
        'The lip does not fit inside this face.',
        'Make it narrower, or bring it in less with Inset.',
      )
      return null
    }
    const male = stage.bodies.get(feature.bodyId)?.shape
    if (male) {
      const foot = band(outer, inset, inset + width, -EMBED, 0, frame.normal)
      let common: any
      try {
        const whole = measureVolume(foot)
        common = male.intersect(foot)
        if (whole > 0 && measureVolume(common) < whole * 0.98) {
          stage.report(
            'warning',
            'The lip is wider than the edge it stands on, so part of it hangs in the air.',
            'Make it narrower, or move it in with Inset so it stays on the wall.',
          )
        }
      } catch {
        common = null
      } finally {
        quietly(common)
        quietly(foot)
      }
    }
    const mate = mateShape(stage, feature)
    if (mate && !overlaps(mate, groove)) {
      stage.report(
        'warning',
        `The groove does not reach ${stage.bodyName(feature.mateBodyId!)}.`,
        'The other part has to sit on this face.',
      )
    }
    return {
      male: [{ kind: 'fuse', solids: [lip] }],
      mate: [{ kind: 'cut', solids: [groove] }],
    }
  } finally {
    quietly(outer)
  }
}

function dovetailGeometry(stage: SolidStage, feature: DovetailFeature): FitGeometry | null {
  const { length: l, width: w, height: h, flankAngle, gap: g } = feature
  if (!positive(stage, { Length: l, Width: w, Height: h }) || !gapOk(stage, g)) return null
  if (!(flankAngle >= 0 && flankAngle <= 40)) {
    stage.report('error', 'The flank angle has to be between 0° and 40°.')
    return null
  }
  const frame = localFrame(stage.planeOf(feature.plane), feature.position, feature.angle)
  const tan = Math.tan((flankAngle * Math.PI) / 180)
  const sec = 1 / Math.cos((flankAngle * Math.PI) / 180)
  const a = w / 2
  const b = a + h * tan
  const rail = place(
    prismAlong(
      [
        [-a, -EMBED],
        [a, -EMBED],
        [a, 0],
        [b, h],
        [-b, h],
        [-a, 0],
      ],
      -l / 2,
      l / 2,
    ),
    frame,
  )
  const half = (z: number) => a + z * tan + g * sec
  const top = h + g
  const slot = place(
    prismAlong(
      [
        [-half(-EMBED), -EMBED],
        [half(-EMBED), -EMBED],
        [half(top), top],
        [-half(top), top],
      ],
      -l / 2 - REACH,
      l / 2 + (feature.through ? REACH : g),
    ),
    frame,
  )
  const mate = mateShape(stage, feature)
  if (mate) {
    const probe = place(
      prismAlong(
        [
          [-half(0), 0],
          [half(0), 0],
          [half(top), top],
          [-half(top), top],
        ],
        -l / 2,
        l / 2,
      ),
      frame,
    )
    if (!overlaps(mate, probe)) {
      stage.report(
        'warning',
        `The slot does not reach ${stage.bodyName(feature.mateBodyId!)}.`,
        'The other part has to sit on this face over the rail.',
      )
    }
    quietly(probe)
  }
  return {
    male: [{ kind: 'fuse', solids: [rail] }],
    mate: [{ kind: 'cut', solids: [slot] }],
  }
}

function snapRingGeometry(stage: SolidStage, feature: SnapRingFeature): FitGeometry | null {
  const { distance: d, bead: b, gap: g } = feature
  if (!positive(stage, { Bead: b }) || !gapOk(stage, g)) return null
  if (!(d >= 0)) {
    stage.report('error', 'The distance from the end cannot be negative.')
    return null
  }
  const round = roundFace(stage, feature.face, feature.anchor, feature.flipEnd)
  if (!round) return null
  const { frame, radius: R, length: L, convex } = round
  const lead = b / LEAD
  const back = feature.retention === 'removable' ? b : 0
  const crest = d + lead + SNAP_LAND
  const tail = crest + back
  if (tail > L + 1e-6) {
    stage.report(
      'error',
      'The bead runs past the end of the round face.',
      `Bring it within ${Math.max(0, L - (tail - d)).toFixed(1)} mm of the end, or make it smaller.`,
    )
    return null
  }
  if (!convex && b + g >= R) {
    stage.report('error', 'The bead is deeper than the hole is wide.')
    return null
  }
  const side = convex ? 1 : -1
  const r = (offset: number) => R + side * offset
  const place3 = (points: Profile) => place(turned(points), frame)
  const bead = place3([
    [r(-EMBED), d],
    [r(0), d],
    [r(b), d + lead],
    [r(b), crest],
    [r(0), tail],
    [r(-EMBED), tail],
  ])
  const groove = place3([
    [r(-EMBED), d - g],
    [r(g), d - g],
    [r(b + g), d + lead],
    [r(b + g), crest + g],
    [r(g), tail + g],
    [r(-EMBED), tail + g],
  ])
  const sleeve = place3([
    [r(-EMBED), 0],
    [r(g), 0],
    [r(g), L],
    [r(-EMBED), L],
  ])
  const slots = Math.max(0, Math.min(12, Math.round(feature.slots)))
  const slits: any[] = []
  if (slots && !convex) {
    stage.report(
      'warning',
      'Slots only work on a round post, so none were cut.',
      'Put the bead on the post instead of in the hole if it needs to flex.',
    )
  } else if (slots) {
    const width = Math.min(1, R * 0.3)
    const reach = Math.min(L, tail + Math.max(4, 2 * (tail - d)))
    for (let i = 0; i < slots; i++) {
      const slit = makeBox([-width, -width / 2, -EMBED], [R + b + 1, width / 2, reach]).rotate(
        (360 * i) / slots,
        [0, 0, 0],
        [0, 0, 1],
      )
      slits.push(place(slit, frame))
    }
  }
  const mate = mateShape(stage, feature)
  if (mate && !overlaps(mate, groove)) {
    stage.report(
      'warning',
      `The groove does not reach ${stage.bodyName(feature.mateBodyId!)}.`,
      convex
        ? 'The other part has to fit round this post.'
        : 'The other part has to fit inside this hole.',
    )
  }
  return {
    male: [
      { kind: 'fuse', solids: [bead] },
      { kind: 'cut', solids: slits },
    ],
    mate: [{ kind: 'cut', solids: [sleeve, groove] }],
  }
}

function bayonetGeometry(stage: SolidStage, feature: BayonetFeature): FitGeometry | null {
  const { distance: d, width: w, height: h, thickness: t, angle: twist, gap: g } = feature
  const lugs = Math.round(feature.lugs)
  if (
    !positive(stage, { Width: w, Height: h, Thickness: t, 'Twist angle': twist }) ||
    !gapOk(stage, g)
  ) {
    return null
  }
  if (!(lugs >= 1 && lugs <= 8)) {
    stage.report('error', 'Use between 1 and 8 lugs.')
    return null
  }
  if (!(d >= 0)) {
    stage.report('error', 'The distance from the end cannot be negative.')
    return null
  }
  const round = roundFace(stage, feature.face, feature.anchor, feature.flipEnd)
  if (!round) return null
  const { frame, radius: R, length: L, convex } = round
  if (d + h + g > L + 1e-6) {
    stage.report(
      'error',
      'The lugs run past the end of the round face.',
      `Keep Distance plus Height under ${(L - g).toFixed(1)} mm.`,
    )
    return null
  }
  if (!convex && t + g >= R) {
    stage.report('error', 'The lugs stick out further than the hole is wide.')
    return null
  }
  const degrees = (length: number) => (length / R) * (180 / Math.PI)
  const span = degrees(w)
  const clear = degrees(g)
  const pitch = 360 / lugs
  if (span + twist + 2 * clear >= pitch - degrees(1)) {
    stage.report(
      'error',
      'The lugs and their twist do not fit round the face.',
      'Use fewer or narrower lugs, or a smaller twist angle.',
    )
    return null
  }
  const side = convex ? 1 : -1
  const r = (offset: number) => R + side * offset
  const ring = (inner: number, outer: number, from: number, to: number): Profile => [
    [r(inner), from],
    [r(outer), from],
    [r(outer), to],
    [r(inner), to],
  ]
  const male: any[] = []
  const channels: any[] = []
  const bumps: any[] = []
  const bump = degrees(0.8)
  const detent = feature.detent && twist >= span + 2 * clear + bump
  if (feature.detent && !detent) {
    stage.report(
      'warning',
      'The twist is too short for a click stop, so none was added.',
      `Turn at least ${(span + 2 * clear + bump).toFixed(0)}° to fit one.`,
    )
  }
  for (let i = 0; i < lugs; i++) {
    const at = i * pitch
    male.push(place(turned(ring(-EMBED, t, d, d + h), at - span / 2, span), frame))
    channels.push(
      place(
        turned(ring(-EMBED, t + g, d - g, L + 1), at - twist - span / 2 - clear, span + 2 * clear),
        frame,
      ),
      place(
        turned(
          ring(-EMBED, t + g, d - g, d + h + g),
          at - twist - span / 2 - clear,
          twist + span + 2 * clear,
        ),
        frame,
      ),
    )
    if (detent) {
      bumps.push(
        place(
          turned(
            ring(g + 0.1, t + g + EMBED, d + h - 0.25, d + h + g + EMBED),
            at - span / 2 - clear - bump,
            bump,
          ),
          frame,
        ),
      )
    }
  }
  const sleeve = place(turned(ring(-EMBED, g, 0, L)), frame)
  const mate = mateShape(stage, feature)
  if (mate && !overlaps(mate, channels[1])) {
    stage.report(
      'warning',
      `The lug slots do not reach ${stage.bodyName(feature.mateBodyId!)}.`,
      convex
        ? 'The other part has to fit round this post.'
        : 'The other part has to fit inside this hole.',
    )
  }
  return {
    male: [{ kind: 'fuse', solids: male }],
    mate: [
      { kind: 'cut', solids: [sleeve, ...channels] },
      { kind: 'fuse', solids: bumps },
    ],
  }
}

export interface HingeSize {
  length: number
  knuckles: number
  diameter: number
}

export interface HingeKnuckles {
  solids: any[]
  clearances: any[]
  cones: any[]
  sockets: any[]
}

function hingeCone(size: HingeSize): number {
  return Math.min((size.diameter / 2) * 0.45, (size.length / Math.round(size.knuckles)) * 0.35)
}

export function checkHinge(
  stage: Pick<SolidStage, 'report'>,
  size: HingeSize,
  gap: number,
): boolean {
  const knuckles = Math.round(size.knuckles)
  if (!positive(stage, { Length: size.length, Diameter: size.diameter }) || !gapOk(stage, gap)) {
    return false
  }
  if (!(knuckles >= 2 && knuckles <= 15)) {
    stage.report('error', 'Use between 2 and 15 knuckles.')
    return false
  }
  const cone = hingeCone(size)
  if (size.length / knuckles < 2 * gap + 2 * cone || cone < 0.4) {
    stage.report(
      'error',
      'The knuckles are too short for this diameter and gap.',
      'Use fewer knuckles, a longer hinge, or a smaller gap.',
    )
    return false
  }
  return true
}

export function hingeSolids(
  frame: Frame,
  size: HingeSize,
  gap: number,
): { mine: HingeKnuckles; theirs: HingeKnuckles } {
  const l = size.length
  const g = gap
  const knuckles = Math.round(size.knuckles)
  const pitch = l / knuckles
  const radius = size.diameter / 2
  const cone = hingeCone(size)
  const coneFrame = (at: number, forward: boolean): Frame => ({
    origin: v3.add(frame.origin, v3.scale(frame.xDir, at)),
    xDir: frame.yDir,
    yDir: forward ? frame.normal : v3.scale(frame.normal, -1),
    normal: forward ? frame.xDir : v3.scale(frame.xDir, -1),
  })
  const reach = cone + g * Math.SQRT2
  const knucklesOf = (own: 0 | 1): HingeKnuckles => {
    const solids: any[] = []
    const clearances: any[] = []
    const cones: any[] = []
    const sockets: any[] = []
    for (let i = 0; i < knuckles; i++) {
      if (i % 2 !== own) continue
      const start = -l / 2 + i * pitch
      const end = start + pitch
      const from = start + (i > 0 ? g / 2 : 0)
      const to = end - (i < knuckles - 1 ? g / 2 : 0)
      solids.push(place(rodAlongU(radius, from, to), frame))
      clearances.push(
        place(
          rodAlongU(
            radius + g,
            i > 0 ? start - g / 2 : from - g,
            i < knuckles - 1 ? end + g / 2 : to + g,
          ),
          frame,
        ),
      )
      if (own !== 0) continue
      for (const [neighbour, at, forward] of [
        [i + 1, to, true],
        [i - 1, from, false],
      ] as const) {
        if (neighbour < 0 || neighbour >= knuckles) continue
        cones.push(
          place(
            turned([
              [0, -EMBED],
              [cone, -EMBED],
              [cone, 0],
              [0, cone],
            ]),
            coneFrame(at, forward),
          ),
        )
        sockets.push(
          place(
            turned([
              [0, -EMBED],
              [reach + EMBED, -EMBED],
              [0, reach],
            ]),
            coneFrame(at, forward),
          ),
        )
      }
    }
    return { solids, clearances, cones, sockets }
  }
  return { mine: knucklesOf(0), theirs: knucklesOf(1) }
}

function hingeGeometry(stage: SolidStage, feature: HingeFeature): FitGeometry | null {
  const g = feature.gap
  if (!checkHinge(stage, feature, g)) return null
  const frame = localFrame(stage.planeOf(feature.plane), feature.position, feature.angle)
  const { mine, theirs } = hingeSolids(frame, feature, g)
  const male = stage.bodies.get(feature.bodyId)?.shape
  const mate = mateShape(stage, feature)
  if (male && !overlaps(male, mine.solids[0])) {
    stage.report(
      'warning',
      `The hinge knuckles do not reach ${stage.bodyName(feature.bodyId)}.`,
      'Put the hinge line on the edge where the two parts meet.',
    )
  }
  if (mate && theirs.solids.length && !overlaps(mate, theirs.solids[0])) {
    stage.report(
      'warning',
      `The hinge knuckles do not reach ${stage.bodyName(feature.mateBodyId!)}.`,
      'Put the other part right next to this one along the hinge line.',
    )
  }
  if (male && mate) {
    const apart = distanceBetween(male, mate)
    if (apart !== null && apart < g - 1e-3) {
      stage.report(
        'warning',
        `${stage.bodyName(feature.bodyId)} and ${stage.bodyName(feature.mateBodyId!)} are closer than the hinge gap, so they may print stuck together.`,
        `Leave at least ${g.toFixed(2)} mm between them.`,
      )
    }
  }
  return {
    male: [
      { kind: 'cut', solids: theirs.clearances },
      { kind: 'fuse', solids: [...mine.solids, ...mine.cones] },
    ],
    mate: [
      { kind: 'cut', solids: mine.clearances },
      { kind: 'fuse', solids: theirs.solids },
      { kind: 'cut', solids: mine.sockets },
    ],
  }
}

function geometryOf(stage: SolidStage, feature: FitFeature): FitGeometry | null {
  switch (feature.kind) {
    case 'snapFit':
      return snapFitGeometry(stage, feature)
    case 'fitPins':
      return pinsGeometry(stage, feature)
    case 'lipGroove':
      return lipGeometry(stage, feature)
    case 'dovetail':
      return dovetailGeometry(stage, feature)
    case 'snapRing':
      return snapRingGeometry(stage, feature)
    case 'bayonet':
      return bayonetGeometry(stage, feature)
    case 'hinge':
      return hingeGeometry(stage, feature)
  }
}

function release(named: NamedShape): void {
  named.map.dispose()
  named.shape.delete()
}

function applySteps(
  oc: OC,
  stage: SolidStage,
  feature: FitFeature,
  bodyId: string,
  steps: Step[],
  role: string,
): void {
  const live = steps.filter((step) => step.solids.length)
  if (!live.length) return
  const body = stage.need(bodyId)
  if (!body) return
  let current: NamedShape = { shape: body.shape.wrapped, map: body.map }
  let owned = false
  try {
    live.forEach((step, stepIndex) => {
      const tools = step.solids.map((solid, index) =>
        nameShape(
          oc,
          `${feature.id}:${role}${stepIndex}-${index}`,
          downcast(solid.wrapped) as unknown as OcShape,
        ),
      )
      try {
        let next: NamedShape
        try {
          next = (step.kind === 'fuse' ? fuse : cut)(oc, {
            featureId: feature.id,
            target: current,
            tools,
          })
        } catch (error) {
          if (error instanceof Error) throw error
          throw new Error(
            step.kind === 'fuse'
              ? `Could not join the fit onto ${stage.bodyName(bodyId)}.`
              : `Could not cut the fit into ${stage.bodyName(bodyId)}.`,
          )
        }
        if (owned) release(current)
        current = next
        owned = true
      } finally {
        tools.forEach(release)
      }
    })
  } catch (error) {
    if (owned) release(current)
    throw error
  }
  stage.set(bodyId, current)
}

export function runFitStep(feature: Feature, stage: SolidStage): boolean {
  if (!FIT_KINDS.has(feature.kind)) return false
  const fit = feature as FitFeature
  const oc = getOC() as unknown as OC
  if (fit.mateBodyId && fit.mateBodyId === fit.bodyId) {
    stage.report(
      'error',
      'The fit and its other half are on the same body.',
      'Pick the other part as the mating body.',
    )
    return true
  }
  if (!stage.need(fit.bodyId)) return true
  if (fit.mateBodyId && !stage.need(fit.mateBodyId)) return true
  const geometry = geometryOf(stage, fit)
  if (!geometry) return true
  try {
    applySteps(oc, stage, fit, fit.bodyId, geometry.male, 'fit')
    if (fit.mateBodyId) applySteps(oc, stage, fit, fit.mateBodyId, geometry.mate, 'mate')
  } finally {
    for (const step of [...geometry.male, ...geometry.mate]) step.solids.forEach(quietly)
  }
  return true
}
