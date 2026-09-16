import { v3, type Frame, type Vec2, type Vec3 } from '../../core/math'
import type { Message_ProgressRange } from 'replicad-opencascadejs'
import type { Sketch2D } from '../../sketch/types'
import type { PieceSample } from './profileMatch'
import type { ElementMap } from './elementMap'
import {
  booleanHistory,
  disposeTopology,
  draftHistory,
  exploreTopology,
  facePlane,
  filletHistory,
  isPlanarFace,
  isShapeType,
  joinType,
  nameProfile,
  nonNullShape,
  occGeometry,
  occShapeOps,
  offsetShapeHistory,
  pipeShellHistory,
  prismHistory,
  rationalFillet,
  revolHistory,
  Scratch,
  skinMode,
  subShapes,
  thickSolidHistory,
  thruSectionsHistory,
  transitionMode,
  type JoinKind,
  type OC,
  type OcProfileNames,
  type OcShape,
} from './occ'
import { resolveElements } from './resolve'
import { buildElementMap, type NamingInput, type Seed } from './rules'
import {
  capSeeds,
  roleSeeds,
  sectionSeeds,
  sweepSeeds,
  type ProfileNames,
  type RoledShape,
} from './seeds'
import { ShapeIndex } from './shapeIndex'
import type { Topology } from './types'

export interface NamedShape {
  shape: OcShape
  map: ElementMap<OcShape>
}

export interface ProfileInput {
  profile: OcShape
  sketch: Sketch2D
  frame: Frame
  tolerance?: number
  pieces?: readonly PieceSample[]
}

export type BooleanKind = 'fuse' | 'cut' | 'common'

export interface BooleanOptions {
  featureId: string
  target: NamedShape
  tools: readonly NamedShape[]
  simplify?: boolean
  angularTolerance?: number
}

interface BodyOptions {
  featureId: string
  bodyId: string
  body: NamedShape
}

export interface ExtrudeOptions extends ProfileInput {
  featureId: string
  vector: Vec3
  offset?: Vec3
}

export interface RevolveOptions extends ProfileInput {
  featureId: string
  axisOrigin: Vec3
  axisDirection: Vec3
  angle: number
}

export interface FilletOptions extends BodyOptions {
  edges: readonly string[] | 'all'
  radius: number
}

export interface ChamferOptions extends BodyOptions {
  edges: readonly string[] | 'all'
  distance: number
}

export interface ShellOptions extends BodyOptions {
  openFaces: readonly string[]
  thickness: number
  tolerance?: number
  join?: JoinKind
}

export interface DraftOptions extends BodyOptions {
  faces: readonly string[]
  pullDirection: Vec3
  angle: number
  neutralPlane: { origin: Vec3; normal: Vec3 }
}

export interface MoveFacesOptions extends BodyOptions {
  faces: readonly string[]
  distance: number
}

export interface OffsetOptions extends BodyOptions {
  faces: readonly string[] | 'all'
  distance: number
  tolerance?: number
  join?: JoinKind
}

export interface LoftOptions {
  featureId: string
  sections: readonly ProfileInput[]
  solid?: boolean
  ruled?: boolean
}

export interface SweepOptions extends ProfileInput {
  featureId: string
  spine: OcShape
  frenet?: boolean
  solid?: boolean
  corners?: 'transformed' | 'right' | 'round'
}

export interface BoxOptions {
  featureId: string
  frame: Frame
  origin?: Vec2
  size: Vec3
}

export interface CylinderOptions {
  featureId: string
  frame: Frame
  centre: Vec2
  radius: number
  height: number
}

export interface SphereOptions {
  featureId: string
  frame: Frame
  centre: Vec2
  radius: number
  half: boolean
}

export interface TorusOptions {
  featureId: string
  frame: Frame
  centre: Vec2
  majorRadius: number
  minorRadius: number
}

type Naming = Pick<NamingInput<OcShape>, 'inputs' | 'history'> & {
  seeds?: readonly Seed<OcShape>[] | ((result: Topology<OcShape>) => Seed<OcShape>[])
}

interface Buildable {
  Build(range: Message_ProgressRange): void
  IsDone(): boolean
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function inFrame(frame: Frame, [u, v]: Vec2): Vec3 {
  return add(frame.origin, add(scale(frame.xDir, u), scale(frame.yDir, v)))
}

export function releaseNamedShape(named: NamedShape): void {
  named.map.dispose()
  named.shape.delete()
}

function finish(oc: OC, featureId: string, shape: OcShape, naming: Naming): NamedShape {
  const result = exploreTopology(oc, shape)
  try {
    const seeds = typeof naming.seeds === 'function' ? naming.seeds(result) : naming.seeds
    const map = buildElementMap({
      featureId,
      ops: occShapeOps,
      result,
      geometry: occGeometry(oc),
      inputs: naming.inputs,
      history: naming.history,
      seeds,
    })
    return { shape, map }
  } catch (error) {
    disposeTopology(result)
    shape.delete()
    throw error
  }
}

function build(oc: OC, builder: Buildable, what: string): void {
  const progress = new oc.Message_ProgressRange_1()
  try {
    builder.Build(progress)
  } finally {
    progress.delete()
  }
  if (!builder.IsDone()) throw new Error(`${what} failed`)
}

function point(oc: OC, [x, y, z]: Vec3, scratch: Scratch) {
  return scratch.track(new oc.gp_Pnt_3(x, y, z))
}

function direction(oc: OC, [x, y, z]: Vec3, scratch: Scratch) {
  return scratch.track(new oc.gp_Dir_4(x, y, z))
}

function vector(oc: OC, [x, y, z]: Vec3, scratch: Scratch) {
  return scratch.track(new oc.gp_Vec_4(x, y, z))
}

function axes(oc: OC, frame: Frame, at: Vec3, scratch: Scratch) {
  return scratch.track(
    new oc.gp_Ax2_2(
      point(oc, at, scratch),
      direction(oc, frame.normal, scratch),
      direction(oc, frame.xDir, scratch),
    ),
  )
}

function translated(oc: OC, shape: OcShape, offset: Vec3): OcShape {
  const scratch = new Scratch()
  try {
    const transformation = scratch.track(new oc.gp_Trsf_1())
    transformation.SetTranslation_1(vector(oc, offset, scratch))
    return scratch.track(new oc.BRepBuilderAPI_Transform_2(shape, transformation, false)).Shape()
  } finally {
    scratch.release()
  }
}

function profileNames(
  oc: OC,
  input: ProfileInput,
  scratch: Scratch,
  offset?: Vec3,
): OcProfileNames {
  let profile = input.profile
  let frame = input.frame
  if (offset && offset.some((component) => component !== 0)) {
    profile = scratch.track(translated(oc, profile, offset))
    frame = { ...frame, origin: add(frame.origin, offset) }
  }
  const names = nameProfile(oc, profile, input.sketch, frame, input.tolerance, input.pieces)
  scratch.track({ delete: () => disposeTopology(names.topology) })
  return names
}

export function extrudeProfile(
  oc: OC,
  featureId: string,
  profile: ProfileNames<OcShape>,
  distance: Vec3,
): NamedShape {
  const scratch = new Scratch()
  try {
    const builder = scratch.track(
      new oc.BRepPrimAPI_MakePrism_1(profile.shape, vector(oc, distance, scratch), false, true),
    )
    if (!builder.IsDone()) throw new Error('Extrude failed')
    const seeds = sweepSeeds(featureId, profile, prismHistory(oc, builder, scratch))
    return finish(oc, featureId, builder.Shape(), { seeds })
  } finally {
    scratch.release()
  }
}

export function extrude(oc: OC, options: ExtrudeOptions): NamedShape {
  const scratch = new Scratch()
  try {
    const names = profileNames(oc, options, scratch, options.offset)
    return extrudeProfile(oc, options.featureId, names, options.vector)
  } finally {
    scratch.release()
  }
}

export function revolveProfile(
  oc: OC,
  featureId: string,
  profile: ProfileNames<OcShape>,
  axisOrigin: Vec3,
  axisDirection: Vec3,
  angle: number,
): NamedShape {
  const scratch = new Scratch()
  try {
    const axis = scratch.track(
      new oc.gp_Ax1_2(point(oc, axisOrigin, scratch), direction(oc, axisDirection, scratch)),
    )
    const builder = scratch.track(
      new oc.BRepPrimAPI_MakeRevol_1(profile.shape, axis, (angle * Math.PI) / 180, false),
    )
    if (!builder.IsDone()) throw new Error('Revolve failed')
    const seeds = sweepSeeds(featureId, profile, revolHistory(oc, builder, scratch))
    return finish(oc, featureId, builder.Shape(), { seeds })
  } finally {
    scratch.release()
  }
}

export function revolve(oc: OC, options: RevolveOptions): NamedShape {
  const scratch = new Scratch()
  try {
    const names = profileNames(oc, options, scratch)
    return revolveProfile(
      oc,
      options.featureId,
      names,
      options.axisOrigin,
      options.axisDirection,
      options.angle,
    )
  } finally {
    scratch.release()
  }
}

export function booleanOperation(oc: OC, kind: BooleanKind, options: BooleanOptions): NamedShape {
  const scratch = new Scratch()
  try {
    const operation = scratch.track(
      kind === 'fuse'
        ? new oc.BRepAlgoAPI_Fuse_1()
        : kind === 'cut'
          ? new oc.BRepAlgoAPI_Cut_1()
          : new oc.BRepAlgoAPI_Common_1(),
    )
    const argumentList = scratch.track(new oc.TopTools_ListOfShape_1())
    scratch.track(argumentList.Append_1(options.target.shape))
    const toolList = scratch.track(new oc.TopTools_ListOfShape_1())
    for (const tool of options.tools) scratch.track(toolList.Append_1(tool.shape))
    operation.SetArguments(argumentList)
    operation.SetTools(toolList)
    operation.SetRunParallel(false)
    operation.SetToFillHistory(true)
    build(oc, operation, `The ${kind}`)
    if (operation.HasErrors()) throw new Error(`The ${kind} failed`)
    if (options.simplify !== false) {
      operation.SimplifyResult(true, true, options.angularTolerance ?? 1e-6)
    }
    return finish(oc, options.featureId, operation.Shape(), {
      inputs: [options.target.map, ...options.tools.map((tool) => tool.map)],
      history: booleanHistory(oc, operation, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function fuse(oc: OC, options: BooleanOptions): NamedShape {
  return booleanOperation(oc, 'fuse', options)
}

export function cut(oc: OC, options: BooleanOptions): NamedShape {
  return booleanOperation(oc, 'cut', options)
}

export function common(oc: OC, options: BooleanOptions): NamedShape {
  return booleanOperation(oc, 'common', options)
}

export function fillet(oc: OC, options: FilletOptions): NamedShape {
  const edges = resolveElements(options.body.map, options.bodyId, 'edge', options.edges)
  if (!edges.length) throw new Error('Fillet needs at least one edge')
  const scratch = new Scratch()
  try {
    const builder = scratch.track(
      new oc.BRepFilletAPI_MakeFillet(options.body.shape, rationalFillet(oc)),
    )
    for (const edge of edges) {
      builder.Add_2(options.radius, scratch.track(oc.TopoDS.Edge_1(edge.shape)))
    }
    build(oc, builder, 'Fillet')
    return finish(oc, options.featureId, builder.Shape(), {
      inputs: [options.body.map],
      history: filletHistory(oc, builder, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function chamfer(oc: OC, options: ChamferOptions): NamedShape {
  const edges = resolveElements(options.body.map, options.bodyId, 'edge', options.edges)
  if (!edges.length) throw new Error('Chamfer needs at least one edge')
  const scratch = new Scratch()
  try {
    const builder = scratch.track(new oc.BRepFilletAPI_MakeChamfer(options.body.shape))
    for (const edge of edges) {
      builder.Add_2(options.distance, scratch.track(oc.TopoDS.Edge_1(edge.shape)))
    }
    build(oc, builder, 'Chamfer')
    return finish(oc, options.featureId, builder.Shape(), {
      inputs: [options.body.map],
      history: filletHistory(oc, builder, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function shell(oc: OC, options: ShellOptions): NamedShape {
  const faces = resolveElements(options.body.map, options.bodyId, 'face', options.openFaces)
  const scratch = new Scratch()
  try {
    const closing = scratch.track(new oc.TopTools_ListOfShape_1())
    for (const face of faces) scratch.track(closing.Append_1(face.shape))
    const builder = scratch.track(new oc.BRepOffsetAPI_MakeThickSolid())
    const progress = scratch.track(new oc.Message_ProgressRange_1())
    builder.MakeThickSolidByJoin(
      options.body.shape,
      closing,
      -options.thickness,
      options.tolerance ?? 1e-3,
      skinMode(oc),
      false,
      false,
      joinType(oc, options.join ?? 'arc'),
      false,
      progress,
    )
    if (!builder.IsDone()) throw new Error('Shell failed')
    return finish(oc, options.featureId, builder.Shape(), {
      inputs: [options.body.map],
      history: thickSolidHistory(oc, builder, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function draft(oc: OC, options: DraftOptions): NamedShape {
  const faces = resolveElements(options.body.map, options.bodyId, 'face', options.faces)
  const scratch = new Scratch()
  try {
    const builder = scratch.track(new oc.BRepOffsetAPI_DraftAngle_2(options.body.shape))
    const pull = direction(oc, options.pullDirection, scratch)
    const plane = scratch.track(
      new oc.gp_Pln_3(
        point(oc, options.neutralPlane.origin, scratch),
        direction(oc, options.neutralPlane.normal, scratch),
      ),
    )
    const radians = (options.angle * Math.PI) / 180
    for (const face of faces) {
      builder.Add(scratch.track(oc.TopoDS.Face_1(face.shape)), pull, radians, plane, true)
      if (!builder.AddDone()) {
        throw new Error(`Draft cannot tilt the face ${options.body.map.fullName(face.name)}`)
      }
    }
    build(oc, builder, 'Draft')
    return finish(oc, options.featureId, builder.Shape(), {
      inputs: [options.body.map],
      history: draftHistory(oc, builder, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function moveFaces(oc: OC, options: MoveFacesOptions): NamedShape {
  const faces = resolveElements(options.body.map, options.bodyId, 'face', options.faces)
  if (!(Math.abs(options.distance) > 1e-9)) throw new Error('The offset distance cannot be zero')
  const scratch = new Scratch()
  try {
    const planes = faces.map((face) => {
      const plane = facePlane(oc, face.shape)
      if (!plane) {
        throw new Error(
          `Offset Face moves flat faces only, and ${options.body.map.fullName(face.name)} is curved`,
        )
      }
      return plane
    })
    const operation = scratch.track(
      options.distance > 0 ? new oc.BRepAlgoAPI_Fuse_1() : new oc.BRepAlgoAPI_Cut_1(),
    )
    const argumentList = scratch.track(new oc.TopTools_ListOfShape_1())
    scratch.track(argumentList.Append_1(options.body.shape))
    const toolList = scratch.track(new oc.TopTools_ListOfShape_1())
    faces.forEach((face, index) => {
      const shift = vector(oc, v3.scale(planes[index].normal, options.distance), scratch)
      const prism = scratch.track(new oc.BRepPrimAPI_MakePrism_1(face.shape, shift, false, true))
      scratch.track(toolList.Append_1(scratch.track(prism.Shape())))
    })
    operation.SetArguments(argumentList)
    operation.SetTools(toolList)
    operation.SetRunParallel(false)
    operation.SetToFillHistory(true)
    build(oc, operation, 'Offset Face')
    if (operation.HasErrors()) throw new Error('Offset Face failed')
    operation.SimplifyResult(true, true, 1e-6)
    const shape = operation.Shape()
    const resultFaces = subShapes(oc, shape, 'TopAbs_FACE', scratch)
    const moved = planes.map((plane) => {
      const origin = v3.add(plane.origin, v3.scale(plane.normal, options.distance))
      return resultFaces.filter((candidate) => {
        const other = facePlane(oc, candidate)
        return (
          !!other &&
          v3.dot(other.normal, plane.normal) > 1 - 1e-9 &&
          Math.abs(v3.dot(v3.sub(other.origin, origin), plane.normal)) < 1e-6
        )
      })
    })
    const base = booleanHistory(oc, operation, scratch)
    const pickedIndex = (candidate: OcShape) =>
      faces.findIndex((face) => occShapeOps.same(face.shape, candidate))
    return finish(oc, options.featureId, shape, {
      inputs: [options.body.map],
      history: {
        modified: (candidate) => {
          const index = pickedIndex(candidate)
          return index >= 0 ? moved[index] : base.modified(candidate)
        },
        generated: (candidate) => (pickedIndex(candidate) >= 0 ? [] : base.generated(candidate)),
        isDeleted: (candidate) =>
          pickedIndex(candidate) >= 0
            ? !moved[pickedIndex(candidate)].length
            : base.isDeleted(candidate),
      },
    })
  } finally {
    scratch.release()
  }
}

export function offsetFaces(oc: OC, options: OffsetOptions): NamedShape {
  const faces =
    options.faces === 'all'
      ? null
      : resolveElements(options.body.map, options.bodyId, 'face', options.faces)
  const scratch = new Scratch()
  try {
    let source = options.body.shape
    if (faces) {
      const assembler = scratch.track(new oc.TopoDS_Builder())
      const compound = scratch.track(new oc.TopoDS_Compound())
      assembler.MakeCompound(compound)
      for (const face of faces) assembler.Add(compound, face.shape)
      source = compound
    }
    const builder = scratch.track(new oc.BRepOffsetAPI_MakeOffsetShape())
    const progress = scratch.track(new oc.Message_ProgressRange_1())
    builder.PerformByJoin(
      source,
      options.distance,
      options.tolerance ?? 1e-3,
      skinMode(oc),
      false,
      false,
      joinType(oc, options.join ?? 'arc'),
      false,
      progress,
    )
    if (!builder.IsDone()) throw new Error('Offset failed')
    return finish(oc, options.featureId, builder.Shape(), {
      inputs: [options.body.map],
      history: offsetShapeHistory(oc, builder, scratch),
    })
  } finally {
    scratch.release()
  }
}

export function loft(oc: OC, options: LoftOptions): NamedShape {
  if (options.sections.length < 2) throw new Error('Loft needs at least two sections')
  const scratch = new Scratch()
  try {
    const sections = options.sections.map((section) => profileNames(oc, section, scratch))
    const builder = scratch.track(
      new oc.BRepOffsetAPI_ThruSections(options.solid ?? true, options.ruled ?? false, 1e-6),
    )
    for (const section of sections) {
      if (!isShapeType(oc, section.shape, 'TopAbs_WIRE')) {
        throw new Error('Every loft section must be a wire')
      }
      builder.AddWire(scratch.track(oc.TopoDS.Wire_1(section.shape)))
    }
    builder.CheckCompatibility(true)
    build(oc, builder, 'Loft')
    const history = thruSectionsHistory(oc, builder, scratch)
    const first = nonNullShape(builder.FirstShape(), scratch)
    const last = nonNullShape(builder.LastShape(), scratch)
    const seeds = [
      ...sectionSeeds(options.featureId, sections[0], history),
      ...capSeeds(options.featureId, first ? [first] : [], last ? [last] : []),
    ]
    return finish(oc, options.featureId, builder.Shape(), { seeds })
  } finally {
    scratch.release()
  }
}

function boundedFaces(
  oc: OC,
  result: Topology<OcShape>,
  boundary: OcShape,
  scratch: Scratch,
): OcShape[] {
  const edges = new ShapeIndex<OcShape, true>(occShapeOps)
  for (const edge of subShapes(oc, boundary, 'TopAbs_EDGE', scratch)) edges.set(edge, true)
  if (!edges.size) return []
  return result.faces.filter(
    (_, face) =>
      result.faceEdges[face].length > 0 &&
      result.faceEdges[face].every((edge) => edges.has(result.edges[edge])),
  )
}

export function sweep(oc: OC, options: SweepOptions): NamedShape {
  const scratch = new Scratch()
  try {
    const profile = profileNames(oc, options, scratch)
    if (
      !isShapeType(oc, profile.shape, 'TopAbs_WIRE') ||
      !isShapeType(oc, options.spine, 'TopAbs_WIRE')
    ) {
      throw new Error('Sweep needs a wire profile and a wire path')
    }
    const builder = scratch.track(
      new oc.BRepOffsetAPI_MakePipeShell(scratch.track(oc.TopoDS.Wire_1(options.spine))),
    )
    builder.SetMode_1(options.frenet ?? false)
    builder.SetTransitionMode(transitionMode(oc, options.corners))
    builder.Add_1(profile.shape, false, false)
    build(oc, builder, 'Sweep')
    if (options.solid !== false && !builder.MakeSolid()) {
      throw new Error('Sweep could not close into a solid')
    }
    const history = pipeShellHistory(oc, builder, scratch)
    const first = nonNullShape(builder.FirstShape(), scratch)
    const last = nonNullShape(builder.LastShape(), scratch)
    return finish(oc, options.featureId, builder.Shape(), {
      seeds: (result) => [
        ...sectionSeeds(options.featureId, profile, history),
        ...capSeeds(
          options.featureId,
          first ? boundedFaces(oc, result, first, scratch) : [],
          last ? boundedFaces(oc, result, last, scratch) : [],
        ),
      ],
    })
  } finally {
    scratch.release()
  }
}

function primitive(
  oc: OC,
  featureId: string,
  shape: OcShape,
  roleOf: (face: OcShape, centroid: Vec3) => string,
): NamedShape {
  const geometry = occGeometry(oc)
  return finish(oc, featureId, shape, {
    seeds: (result) =>
      roleSeeds(
        featureId,
        result.faces.map((face): RoledShape<OcShape> => ({
          shape: face,
          role: roleOf(face, geometry.centroid('face', face)),
        })),
      ),
  })
}

export function box(oc: OC, options: BoxOptions): NamedShape {
  const { frame } = options
  const [signedWidth, signedDepth, signedHeight] = options.size
  const [width, depth, height] = options.size.map(Math.abs)
  const scratch = new Scratch()
  try {
    const corner = add(
      inFrame(frame, options.origin ?? [0, 0]),
      add(
        scale(frame.xDir, Math.min(0, signedWidth)),
        add(
          scale(frame.yDir, Math.min(0, signedDepth)),
          scale(frame.normal, Math.min(0, signedHeight)),
        ),
      ),
    )
    const builder = scratch.track(
      new oc.BRepPrimAPI_MakeBox_5(axes(oc, frame, corner, scratch), width, depth, height),
    )
    build(oc, builder, 'Box')
    const centre = add(
      corner,
      add(
        scale(frame.xDir, width / 2),
        add(scale(frame.yDir, depth / 2), scale(frame.normal, height / 2)),
      ),
    )
    return primitive(oc, options.featureId, builder.Shape(), (_, centroid) => {
      const offset = sub(centroid, centre)
      const local = [dot(offset, frame.xDir), dot(offset, frame.yDir), dot(offset, frame.normal)]
      const axis = local.reduce(
        (best, value, i) => (Math.abs(value) > Math.abs(local[best]) ? i : best),
        0,
      )
      return `${local[axis] < 0 ? '-' : '+'}${'xyz'[axis]}`
    })
  } finally {
    scratch.release()
  }
}

export function cylinder(oc: OC, options: CylinderOptions): NamedShape {
  const { frame } = options
  const scratch = new Scratch()
  try {
    const height = Math.abs(options.height)
    const base = add(
      inFrame(frame, options.centre),
      scale(frame.normal, Math.min(0, options.height)),
    )
    const builder = scratch.track(
      new oc.BRepPrimAPI_MakeCylinder_3(axes(oc, frame, base, scratch), options.radius, height),
    )
    build(oc, builder, 'Cylinder')
    const middle = add(base, scale(frame.normal, height / 2))
    return primitive(oc, options.featureId, builder.Shape(), (face, centroid) =>
      isPlanarFace(oc, face)
        ? dot(sub(centroid, middle), frame.normal) < 0
          ? '-z'
          : '+z'
        : 'side',
    )
  } finally {
    scratch.release()
  }
}

export function torus(oc: OC, options: TorusOptions): NamedShape {
  const { frame } = options
  if (!(options.minorRadius > 0) || options.minorRadius >= options.majorRadius) {
    throw new Error('The tube of a torus has to be thinner than the ring is wide')
  }
  const scratch = new Scratch()
  try {
    const at = axes(oc, frame, inFrame(frame, options.centre), scratch)
    const builder = scratch.track(
      new oc.BRepPrimAPI_MakeTorus_5(at, options.majorRadius, options.minorRadius),
    )
    build(oc, builder, 'Torus')
    return primitive(oc, options.featureId, builder.Shape(), () => 'surface')
  } finally {
    scratch.release()
  }
}

export function sphere(oc: OC, options: SphereOptions): NamedShape {
  const { frame } = options
  const scratch = new Scratch()
  try {
    const at = axes(oc, frame, inFrame(frame, options.centre), scratch)
    const builder = scratch.track(
      options.half
        ? new oc.BRepPrimAPI_MakeSphere_11(at, options.radius, 0, Math.PI / 2)
        : new oc.BRepPrimAPI_MakeSphere_9(at, options.radius),
    )
    build(oc, builder, 'Sphere')
    return primitive(oc, options.featureId, builder.Shape(), (face) =>
      isPlanarFace(oc, face) ? '-z' : 'surface',
    )
  } finally {
    scratch.release()
  }
}
