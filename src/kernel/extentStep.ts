import { v3, type Frame, type Vec3 } from '../core/math'
import type { ExtentKind, ExtentTarget, ExtrudeFeature, PlaneRef } from '../doc/types'
import type { Sketch2D } from '../sketch/types'
import { exactBounds, type Bounds } from './bounds'
import {
  cut,
  draft,
  extrude,
  facePlane,
  fuse,
  nameShape,
  readShapes,
  NamingError,
  releaseNamedShape,
  resolveElement,
  Scratch,
  subShapes,
  type ElementMap,
  type ElementReference,
  type NamedShape,
  type OC,
  type OcShape,
  type PieceSample,
} from './naming'

export interface ExtentBody {
  shape: any
  map: ElementMap<OcShape>
}

export interface ExtentInput {
  oc: OC
  feature: ExtrudeFeature
  sketch: Sketch2D
  pieces?: readonly PieceSample[]
  frame: Frame
  face: (at: Frame) => any
  bodies: ReadonlyMap<string, ExtentBody>
  plane: (ref: PlaneRef) => Frame
  bodyName: (id: string) => string
}

interface Side {
  id: string
  direction: Vec3
  extent: ExtentKind
  distance: number
  to?: ExtentTarget
  taper: number
  flippable: boolean
}

interface Stop {
  direction: Vec3
  length: number
  what: string
  halfSpace?: OcShape
  target?: OcShape
}

const TOLERANCE = 1e-6

function shifted(frame: Frame, along: number): Frame {
  return along ? { ...frame, origin: v3.add(frame.origin, v3.scale(frame.normal, along)) } : frame
}

function corners(bounds: Bounds): Vec3[] {
  const out: Vec3[] = []
  for (const x of [bounds[0], bounds[3]]) {
    for (const y of [bounds[1], bounds[4]]) {
      for (const z of [bounds[2], bounds[5]]) out.push([x, y, z])
    }
  }
  return out
}

function span(bounds: Bounds, origin: Vec3, direction: Vec3): [number, number] {
  const along = corners(bounds).map((corner) => v3.dot(v3.sub(corner, origin), direction))
  return [Math.min(...along), Math.max(...along)]
}

function diagonal(bounds: Bounds): number {
  return Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
}

function margin(length: number): number {
  return Math.max(1, Math.abs(length) * 0.01)
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function startFrame(input: ExtentInput): Frame {
  const { feature, frame } = input
  const start = feature.start ?? 'profile'
  if (start === 'offset') return shifted(frame, feature.startOffset ?? 0)
  if (start !== 'object') return frame
  if (!feature.startPlane) throw new Error('Pick the face or plane to start from.')
  const plane = input.plane(feature.startPlane)
  if (Math.abs(Math.abs(v3.dot(plane.normal, frame.normal)) - 1) > 1e-6) {
    throw new Error('Start from a face or plane parallel to the sketch.')
  }
  return shifted(frame, v3.dot(v3.sub(plane.origin, frame.origin), frame.normal))
}

function sidesOf(feature: ExtrudeFeature, normal: Vec3): Side[] {
  const flip = feature.reverse ? -1 : 1
  if (feature.symmetric) {
    const half = feature.halfLength ? Math.abs(feature.distance) : Math.abs(feature.distance) / 2
    const extent: ExtentKind = feature.extent === 'all' ? 'all' : 'distance'
    const taper = feature.draftAngle ?? 0
    return [
      { id: feature.id, direction: normal, extent, distance: half, taper, flippable: false },
      {
        id: `${feature.id}~2`,
        direction: v3.scale(normal, -1),
        extent,
        distance: half,
        taper,
        flippable: false,
      },
    ]
  }
  const extent = feature.extent ?? 'distance'
  const sign = extent === 'distance' && feature.distance < 0 ? -1 : 1
  const one: Side = {
    id: feature.id,
    direction: v3.scale(normal, flip * sign),
    extent,
    distance: Math.abs(feature.distance),
    to: feature.to,
    taper: feature.draftAngle ?? 0,
    flippable: !feature.twoSided,
  }
  if (!feature.twoSided) return [one]
  const secondExtent = feature.secondExtent ?? 'distance'
  const secondDistance = feature.secondDistance ?? feature.distance
  const secondSign = secondExtent === 'distance' && secondDistance < 0 ? -1 : 1
  return [
    one,
    {
      id: `${feature.id}~2`,
      direction: v3.scale(normal, -flip * secondSign),
      extent: secondExtent,
      distance: Math.abs(secondDistance),
      to: feature.secondTo,
      taper: feature.secondDraftAngle ?? 0,
      flippable: false,
    },
  ]
}

function prism(input: ExtentInput, at: Frame, id: string, vector: Vec3): NamedShape {
  return extrude(input.oc, {
    featureId: id,
    profile: input.face(at).wrapped,
    sketch: input.sketch,
    pieces: input.pieces,
    frame: at,
    vector,
  })
}

function plainPrism(input: ExtentInput, base: Frame, sides: Side[]): NamedShape {
  const [one, two] = sides
  if (!two) return prism(input, base, input.feature.id, v3.scale(one.direction, one.distance))
  const normal = base.normal
  const ends = sides.map((side) => v3.dot(side.direction, normal) * side.distance)
  const low = Math.min(0, ...ends)
  const high = Math.max(0, ...ends)
  if (high - low < TOLERANCE) throw new Error('The two sides cancel each other out.')
  return prism(input, shifted(base, low), input.feature.id, v3.scale(normal, high - low))
}

function replaced(previous: NamedShape, next: NamedShape): NamedShape {
  releaseNamedShape(previous)
  return next
}

function hasCap(oc: OC, shape: OcShape, base: Frame, direction: Vec3, at: number): boolean {
  const scratch = new Scratch()
  try {
    return subShapes(oc, shape, 'TopAbs_FACE', scratch).some((face) => {
      const plane = facePlane(oc, face)
      if (!plane) return false
      if (Math.abs(Math.abs(v3.dot(v3.norm(plane.normal), direction)) - 1) > 1e-7) return false
      const offset = v3.dot(v3.sub(plane.origin, base.origin), direction)
      return Math.abs(offset - at) < 1e-5 * Math.max(1, Math.abs(at))
    })
  } finally {
    scratch.release()
  }
}

function taper(
  oc: OC,
  solid: NamedShape,
  id: string,
  base: Frame,
  direction: Vec3,
  angle: number,
): NamedShape {
  const sides = solid.map.elements('face').filter((element) => {
    const plane = facePlane(oc, element.shape)
    return !plane || Math.abs(Math.abs(v3.dot(v3.norm(plane.normal), direction)) - 1) > 1e-9
  })
  return draft(oc, {
    featureId: id,
    bodyId: id,
    body: solid,
    faces: sides.map((element) => element.name),
    pullDirection: direction,
    angle: -angle,
    neutralPlane: { origin: base.origin, normal: direction },
    keepNames: true,
  })
}

function halfSpaceBeyond(oc: OC, origin: Vec3, outward: Vec3, size: number): OcShape {
  const scratch = new Scratch()
  const ocAny = oc as any
  try {
    const across = v3.norm(
      Math.abs(outward[2]) < 0.9 ? v3.cross(outward, [0, 0, 1]) : v3.cross(outward, [1, 0, 0]),
    )
    const other = v3.cross(outward, across)
    const corner = v3.sub(origin, v3.add(v3.scale(across, size), v3.scale(other, size)))
    const axes = scratch.track(
      new ocAny.gp_Ax2_2(
        scratch.track(new ocAny.gp_Pnt_3(...corner)),
        scratch.track(new ocAny.gp_Dir_4(...outward)),
        scratch.track(new ocAny.gp_Dir_4(...across)),
      ),
    )
    const box = scratch.track(new ocAny.BRepPrimAPI_MakeBox_5(axes, 2 * size, 2 * size, size))
    return box.Shape()
  } finally {
    scratch.release()
  }
}

function beyond(oc: OC, prism: OcShape, target: OcShape, base: Frame, stop: Stop): OcShape {
  const scratch = new Scratch()
  const ocAny = oc as any
  try {
    const builder = scratch.track(new ocAny.BRepAlgoAPI_BuilderAlgo_1())
    const list = scratch.track(new ocAny.TopTools_ListOfShape_1())
    list.Append_1(prism)
    list.Append_1(target)
    builder.SetArguments(list)
    builder.Build(scratch.track(new ocAny.Message_ProgressRange_1()))
    if (!builder.IsDone() || builder.HasErrors()) {
      throw new Error(`Could not find where the profile meets ${stop.what}.`)
    }
    const pieces = subShapes(oc, prism, 'TopAbs_SOLID', scratch).flatMap((solid) => {
      const images = readShapes(oc, builder.Modified(solid), scratch)
      return images.length ? images : builder.IsDeleted(solid) ? [] : [solid]
    })
    const front = pieces.filter((piece) => hasCap(oc, piece, base, stop.direction, 0))
    if (!front.length) throw new Error(`Nothing is left in front of ${stop.what}.`)
    if (front.some((piece) => hasCap(oc, piece, base, stop.direction, stop.length))) {
      throw new Error(`The profile reaches past the edge of ${stop.what}.`)
    }
    const assembler = scratch.track(new ocAny.TopoDS_Builder())
    const compound = new ocAny.TopoDS_Compound()
    assembler.MakeCompound(compound)
    for (const piece of pieces) if (!front.includes(piece)) assembler.Add(compound, piece)
    return compound
  } finally {
    scratch.release()
  }
}

function resolveFace(input: ExtentInput, ref: ElementReference): OcShape {
  const body = input.bodies.get(ref.bodyId)
  if (!body) {
    throw new Error(`${input.bodyName(ref.bodyId)} does not exist at this point in the timeline.`)
  }
  const resolution = resolveElement(body.map, ref)
  if (!resolution.ok) throw new NamingError(resolution.error)
  return resolution.element.shape
}

function stopAtPlane(
  input: ExtentInput,
  side: Side,
  plane: { origin: Vec3; normal: Vec3 },
  profile: Bounds,
  what: string,
): Stop {
  const reach = (direction: Vec3) => {
    const facing = v3.dot(direction, plane.normal)
    if (Math.abs(facing) < 1e-6) {
      throw new Error(`${capitalised(what)} runs along the extrusion, so it cannot stop it.`)
    }
    return Math.max(
      ...corners(profile).map(
        (corner) => v3.dot(v3.sub(plane.origin, corner), plane.normal) / facing,
      ),
    )
  }
  let direction = side.direction
  let far = reach(direction)
  if (far <= TOLERANCE && side.flippable) {
    direction = v3.scale(direction, -1)
    far = reach(direction)
  }
  if (far <= TOLERANCE) throw new Error(`${capitalised(what)} is behind the profile.`)
  const length = far + margin(far)
  const outward = v3.scale(plane.normal, Math.sign(v3.dot(direction, plane.normal)))
  const size = 4 * (length + diagonal(profile)) + 100
  return {
    direction,
    length,
    what,
    halfSpace: halfSpaceBeyond(input.oc, plane.origin, outward, size),
  }
}

function stopAtShape(base: Frame, side: Side, shape: OcShape, what: string): Stop {
  const bounds = exactBounds(shape)
  let direction = side.direction
  let far = span(bounds, base.origin, direction)[1]
  if (far <= TOLERANCE && side.flippable) {
    direction = v3.scale(direction, -1)
    far = span(bounds, base.origin, direction)[1]
  }
  if (far <= TOLERANCE) throw new Error(`${capitalised(what)} is behind the profile.`)
  return { direction, length: far + margin(far), what, target: shape }
}

function stopAt(input: ExtentInput, base: Frame, side: Side): Stop {
  const target = side.to
  if (!target) throw new Error('Pick the face, plane or body to extrude to.')
  const outline = input.face(base)
  const profile = exactBounds(outline)
  if (target.kind === 'plane') {
    return stopAtPlane(input, side, input.plane(target.plane), profile, 'that plane')
  }
  if (target.kind === 'face') {
    const face = resolveFace(input, target.face)
    const plane = facePlane(input.oc, face)
    if (plane) {
      return stopAtPlane(
        input,
        side,
        { origin: plane.origin, normal: v3.norm(plane.normal) },
        profile,
        'that face',
      )
    }
    return stopAtShape(base, side, face, 'that face')
  }
  const body = input.bodies.get(target.bodyId)
  if (!body) {
    throw new Error(
      `${input.bodyName(target.bodyId)} does not exist at this point in the timeline.`,
    )
  }
  return stopAtShape(base, side, body.shape.wrapped, input.bodyName(target.bodyId))
}

function reachAll(input: ExtentInput, base: Frame, direction: Vec3): number {
  let far = -Infinity
  for (const body of input.bodies.values()) {
    far = Math.max(far, span(exactBounds(body.shape), base.origin, direction)[1])
  }
  if (!(far > TOLERANCE)) {
    throw new Error('There is nothing in front of the profile for All to go through.')
  }
  return far + margin(far)
}

function trim(
  input: ExtentInput,
  solid: NamedShape,
  id: string,
  base: Frame,
  stop: Stop,
): NamedShape {
  const { oc } = input
  const shape = stop.halfSpace ?? beyond(oc, solid.shape, stop.target!, base, stop)
  stop.halfSpace = undefined
  const tool = nameShape(oc, `${id}:to`, shape)
  try {
    return cut(oc, { featureId: id, target: solid, tools: [tool] })
  } finally {
    releaseNamedShape(tool)
  }
}

function sideSolid(input: ExtentInput, base: Frame, side: Side): NamedShape {
  const stop = side.extent === 'to' ? stopAt(input, base, side) : null
  const direction = stop?.direction ?? side.direction
  let solid: NamedShape | null = null
  try {
    const length =
      side.extent === 'distance'
        ? side.distance
        : side.extent === 'all'
          ? reachAll(input, base, direction)
          : stop!.length
    solid = prism(input, base, side.id, v3.scale(direction, length))
    if (side.taper)
      solid = replaced(solid, taper(input.oc, solid, side.id, base, direction, side.taper))
    if (stop) solid = replaced(solid, trim(input, solid, side.id, base, stop))
    const done = solid
    solid = null
    return done
  } finally {
    stop?.halfSpace?.delete()
    if (solid) releaseNamedShape(solid)
  }
}

export function extrudeSolid(input: ExtentInput): NamedShape {
  const base = startFrame(input)
  const sides = sidesOf(input.feature, input.frame.normal)
  if (sides.every((side) => side.extent === 'distance' && !side.taper)) {
    return plainPrism(input, base, sides)
  }
  const solids: NamedShape[] = []
  try {
    for (const side of sides) solids.push(sideSolid(input, base, side))
    if (solids.length === 1) return solids.pop()!
    return fuse(input.oc, {
      featureId: input.feature.id,
      target: solids[0],
      tools: solids.slice(1),
    })
  } finally {
    for (const solid of solids) releaseNamedShape(solid)
  }
}
