import { Blueprint, CompoundBlueprint, Curve2D } from 'replicad'
import type { Vec2 } from '../core/math'
import {
  filledAt,
  flattenContour,
  glyphShapes,
  placedContours,
  segmentEnd,
  signedArea,
  winding,
} from '../sketch/text'
import type { GlyphSegment, TextEntity } from '../sketch/types'
import { disposeTopology, exploreTopology, type OcShape } from './naming/occ'
import type { PieceSample } from './naming/profileMatch'
import { adjacencyOf } from './naming/topology'

type OcAny = any

export type AreaShape = Blueprint | CompoundBlueprint

export interface AreaRing {
  curves: Curve2D[]
  pieces: PieceSample[]
  polygon: Vec2[]
}

export interface AreaGroup {
  rings: AreaRing[]
  shapes(): AreaShape[]
  filled(point: Vec2): boolean
}

const CLASSIFY_STEPS = 16

function fromHandle(handle: { delete(): void }): Curve2D {
  const curve = new Curve2D(handle as never)
  handle.delete()
  return curve
}

function segmentCurve(oc: OcAny, from: Vec2, segment: GlyphSegment): Curve2D {
  const points: Vec2[] = [from]
  for (let i = 0; i < segment.length; i += 2) points.push([segment[i], segment[i + 1]])
  const made = points.map((p) => new oc.gp_Pnt2d_3(p[0], p[1]))
  try {
    if (segment.length === 2) {
      const maker = new oc.GCE2d_MakeSegment_1(made[0], made[1])
      try {
        return fromHandle(maker.Value())
      } finally {
        maker.delete()
      }
    }
    const poles = new oc.TColgp_Array1OfPnt2d_2(1, points.length)
    try {
      made.forEach((p, i) => poles.SetValue(i + 1, p))
      return fromHandle(new oc.Handle_Geom2d_Curve_2(new oc.Geom2d_BezierCurve_1(poles)))
    } finally {
      poles.delete()
    }
  } finally {
    for (const p of made) p.delete()
  }
}

export function textOutlineGroup(entity: TextEntity, origin: Vec2): AreaGroup {
  const polygons = placedContours(entity, origin).map((contour) =>
    flattenContour(contour, CLASSIFY_STEPS),
  )
  return {
    rings: polygons.map((polygon) => ({ curves: [], pieces: [], polygon })),
    filled: (point) => filledAt(polygons, point),
    shapes: () => [],
  }
}

export function textGroup(oc: OcAny, entity: TextEntity, origin: Vec2): AreaGroup {
  const contours = placedContours(entity, origin).filter(
    (contour) => Math.abs(signedArea(flattenContour(contour, CLASSIFY_STEPS))) > 1e-9,
  )
  const rings: AreaRing[] = contours.map((contour, c) => {
    const curves: Curve2D[] = []
    const pieces: PieceSample[] = []
    let from: Vec2 = contour.start
    contour.segments.forEach((segment, s) => {
      const end = segmentEnd(segment)
      curves.push(segmentCurve(oc, from, segment))
      pieces.push({ entityId: entity.id, token: `${entity.id}[${c}.${s}]`, start: from, end })
      from = end
    })
    return { curves, pieces, polygon: flattenContour(contour, CLASSIFY_STEPS) }
  })
  const polygons = rings.map((ring) => ring.polygon)
  return {
    rings,
    filled: (point) => filledAt(polygons, point),
    shapes: () =>
      glyphShapes(polygons).map((shape) => {
        const outer = new Blueprint(rings[shape.outer].curves)
        if (!shape.holes.length) return outer
        return new CompoundBlueprint([
          outer,
          ...shape.holes.map((hole) => new Blueprint(rings[hole].curves)),
        ])
      }),
  }
}

type Box = [number, number, number, number]

function boxOf(polygon: readonly Vec2[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

function boxesMeet(a: Box, b: Box, pad = 0): boolean {
  return a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsMeet(p: Vec2, q: Vec2, r: Vec2, s: Vec2, eps: number): boolean {
  if (
    Math.max(p[0], q[0]) < Math.min(r[0], s[0]) - eps ||
    Math.max(r[0], s[0]) < Math.min(p[0], q[0]) - eps ||
    Math.max(p[1], q[1]) < Math.min(r[1], s[1]) - eps ||
    Math.max(r[1], s[1]) < Math.min(p[1], q[1]) - eps
  ) {
    return false
  }
  const d1 = cross(r, s, p)
  const d2 = cross(r, s, q)
  const d3 = cross(p, q, r)
  const d4 = cross(p, q, s)
  const scale = Math.max(Math.hypot(q[0] - p[0], q[1] - p[1]), Math.hypot(s[0] - r[0], s[1] - r[1]))
  const tol = eps * Math.max(scale, 1e-12)
  if (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  ) {
    return true
  }
  const near = (a: Vec2, b: Vec2, c: Vec2, d: number) => {
    if (Math.abs(d) > tol) return false
    return (
      c[0] >= Math.min(a[0], b[0]) - eps &&
      c[0] <= Math.max(a[0], b[0]) + eps &&
      c[1] >= Math.min(a[1], b[1]) - eps &&
      c[1] <= Math.max(a[1], b[1]) + eps
    )
  }
  return near(r, s, p, d1) || near(r, s, q, d2) || near(p, q, r, d3) || near(p, q, s, d4)
}

export function polygonsMeet(a: readonly Vec2[], b: readonly Vec2[], eps = 1e-7): boolean {
  const boxA = boxOf(a)
  const boxB = boxOf(b)
  if (!boxesMeet(boxA, boxB, eps)) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = a[(i + 1) % a.length]
    const segment: Box = [
      Math.min(p[0], q[0]),
      Math.min(p[1], q[1]),
      Math.max(p[0], q[0]),
      Math.max(p[1], q[1]),
    ]
    if (!boxesMeet(segment, boxB, eps)) continue
    for (let j = 0; j < b.length; j++) {
      if (segmentsMeet(p, q, b[j], b[(j + 1) % b.length], eps)) return true
    }
  }
  return false
}

export function selfOverlapping(group: AreaGroup): boolean {
  const { rings } = group
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      if (polygonsMeet(rings[i].polygon, rings[j].polygon)) return true
    }
  }
  return false
}

export function groupsInteract(a: AreaGroup, b: AreaGroup): boolean {
  for (const ringA of a.rings) {
    for (const ringB of b.rings) if (polygonsMeet(ringA.polygon, ringB.polygon)) return true
  }
  const probe = (group: AreaGroup) => group.rings.find((ring) => ring.polygon.length)?.polygon[0]
  const inA = probe(a)
  const inB = probe(b)
  return (!!inA && b.filled(inA)) || (!!inB && a.filled(inB))
}

function faceOnPlane(oc: OcAny, curves: Curve2D[]): OcShape {
  const sketch = new Blueprint(curves).sketchOnPlane('XY')
  const plane = new oc.gp_Pln_1()
  const maker = new oc.BRepBuilderAPI_MakeFace_16(plane, sketch.wire.wrapped, true)
  try {
    if (!maker.IsDone()) throw new Error('An outline could not be turned into a face.')
    return maker.Face()
  } finally {
    maker.delete()
    plane.delete()
    sketch.delete()
  }
}

function edgeCurve(oc: OcAny, edge: OcShape, face: OcShape): Curve2D {
  const castEdge = oc.TopoDS.Edge_1(edge)
  const castFace = oc.TopoDS.Face_1(face)
  const adaptor = new oc.BRepAdaptor_Curve2d_2(castEdge, castFace)
  try {
    const basis = adaptor.Curve()
    const trimmed = new oc.Geom2d_TrimmedCurve(
      basis,
      adaptor.FirstParameter(),
      adaptor.LastParameter(),
      true,
      true,
    )
    return fromHandle(new oc.Handle_Geom2d_Curve_2(trimmed))
  } finally {
    adaptor.delete()
    castFace.delete()
    castEdge.delete()
  }
}

function sampleCurve(curve: Curve2D, steps: number): Vec2[] {
  const first = curve.firstParameter
  const last = curve.lastParameter
  const count = curve.geomType === 'LINE' ? 1 : steps
  return Array.from({ length: count + 1 }, (_, i) => {
    const [x, y] = curve.value(first + ((last - first) * i) / count)
    return [x, y] as Vec2
  })
}

function interiorPoint(segments: ReadonlyArray<readonly [Vec2, Vec2]>): Vec2 | null {
  let y0 = Infinity
  let y1 = -Infinity
  for (const [a, b] of segments) {
    y0 = Math.min(y0, a[1], b[1])
    y1 = Math.max(y1, a[1], b[1])
  }
  if (!(y1 > y0)) return null
  let best: { at: Vec2; width: number } | null = null
  for (const fraction of [0.5, 0.31, 0.69, 0.17, 0.83, 0.43, 0.57, 0.07, 0.93]) {
    const y = y0 + (y1 - y0) * fraction
    const xs: number[] = []
    for (const [a, b] of segments) {
      if (a[1] > y === b[1] > y) continue
      xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1] - xs[i]
      if (!best || width > best.width) best = { at: [(xs[i] + xs[i + 1]) / 2, y], width }
    }
    if (best && best.width > (y1 - y0) * 0.05) break
  }
  return best?.at ?? null
}

function nearestPiece(
  point: Vec2,
  rings: readonly AreaRing[],
): { ring: AreaRing; index: number } | null {
  let best: { ring: AreaRing; index: number; distance: number } | null = null
  for (const ring of rings) {
    ring.curves.forEach((curve, index) => {
      const box = curve.boundingBox
      const [[x0, y0], [x1, y1]] = box.bounds
      const pad = best ? best.distance : Infinity
      if (
        point[0] < x0 - pad ||
        point[0] > x1 + pad ||
        point[1] < y0 - pad ||
        point[1] > y1 + pad
      ) {
        return
      }
      const distance = curve.distanceFrom(point)
      if (!best || distance < best.distance) best = { ring, index, distance }
    })
  }
  return best
}

function orientedLoops(
  curves: Curve2D[],
  ends: Array<[number, number]>,
): Array<{ curves: Curve2D[]; polygon: Vec2[] }> {
  const used = new Uint8Array(curves.length)
  const at = new Map<number, number[]>()
  ends.forEach(([a, b], index) => {
    at.set(a, [...(at.get(a) ?? []), index])
    at.set(b, [...(at.get(b) ?? []), index])
  })
  const loops: Array<{ curves: Curve2D[]; polygon: Vec2[] }> = []
  for (let seed = 0; seed < curves.length; seed++) {
    if (used[seed]) continue
    const chain: Curve2D[] = []
    const polygon: Vec2[] = []
    const start = ends[seed][0]
    let vertex = start
    let edge = seed
    for (let guard = 0; guard <= curves.length; guard++) {
      used[edge] = 1
      const curve = curves[edge]
      const [a, b] = ends[edge]
      if (a !== vertex) {
        curve.reverse()
        ends[edge] = [b, a]
      }
      chain.push(curve)
      polygon.push(...sampleCurve(curve, CLASSIFY_STEPS).slice(0, -1))
      vertex = ends[edge][1]
      if (vertex === start) break
      const next = (at.get(vertex) ?? []).find((candidate) => !used[candidate])
      if (next === undefined) break
      edge = next
    }
    if (vertex === start && chain.length) loops.push({ curves: chain, polygon })
  }
  return loops
}

export function arrangeAreas(
  oc: OcAny,
  groups: readonly AreaGroup[],
  keep: (point: Vec2) => boolean,
): { shapes: AreaShape[]; pieces: PieceSample[] } {
  const rings = groups.flatMap((group) => group.rings)
  const list = new oc.TopTools_ListOfShape_1()
  const faces: OcShape[] = []
  const builder = new oc.BRepAlgoAPI_BuilderAlgo_1()
  const progress = new oc.Message_ProgressRange_1()
  let result: OcShape | null = null
  let topology: ReturnType<typeof exploreTopology> | null = null
  try {
    for (const ring of rings) {
      const face = faceOnPlane(oc, ring.curves)
      faces.push(face)
      list.Append_1(face)
    }
    builder.SetArguments(list)
    builder.SetRunParallel(false)
    builder.SetFuzzyValue(1e-7)
    builder.Build(progress)
    if (!builder.IsDone() || builder.HasErrors()) {
      throw new Error('The outlines could not be combined.')
    }
    result = builder.Shape()
    topology = exploreTopology(oc, result!)
    const adjacency = adjacencyOf(topology)
    const faceCurves = new Map<number, Curve2D>()
    const kept = topology.faces.map((face, index) => {
      const segments: Array<[Vec2, Vec2]> = []
      for (const edgeIndex of topology!.faceEdges[index]) {
        const curve = edgeCurve(oc, topology!.edges[edgeIndex], face)
        if (!faceCurves.has(edgeIndex)) faceCurves.set(edgeIndex, curve)
        const points = sampleCurve(curve, CLASSIFY_STEPS)
        for (let i = 0; i + 1 < points.length; i++) segments.push([points[i], points[i + 1]])
      }
      const inside = interiorPoint(segments)
      return !!inside && keep(inside)
    })
    const boundary: number[] = []
    adjacency.edgeFaces.forEach((owners, edgeIndex) => {
      if (owners.filter((face) => kept[face]).length === 1) boundary.push(edgeIndex)
    })
    const curves = boundary.map((edgeIndex) => faceCurves.get(edgeIndex)!)
    const ends = boundary.map((edgeIndex): [number, number] => {
      const vertices = topology!.edgeVertices[edgeIndex]
      if (vertices.length < 2) return [vertices[0], vertices[0]]
      const curve = faceCurves.get(edgeIndex)!
      const first = curve.firstPoint
      const point = (vertex: number) => {
        const cast = oc.TopoDS.Vertex_1(topology!.vertices[vertex])
        const pnt = oc.BRep_Tool.Pnt(cast)
        const out: Vec2 = [pnt.X(), pnt.Y()]
        pnt.delete()
        cast.delete()
        return out
      }
      const a = point(vertices[0])
      const b = point(vertices[1])
      return Math.hypot(a[0] - first[0], a[1] - first[1]) <=
        Math.hypot(b[0] - first[0], b[1] - first[1])
        ? [vertices[0], vertices[1]]
        : [vertices[1], vertices[0]]
    })
    const loops = orientedLoops(curves, ends)
    const pieces: PieceSample[] = []
    for (const loop of loops) {
      for (const curve of loop.curves) {
        const mid = curve.value((curve.firstParameter + curve.lastParameter) / 2)
        const source = nearestPiece([mid[0], mid[1]], rings)
        if (!source) continue
        const piece = source.ring.pieces[source.index]
        const start = curve.firstPoint
        const end = curve.lastPoint
        const whole =
          (Math.hypot(start[0] - piece.start[0], start[1] - piece.start[1]) < 1e-7 &&
            Math.hypot(end[0] - piece.end[0], end[1] - piece.end[1]) < 1e-7) ||
          (Math.hypot(start[0] - piece.end[0], start[1] - piece.end[1]) < 1e-7 &&
            Math.hypot(end[0] - piece.start[0], end[1] - piece.start[1]) < 1e-7)
        pieces.push({
          entityId: piece.entityId,
          token: whole ? piece.token : `${piece.token}~`,
          start: [start[0], start[1]],
          end: [end[0], end[1]],
        })
      }
    }
    const depth = loops.map(
      (loop, i) =>
        loops.filter((other, j) => j !== i && winding(other.polygon, loop.polygon[0]) !== 0).length,
    )
    const shapes: AreaShape[] = []
    loops.forEach((loop, i) => {
      if (depth[i] % 2 !== 0) return
      const holes = loops.filter(
        (hole, j) => depth[j] === depth[i] + 1 && winding(loop.polygon, hole.polygon[0]) !== 0,
      )
      const outer = new Blueprint(loop.curves)
      shapes.push(
        holes.length
          ? new CompoundBlueprint([outer, ...holes.map((hole) => new Blueprint(hole.curves))])
          : outer,
      )
    })
    return { shapes, pieces }
  } finally {
    if (topology) disposeTopology(topology)
    result?.delete()
    for (const face of faces) face.delete()
    progress.delete()
    builder.delete()
    list.delete()
  }
}
