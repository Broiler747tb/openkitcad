import type { Frame, Vec2, Vec3 } from '../../core/math'
import type {
  BRepAlgoAPI_BuilderAlgo,
  BRepBuilderAPI_TransitionMode,
  BRepFilletAPI_MakeChamfer,
  BRepFilletAPI_MakeFillet,
  BRepOffset_Mode,
  BRepOffsetAPI_DraftAngle,
  BRepOffsetAPI_MakeOffsetShape,
  BRepOffsetAPI_MakePipeShell,
  BRepOffsetAPI_MakeThickSolid,
  BRepOffsetAPI_ThruSections,
  BRepPrimAPI_MakePrism,
  BRepPrimAPI_MakeRevol,
  ChFi3d_FilletShape,
  GeomAbs_JoinType,
  GProp_GProps,
  OpenCascadeInstance,
  TopAbs_ShapeEnum,
  TopoDS_Shape,
  TopTools_ListOfShape,
} from 'replicad-opencascadejs'
import type { Sketch2D } from '../../sketch/types'
import { principalAxisFromInertia } from './axis'
import {
  matchProfile,
  type PieceSample,
  PROFILE_TOLERANCE,
  projectToFrame,
  type EdgeSample,
  type VertexSample,
} from './profileMatch'
import type { ProfileNames } from './seeds'
import { ShapeIndex } from './shapeIndex'
import { adjacencyOf, topologyShapes } from './topology'
import type { ElementKind, Geometry, History, ShapeOps, SweepHistory, Topology } from './types'

export type OC = OpenCascadeInstance

export type OcShape = TopoDS_Shape

export type ShapeKey = keyof TopAbs_ShapeEnum

export type JoinKind = 'arc' | 'intersection'

export const HASH_UPPER_BOUND = 2147483647

export interface Deletable {
  delete(): void
}

export class Scratch {
  private readonly items: Deletable[] = []

  track<T extends Deletable>(item: T): T {
    this.items.push(item)
    return item
  }

  release(): void {
    for (let item = this.items.pop(); item; item = this.items.pop()) {
      try {
        item.delete()
      } catch {
        continue
      }
    }
  }
}

export const occShapeOps: ShapeOps<OcShape> = {
  hash: (shape) => shape.HashCode(HASH_UPPER_BOUND),
  same: (a, b) => a.IsSame(b),
  dispose: (shape) => shape.delete(),
}

export function shapeEnum(oc: OC, key: ShapeKey): TopAbs_ShapeEnum {
  return oc.TopAbs_ShapeEnum[key] as unknown as TopAbs_ShapeEnum
}

export function isShapeType(oc: OC, shape: OcShape, key: ShapeKey): boolean {
  return shape.ShapeType() === (oc.TopAbs_ShapeEnum[key] as unknown)
}

export function joinType(oc: OC, join: JoinKind): GeomAbs_JoinType {
  const value =
    join === 'arc' ? oc.GeomAbs_JoinType.GeomAbs_Arc : oc.GeomAbs_JoinType.GeomAbs_Intersection
  return value as unknown as GeomAbs_JoinType
}

export function transitionMode(
  oc: OC,
  corners: 'transformed' | 'right' | 'round' | undefined,
): BRepBuilderAPI_TransitionMode {
  const modes = oc.BRepBuilderAPI_TransitionMode
  const value =
    corners === 'right'
      ? modes.BRepBuilderAPI_RightCorner
      : corners === 'round'
        ? modes.BRepBuilderAPI_RoundCorner
        : modes.BRepBuilderAPI_Transformed
  return value as unknown as BRepBuilderAPI_TransitionMode
}

export function skinMode(oc: OC): BRepOffset_Mode {
  return oc.BRepOffset_Mode.BRepOffset_Skin as unknown as BRepOffset_Mode
}

export function rationalFillet(oc: OC): ChFi3d_FilletShape {
  return oc.ChFi3d_FilletShape.ChFi3d_Rational as unknown as ChFi3d_FilletShape
}

function collect(
  oc: OC,
  root: OcShape,
  key: ShapeKey,
  index: ShapeIndex<OcShape, number>,
  list: OcShape[] | null,
): number[] {
  const found: number[] = []
  const explorer = new oc.TopExp_Explorer_2(root, shapeEnum(oc, key), shapeEnum(oc, 'TopAbs_SHAPE'))
  try {
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current()
      let position = index.get(current)
      if (position === undefined && list) {
        position = list.length
        list.push(current)
        index.set(current, position)
      } else {
        current.delete()
      }
      if (position !== undefined && !found.includes(position)) found.push(position)
    }
  } finally {
    explorer.delete()
  }
  return found
}

export function exploreTopology(oc: OC, root: OcShape): Topology<OcShape> {
  const faces: OcShape[] = []
  const edges: OcShape[] = []
  const vertices: OcShape[] = []
  const faceIndex = new ShapeIndex<OcShape, number>(occShapeOps)
  const edgeIndex = new ShapeIndex<OcShape, number>(occShapeOps)
  const vertexIndex = new ShapeIndex<OcShape, number>(occShapeOps)
  try {
    collect(oc, root, 'TopAbs_FACE', faceIndex, faces)
    collect(oc, root, 'TopAbs_EDGE', edgeIndex, edges)
    collect(oc, root, 'TopAbs_VERTEX', vertexIndex, vertices)
    return {
      faces,
      edges,
      vertices,
      faceEdges: faces.map((face) => collect(oc, face, 'TopAbs_EDGE', edgeIndex, null)),
      edgeVertices: edges.map((edge) => collect(oc, edge, 'TopAbs_VERTEX', vertexIndex, null)),
    }
  } catch (error) {
    for (const shape of [...faces, ...edges, ...vertices]) shape.delete()
    throw error
  }
}

export function disposeTopology(topology: Topology<OcShape>): void {
  for (const shape of topologyShapes(topology)) shape.delete()
}

export function subShapes(oc: OC, root: OcShape, key: ShapeKey, scratch: Scratch): OcShape[] {
  const list: OcShape[] = []
  collect(oc, root, key, new ShapeIndex<OcShape, number>(occShapeOps), list)
  for (const shape of list) scratch.track(shape)
  return list
}

export function vertexPoint(oc: OC, vertex: OcShape): Vec3 {
  const cast = oc.TopoDS.Vertex_1(vertex)
  const point = oc.BRep_Tool.Pnt(cast)
  const out: Vec3 = [point.X(), point.Y(), point.Z()]
  point.delete()
  cast.delete()
  return out
}

export function sampleEdge(oc: OC, edge: OcShape, samples = 5): Vec3[] {
  const cast = oc.TopoDS.Edge_1(edge)
  const curve = new oc.BRepAdaptor_Curve_2(cast)
  try {
    const start = curve.FirstParameter()
    const end = curve.LastParameter()
    return Array.from({ length: samples }, (_, i) => {
      const point = curve.Value(start + ((end - start) * i) / (samples - 1))
      const out: Vec3 = [point.X(), point.Y(), point.Z()]
      point.delete()
      return out
    })
  } finally {
    curve.delete()
    cast.delete()
  }
}

export function facePlane(oc: OC, face: OcShape): { origin: Vec3; normal: Vec3 } | null {
  const cast = oc.TopoDS.Face_1(face)
  const surface = new oc.BRepAdaptor_Surface_2(cast, true)
  try {
    if (surface.GetType() !== (oc.GeomAbs_SurfaceType.GeomAbs_Plane as unknown)) return null
    const plane = surface.Plane()
    const axis = plane.Axis()
    const direction = axis.Direction()
    const location = plane.Location()
    const sign =
      cast.Orientation_1() === (oc.TopAbs_Orientation.TopAbs_REVERSED as unknown) ? -1 : 1
    const result = {
      origin: [location.X(), location.Y(), location.Z()] as Vec3,
      normal: [sign * direction.X(), sign * direction.Y(), sign * direction.Z()] as Vec3,
    }
    location.delete()
    direction.delete()
    axis.delete()
    plane.delete()
    return result
  } finally {
    surface.delete()
    cast.delete()
  }
}

export function isPlanarFace(oc: OC, face: OcShape): boolean {
  const cast = oc.TopoDS.Face_1(face)
  const surface = new oc.BRepAdaptor_Surface_2(cast, true)
  try {
    return surface.GetType() === (oc.GeomAbs_SurfaceType.GeomAbs_Plane as unknown)
  } finally {
    surface.delete()
    cast.delete()
  }
}

function measure<T>(
  oc: OC,
  kind: ElementKind,
  shape: OcShape,
  read: (props: GProp_GProps) => T,
): T {
  const props = new oc.GProp_GProps_1()
  try {
    if (kind === 'face') oc.BRepGProp.SurfaceProperties_1(shape, props, false, false)
    else oc.BRepGProp.LinearProperties(shape, props, false, false)
    return read(props)
  } finally {
    props.delete()
  }
}

export function occGeometry(oc: OC): Geometry<OcShape> {
  const firstVertex = (shape: OcShape): Vec3 => {
    const scratch = new Scratch()
    try {
      const [vertex] = subShapes(oc, shape, 'TopAbs_VERTEX', scratch)
      return vertex ? vertexPoint(oc, vertex) : [0, 0, 0]
    } finally {
      scratch.release()
    }
  }
  return {
    centroid(kind, shape) {
      if (kind === 'vertex') return vertexPoint(oc, shape)
      const centre = measure(oc, kind, shape, (props): Vec3 | null => {
        if (!(props.Mass() > 1e-12)) return null
        const point = props.CentreOfMass()
        const out: Vec3 = [point.X(), point.Y(), point.Z()]
        point.delete()
        return out
      })
      return centre && centre.every(Number.isFinite) ? centre : firstVertex(shape)
    },
    principalAxis(kind, shape) {
      if (kind === 'vertex') return null
      return measure(oc, kind, shape, (props) => {
        if (!(props.Mass() > 1e-12)) return null
        const centre = props.CentreOfMass()
        const moment = (x: number, y: number, z: number): number => {
          const direction = new oc.gp_Dir_4(x, y, z)
          const axis = new oc.gp_Ax1_2(centre, direction)
          try {
            return props.MomentOfInertia(axis)
          } finally {
            axis.delete()
            direction.delete()
          }
        }
        try {
          const xx = moment(1, 0, 0)
          const yy = moment(0, 1, 0)
          const zz = moment(0, 0, 1)
          const xy = moment(1, 1, 0) - (xx + yy) / 2
          const xz = moment(1, 0, 1) - (xx + zz) / 2
          const yz = moment(0, 1, 1) - (yy + zz) / 2
          return principalAxisFromInertia([
            [xx, xy, xz],
            [xy, yy, yz],
            [xz, yz, zz],
          ])
        } finally {
          centre.delete()
        }
      })
    },
  }
}

export function readShapes(oc: OC, list: TopTools_ListOfShape, scratch: Scratch): OcShape[] {
  const copy = new oc.TopTools_ListOfShape_3(list)
  list.delete()
  const shapes: OcShape[] = []
  try {
    while (copy.Size() > 0) {
      shapes.push(scratch.track(copy.First_1()))
      copy.RemoveFirst()
    }
  } finally {
    copy.delete()
  }
  return shapes
}

export function nonNullShape(shape: OcShape, scratch: Scratch): OcShape | null {
  if (shape.IsNull()) {
    shape.delete()
    return null
  }
  return scratch.track(shape)
}

export interface HistorySource {
  modified?: (shape: OcShape) => TopTools_ListOfShape
  generated?: (shape: OcShape) => TopTools_ListOfShape
  isDeleted?: (shape: OcShape) => boolean
}

export function occHistory(oc: OC, source: HistorySource, scratch: Scratch): History<OcShape> {
  const read = (query: ((shape: OcShape) => TopTools_ListOfShape) | undefined, shape: OcShape) =>
    query ? readShapes(oc, query(shape), scratch) : []
  return {
    modified: (shape) => read(source.modified, shape),
    generated: (shape) => read(source.generated, shape),
    isDeleted: (shape) => source.isDeleted?.(shape) ?? false,
  }
}

export function booleanHistory(
  oc: OC,
  builder: BRepAlgoAPI_BuilderAlgo,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(
    oc,
    {
      modified: (shape) => builder.Modified(shape),
      generated: (shape) => builder.Generated(shape),
      isDeleted: (shape) => builder.IsDeleted(shape),
    },
    scratch,
  )
}

export function prismHistory(
  oc: OC,
  builder: BRepPrimAPI_MakePrism,
  scratch: Scratch,
): SweepHistory<OcShape> {
  return {
    ...occHistory(
      oc,
      {
        generated: (shape) => builder.Generated(shape),
        isDeleted: (shape) => builder.IsDeleted(shape),
      },
      scratch,
    ),
    first: (shape) => nonNullShape(builder.FirstShape_2(shape), scratch),
    last: (shape) => nonNullShape(builder.LastShape_2(shape), scratch),
  }
}

export function revolHistory(
  oc: OC,
  builder: BRepPrimAPI_MakeRevol,
  scratch: Scratch,
): SweepHistory<OcShape> {
  return {
    ...occHistory(
      oc,
      {
        generated: (shape) => builder.Generated(shape),
        isDeleted: (shape) => builder.IsDeleted(shape),
      },
      scratch,
    ),
    first: (shape) => nonNullShape(builder.FirstShape_2(shape), scratch),
    last: (shape) => nonNullShape(builder.LastShape_2(shape), scratch),
  }
}

export function filletHistory(
  oc: OC,
  builder: BRepFilletAPI_MakeFillet | BRepFilletAPI_MakeChamfer,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(
    oc,
    {
      modified: (shape) => builder.Modified(shape),
      generated: (shape) => builder.Generated(shape),
      isDeleted: (shape) => builder.IsDeleted(shape),
    },
    scratch,
  )
}

export function thickSolidHistory(
  oc: OC,
  builder: BRepOffsetAPI_MakeThickSolid,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(
    oc,
    {
      modified: (shape) => builder.Modified(shape),
      generated: (shape) => builder.Generated(shape),
      isDeleted: (shape) => builder.IsDeleted(shape),
    },
    scratch,
  )
}

export function draftHistory(
  oc: OC,
  builder: BRepOffsetAPI_DraftAngle,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(
    oc,
    {
      modified: (shape) => builder.Modified(shape),
      generated: (shape) => builder.Generated(shape),
      isDeleted: (shape) => builder.IsDeleted(shape),
    },
    scratch,
  )
}

export function offsetShapeHistory(
  oc: OC,
  builder: BRepOffsetAPI_MakeOffsetShape,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(
    oc,
    {
      modified: (shape) => builder.Modified(shape),
      generated: (shape) => builder.Generated(shape),
      isDeleted: (shape) => builder.IsDeleted(shape),
    },
    scratch,
  )
}

export function thruSectionsHistory(
  oc: OC,
  builder: BRepOffsetAPI_ThruSections,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(oc, { generated: (shape) => builder.Generated(shape) }, scratch)
}

export function pipeShellHistory(
  oc: OC,
  builder: BRepOffsetAPI_MakePipeShell,
  scratch: Scratch,
): History<OcShape> {
  return occHistory(oc, { generated: (shape) => builder.Generated(shape) }, scratch)
}

export interface OcProfileNames extends ProfileNames<OcShape> {
  topology: Topology<OcShape>
}

export function nameProfile(
  oc: OC,
  shape: OcShape,
  sketch: Sketch2D,
  frame: Frame,
  tolerance = PROFILE_TOLERANCE,
  pieces: readonly PieceSample[] = [],
): OcProfileNames {
  const topology = exploreTopology(oc, shape)
  try {
    const adjacency = adjacencyOf(topology)
    let offPlane = 0
    const flatten = (point: Vec3): Vec2 => {
      const projected = projectToFrame(frame, point)
      offPlane = Math.max(offPlane, Math.abs(projected.height))
      return projected.point
    }
    const edges: EdgeSample[] = topology.edges.map((edge) => ({
      points: sampleEdge(oc, edge).map(flatten),
    }))
    const vertices: VertexSample[] = topology.vertices.map((vertex, index) => ({
      position: flatten(vertexPoint(oc, vertex)),
      edges: adjacency.vertexEdges[index],
    }))
    if (offPlane > tolerance) {
      throw new Error(`The profile lies ${offPlane.toPrecision(3)} mm off its sketch plane`)
    }
    const match = matchProfile(sketch, edges, vertices, tolerance, pieces)
    if (!match.ok) throw new Error(match.message)
    return {
      shape,
      topology,
      faces: topology.faces,
      edges: topology.edges.map((edge, index) => ({ shape: edge, token: match.edges[index] })),
      vertices: topology.vertices.map((vertex, index) => ({
        shape: vertex,
        token: match.vertices[index],
      })),
    }
  } catch (error) {
    disposeTopology(topology)
    throw error
  }
}
