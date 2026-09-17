import {
  cast,
  downcast,
  draw,
  drawCircle,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  Face,
  getOC,
  makeBox,
  makeCylinder,
  Plane,
  sketchCircle,
  type Drawing,
} from 'replicad'
import {
  frameToLocal,
  frameToWorld,
  makeFrame,
  v3,
  type Frame,
  type Vec2,
  type Vec3,
} from '../core/math'
import type { Sketch2D } from '../sketch/types'
import type {
  BodyOperation,
  ElementRef,
  Feature,
  HoleFeature,
  LidFeature,
  Matrix4,
  OkcDocument,
  PlaneRef,
  PositionSource,
  SketchFeature,
  StandoffFeature,
  VentFeature,
} from '../doc/types'
import type { KernelError } from './types'
import { sketchToProfile } from './profile'
import {
  featureDependencies,
  findBody,
  findComponent,
  identityMatrix,
  invertRigidMatrix,
  multiplyMatrices,
  pathComponent,
  pathMatrix,
  rotationMatrix,
  transformPoint,
  translationMatrix,
} from '../doc/model'
import { datumFrame, midplaneFrame, offsetFrame } from '../doc/planes'
import { getPart, type CataloguePart } from '../catalogue'
import {
  box as namedBox,
  chamfer as namedChamfer,
  common,
  cut,
  cylinder as namedCylinder,
  extrude as namedExtrude,
  fillet as namedFillet,
  fuse,
  isPlanarFace,
  nameShape,
  NamingError,
  resolveElement,
  revolve as namedRevolve,
  shell as namedShell,
  sphere as namedSphere,
  torus as namedTorus,
  transformNamed,
  type ElementMap,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'

import {
  CONVERT_LIMIT,
  meshToShape,
  runMeshStep,
  tessellateShape,
  type MeshBodyState,
} from './meshSteps'
import { meshBounds, transformMesh, triangleCount, type TriMesh } from '../mesh/types'
import { runSolidStep, type SolidStage } from './solidSteps'
import { runFitStep } from './fitSteps'
import { sketchChains } from '../sketch/chains'
import { chainBlueprint } from './profile'

export const CUT_MARGIN = 0.5
const THROUGH_LENGTH = 1000
const LID_REACH = 4000

export interface BodyState {
  shape: any
  map: ElementMap<OcShape>
  key: string
  featureId: string
}

export interface PreShell {
  shape: any
  frame: Frame
}

function occ(): OC {
  return getOC() as unknown as OC
}

export function isIdentity(m: Matrix4): boolean {
  const id = identityMatrix()
  return m.every((value, i) => Math.abs(value - id[i]) < 1e-12)
}

export function transformShape(shape: any, m: Matrix4): any {
  if (isIdentity(m)) return shape.clone()
  const oc = getOC() as any
  const trsf = new oc.gp_Trsf_1()
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14])
  const builder = new oc.BRepBuilderAPI_Transform_2(shape.wrapped, trsf, true)
  const result = cast(builder.ModifiedShape(shape.wrapped))
  builder.delete()
  trsf.delete()
  return result
}

function namedOf(state: BodyState): NamedShape {
  return { shape: state.shape.wrapped, map: state.map }
}

function releaseNamed(shapes: NamedShape[]): void {
  for (const named of shapes) {
    named.map.dispose()
    named.shape.delete()
  }
}

export function faceFrame(state: BodyState, ref: ElementRef, offset: number): Frame {
  const resolution = resolveElement(state.map, {
    bodyId: ref.bodyId,
    kind: 'face',
    name: ref.name,
  })
  if (!resolution.ok) throw new NamingError(resolution.error)
  if (!isPlanarFace(occ(), resolution.element.shape)) {
    throw new Error('Only a flat face can hold a sketch or a plane.')
  }
  const face = new Face(occ().TopoDS.Face_1(resolution.element.shape))
  try {
    const c = face.center
    const n = face.normalAt()
    const normal = v3.norm([n.x, n.y, n.z])
    const along = v3.dot([c.x, c.y, c.z], normal) + offset
    return makeFrame(v3.scale(normal, along), normal)
  } finally {
    face.delete()
  }
}

function opensBesideCurvedFace(state: BodyState, openFaces: readonly ElementRef[]): boolean {
  const { topology } = state.map
  const openings = openFaces.flatMap((ref) => {
    const resolution = resolveElement(state.map, ref)
    return resolution.ok ? [resolution.element.index] : []
  })
  const borders = new Set(openings.flatMap((index) => topology.faceEdges[index]))
  return topology.faceEdges.some(
    (edges, index) =>
      !openings.includes(index) &&
      edges.some((edge) => borders.has(edge)) &&
      !isPlanarFace(occ(), topology.faces[index]),
  )
}

export function frameFromPlaneRef(
  ref: PlaneRef,
  bodies: ReadonlyMap<string, BodyState>,
  planes?: ReadonlyMap<string, Frame>,
): Frame {
  if (ref.kind === 'construction') {
    const frame = planes?.get(ref.featureId)
    if (!frame) {
      throw new Error(
        'The construction plane this uses does not exist at this point in the timeline.',
      )
    }
    return offsetFrame(frame, ref.offset)
  }
  if (ref.kind !== 'face') return datumFrame(ref)
  const state = bodies.get(ref.face.bodyId)
  if (!state) {
    throw new Error(
      'The face this is placed on belongs to a body that does not exist at this point in the timeline.',
    )
  }
  return faceFrame(state, ref.face, ref.offset)
}

export function revolveAxis(
  sketch: Sketch2D,
  frame: Frame,
  feature: { axis: 'x' | 'y'; axisLine?: string },
): { origin: Vec3; direction: Vec3 } | null {
  if (!feature.axisLine) {
    return { origin: frame.origin, direction: feature.axis === 'x' ? frame.xDir : frame.yDir }
  }
  const line = sketch.entities.find((entity) => entity.id === feature.axisLine)
  if (line?.kind !== 'line') return null
  const p1 = sketch.points.find((point) => point.id === line.p1)
  const p2 = sketch.points.find((point) => point.id === line.p2)
  if (!p1 || !p2 || Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-9) return null
  const origin = frameToWorld(frame, [p1.x, p1.y])
  return { origin, direction: v3.norm(v3.sub(frameToWorld(frame, [p2.x, p2.y]), origin)) }
}

export function toReplicadPlane(frame: Frame, offset = 0): Plane {
  const origin = offset ? v3.add(frame.origin, v3.scale(frame.normal, offset)) : frame.origin
  return new Plane(origin, frame.xDir, frame.normal)
}

function sketchOn(drawing: Drawing, frame: Frame, offset = 0): any {
  return drawing.sketchOnPlane(toReplicadPlane(frame, offset)) as any
}

export function profileFace(drawing: Drawing, frame: Frame): any {
  const sketch = sketchOn(drawing, frame)
  return typeof sketch.face === 'function' ? sketch.face() : sketch.faces()
}

function boardOutlineDrawing(part: CataloguePart): Drawing | null {
  const g = part.geometry
  if (g.kind !== 'board') return null
  if (g.outline.shape === 'rect') {
    const { w, h, cornerRadius } = g.outline
    const base = cornerRadius ? drawRoundedRectangle(w, h, cornerRadius) : drawRectangle(w, h)
    return base.translate(w / 2, h / 2)
  }
  const pts = g.outline.points
  const pen = draw(pts[0])
  for (let i = 1; i < pts.length; i++) pen.lineTo(pts[i])
  return pen.close()
}

export function buildPartLocal(part: CataloguePart, overrides?: Record<string, number>): any {
  const g = part.geometry
  switch (g.kind) {
    case 'board': {
      const outline = boardOutlineDrawing(part)
      if (!outline) return null
      let solid: any = outline.sketchOnPlane('XY').extrude(g.thickness)
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(
          makeCylinder(hole.diameter / 2, g.thickness + 2, [hole.x, hole.y, -1], [0, 0, 1]),
        )
      }
      for (const bump of g.bumps ?? []) {
        const box = drawRectangle(bump.w, bump.h)
          .translate(bump.x + bump.w / 2, bump.y + bump.h / 2)
          .sketchOnPlane('XY', bump.z)
          .extrude(bump.height)
        solid = solid.fuse(box)
      }
      return solid
    }

    case 'extrusion': {
      const s = g.size
      const length = overrides?.length ?? g.length
      const slot = 6
      const inner = 11
      let profile: Drawing = drawRectangle(s, s).translate(s / 2, s / 2)
      for (let i = 0; i < (g.slots ?? 4); i++) {
        const mouth = drawRectangle(slot, 6).translate(s / 2, s - 3)
        const throat = drawRectangle(inner, 5).translate(s / 2, s - 8.5)
        let cutter = mouth.fuse(throat)
        cutter = cutter.rotate(i * 90, [s / 2, s / 2])
        profile = profile.cut(cutter)
      }
      profile = profile.cut(drawCircle(2.1).translate(s / 2, s / 2))
      return profile.sketchOnPlane('YZ').extrude(length)
    }

    case 'screw': {
      const r = g.headDiameter / 2
      let solid: any = makeCylinder(g.diameter / 2, g.length, [r, r, 0], [0, 0, 1])
      if (g.head === 'countersunk') {
        const cone = sketchCircle(g.headDiameter / 2, { origin: [r, r, g.length] }).loftWith(
          sketchCircle(g.diameter / 2, { origin: [r, r, g.length - g.headHeight] }),
        )
        solid = solid.fuse(cone)
      } else {
        solid = solid.fuse(
          makeCylinder(g.headDiameter / 2, g.headHeight, [r, r, g.length], [0, 0, 1]),
        )
      }
      return solid
    }

    case 'insert': {
      const r = g.outerDiameter / 2
      return makeCylinder(r, g.length, [r, r, 0], [0, 0, 1]).cut(
        makeCylinder(1.5, g.length + 2, [r, r, -1], [0, 0, 1]),
      )
    }

    case 'standoff': {
      const circumradius = g.acrossFlats / Math.sqrt(3)
      const r = g.acrossFlats / 2
      const body: any = drawPolysides(circumradius, 6)
        .translate(r, r)
        .sketchOnPlane('XY')
        .extrude(g.length)
      const boreRadius = Number(g.thread.replace(/[^0-9.]/g, '')) / 2 || 1.25
      return body.cut(makeCylinder(boreRadius, g.length + 2, [r, r, -1], [0, 0, 1]))
    }

    case 'motor': {
      const f = g.frame
      let solid: any = drawRoundedRectangle(f, f, 4)
        .translate(f / 2, f / 2)
        .sketchOnPlane('XY')
        .extrude(g.bodyLength)
      solid = solid.fuse(
        makeCylinder(g.bossDiameter / 2, g.bossHeight, [f / 2, f / 2, g.bodyLength], [0, 0, 1]),
      )
      solid = solid.fuse(
        makeCylinder(
          g.shaftDiameter / 2,
          g.shaftLength,
          [f / 2, f / 2, g.bodyLength + g.bossHeight],
          [0, 0, 1],
        ),
      )
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(
          makeCylinder(hole.diameter / 2, 6, [hole.x, hole.y, g.bodyLength - 5], [0, 0, 1]),
        )
      }
      return solid
    }

    case 'bearing': {
      const r = g.outerDiameter / 2
      return makeCylinder(r, g.width, [r, r, 0], [0, 0, 1]).cut(
        makeCylinder(g.innerDiameter / 2, g.width + 2, [r, r, -1], [0, 0, 1]),
      )
    }

    case 'connector': {
      const { bodyWidth: w, bodyHeight: h, bodyDepth: d, protrusion } = g
      let solid: any = makeBox([0, 0, 0], [w, d, h])
      if (protrusion > 0) {
        if (g.cutout.shape === 'rect') {
          const halfW = g.cutout.w / 2
          const halfH = g.cutout.h / 2
          solid = solid.fuse(
            makeBox(
              [w / 2 - halfW, d, h / 2 - halfH],
              [w / 2 + halfW, d + protrusion, h / 2 + halfH],
            ),
          )
        } else {
          solid = solid.fuse(makeCylinder(g.cutout.d / 2, protrusion, [w / 2, d, h / 2], [0, 1, 0]))
        }
      }
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(makeCylinder(hole.diameter / 2, d + 2, [hole.x, -1, hole.y], [0, 1, 0]))
      }
      return solid
    }
  }
}

export interface PlacedPart {
  part: CataloguePart | undefined
  matrix: Matrix4
}

export function placedPart(
  doc: OkcDocument,
  occurrencePath: string[],
  contextPath: string[],
): PlacedPart | null {
  if (!occurrencePath.length) return null
  const partMatrix = pathMatrix(doc, occurrencePath)
  const contextMatrix = pathMatrix(doc, contextPath)
  const componentId = pathComponent(doc, occurrencePath)
  const component = componentId ? findComponent(doc, componentId) : undefined
  if (!partMatrix || !contextMatrix || component?.source.kind !== 'catalogue') return null
  return {
    part: getPart(component.source.partId),
    matrix: multiplyMatrices(invertRigidMatrix(contextMatrix), partMatrix),
  }
}

function occurrenceInputs(
  feature: Feature,
): Array<{ occurrencePath: string[]; contextPath: string[] }> {
  if (
    (feature.kind === 'hole' || feature.kind === 'standoff') &&
    feature.source.kind === 'occurrence'
  )
    return [feature.source]
  if (feature.kind === 'portCutout') return [feature]
  return []
}

export function externalInputs(doc: OkcDocument, feature: Feature): unknown[] {
  return occurrenceInputs(feature).map(({ occurrencePath, contextPath }) => {
    const componentId = pathComponent(doc, occurrencePath)
    const component = componentId ? findComponent(doc, componentId) : undefined
    const source = component?.source ?? null
    return {
      occurrence: pathMatrix(doc, occurrencePath),
      context: pathMatrix(doc, contextPath),
      componentId,
      source,
      part: source?.kind === 'catalogue' ? (getPart(source.partId) ?? null) : null,
    }
  })
}

function resolvePositions(source: PositionSource, frame: Frame, doc: OkcDocument): Vec2[] | null {
  if (source.kind === 'explicit') return source.positions
  const placed = placedPart(doc, source.occurrencePath, source.contextPath)
  if (!placed) return null
  const holes = placed.part?.mountingHoles
  if (!holes) return []
  const wanted = source.holeIds?.length
    ? holes.filter((h) => source.holeIds!.includes(h.id))
    : holes
  return wanted.map((h) => frameToLocal(frame, transformPoint(placed.matrix, [h.x, h.y, 0])))
}

function buildHoleCutter(feature: HoleFeature, frame: Frame, positions: Vec2[]): any | null {
  const depth = feature.depth === 'through' ? THROUGH_LENGTH : feature.depth
  let cutter: any = null
  for (const [u, v] of positions) {
    const shaft = sketchOn(
      drawCircle(feature.diameter / 2).translate(u, v),
      frame,
      CUT_MARGIN,
    ).extrude(-(depth + CUT_MARGIN))
    let piece: any = shaft
    if (feature.style === 'counterbore' && feature.counterboreDiameter) {
      const cb = sketchOn(
        drawCircle(feature.counterboreDiameter / 2).translate(u, v),
        frame,
        CUT_MARGIN,
      ).extrude(-((feature.counterboreDepth ?? 3) + CUT_MARGIN))
      piece = piece.fuse(cb)
    }
    if (feature.style === 'countersink') {
      const angle = ((feature.countersinkAngle ?? 90) * Math.PI) / 180
      const headRadius = (feature.counterboreDiameter ?? feature.diameter * 2) / 2
      const coneDepth = (headRadius - feature.diameter / 2) / Math.tan(angle / 2)
      const top = sketchOn(drawCircle(headRadius).translate(u, v), frame, 0)
      const bottom = sketchOn(drawCircle(feature.diameter / 2).translate(u, v), frame, -coneDepth)
      piece = piece.fuse(top.loftWith(bottom))
    }
    cutter = cutter ? cutter.fuse(piece) : piece
  }
  return cutter
}

function buildStandoffs(
  feature: StandoffFeature,
  frame: Frame,
  positions: Vec2[],
): { solid: any | null; bores: any | null } {
  let solid: any = null
  let bores: any = null
  for (const [u, v] of positions) {
    const pillar = sketchOn(drawCircle(feature.outerDiameter / 2).translate(u, v), frame).extrude(
      feature.height,
    )
    solid = solid ? solid.fuse(pillar) : pillar
    const bore = sketchOn(
      drawCircle(feature.boreDiameter / 2).translate(u, v),
      frame,
      feature.height + CUT_MARGIN,
    ).extrude(-(feature.boreDepth + CUT_MARGIN))
    bores = bores ? bores.fuse(bore) : bore
  }
  return { solid, bores }
}

function buildPortCutters(
  placed: PlacedPart,
  connectorIds: string[],
  tolerance: number,
): any | null {
  const part = placed.part
  if (!part?.connectors?.length) return null
  const wanted = connectorIds.length
    ? part.connectors.filter((c) => connectorIds.includes(c.id))
    : part.connectors
  let cutter: any = null
  const REACH = 60
  for (const c of wanted) {
    const along = c.protrusion + REACH
    const dir: Vec3 =
      c.side === '+x'
        ? [1, 0, 0]
        : c.side === '-x'
          ? [-1, 0, 0]
          : c.side === '+y'
            ? [0, 1, 0]
            : [0, -1, 0]
    let piece: any
    if (c.shape === 'circle') {
      const radius = (c.diameter ?? c.width) / 2 + tolerance
      const start: Vec3 = [c.x - dir[0] * 2, c.y - dir[1] * 2, c.z]
      piece = makeCylinder(radius, along + 2, start, dir)
    } else {
      const halfW = c.width / 2 + tolerance
      const zLo = c.z - tolerance
      const zHi = c.z + c.height + tolerance
      let lo: Vec3
      let hi: Vec3
      switch (c.side) {
        case '+x':
          lo = [c.x - 2, c.y - halfW, zLo]
          hi = [c.x + along, c.y + halfW, zHi]
          break
        case '-x':
          lo = [c.x - along, c.y - halfW, zLo]
          hi = [c.x + 2, c.y + halfW, zHi]
          break
        case '+y':
          lo = [c.x - halfW, c.y - 2, zLo]
          hi = [c.x + halfW, c.y + along, zHi]
          break
        case '-y':
          lo = [c.x - halfW, c.y - along, zLo]
          hi = [c.x + halfW, c.y + 2, zHi]
          break
      }
      piece = drawRectangle(hi[0] - lo[0], hi[1] - lo[1])
        .translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
        .sketchOnPlane('XY', lo[2])
        .extrude(hi[2] - lo[2])
    }
    cutter = cutter ? cutter.fuse(piece) : piece
  }
  return cutter ? transformShape(cutter, placed.matrix) : null
}
function buildVentCutter(feature: VentFeature, frame: Frame, target: any): any | null {
  const [min, max] = target.boundingBox.bounds
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const [u, v] = frameToLocal(frame, [x, y, z])
        uMin = Math.min(uMin, u)
        uMax = Math.max(uMax, u)
        vMin = Math.min(vMin, v)
        vMax = Math.max(vMax, v)
      }
    }
  }

  const size = Math.max(feature.size, 0.2)
  const pitch = size + Math.max(feature.spacing, 0.2)
  const rowStep = feature.shape === 'hex' ? (pitch * Math.sqrt(3)) / 2 : pitch
  const inset = feature.margin + size / 2
  const u0 = uMin + inset
  const u1 = uMax - inset
  const v0 = vMin + inset
  const v1 = vMax - inset
  if (u1 < u0 || v1 < v0) return null

  const depth = feature.depth === 'through' ? THROUGH_LENGTH : feature.depth
  const centres: Vec2[] = []
  const midU = (u0 + u1) / 2
  const midV = (v0 + v1) / 2
  const addRow = (v: number, staggered: boolean) => {
    const shift = feature.shape === 'hex' && staggered ? pitch / 2 : 0
    for (let u = midU + shift; u <= u1 + 1e-9; u += pitch) centres.push([u, v])
    for (let u = midU + shift - pitch; u >= u0 - 1e-9; u -= pitch) centres.push([u, v])
  }
  let row = 0
  for (let v = midV; v <= v1 + 1e-9; v += rowStep) addRow(v, row++ % 2 === 1)
  row = 1
  for (let v = midV - rowStep; v >= v0 - 1e-9; v -= rowStep) addRow(v, row++ % 2 === 1)
  if (centres.length === 0) return null

  const outline = (row: number): Drawing => {
    switch (feature.shape) {
      case 'round':
        return drawCircle(size / 2)
      case 'square':
        return drawRectangle(size, size)
      case 'diamond':
        return drawPolysides(size / 2, 4).rotate(45)
      case 'triangle':
        return drawPolysides(size / Math.sqrt(3), 3).rotate(row % 2 === 0 ? 0 : 180)
      case 'cross': {
        const arm = size / 3
        return drawRectangle(size, arm).fuse(drawRectangle(arm, size))
      }
      case 'slot':
        return drawRoundedRectangle(size, Math.min(size, pitch) / 2, Math.min(size, pitch) / 4)
      default:
        return drawPolysides(size / Math.sqrt(3), 6)
    }
  }

  let merged: Drawing | null = null
  if (feature.shape === 'gyroid') {
    merged = gyroidHoles(u0, u1, v0, v1, size, Math.max(feature.spacing, 0.2))
  } else {
    for (const [u, v] of centres) {
      const row = Math.round((v - midV) / rowStep)
      const piece = outline(((row % 2) + 2) % 2).translate(u, v)
      merged = merged ? merged.fuse(piece) : piece
    }
  }
  if (!merged) return null
  return sketchOn(merged, frame, CUT_MARGIN).extrude(-(depth + CUT_MARGIN))
}

function gyroidHoles(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  cell: number,
  web: number,
): Drawing | null {
  const k = (2 * Math.PI) / Math.max(cell, 1)
  const s = Math.SQRT1_2
  const f = (u: number, v: number) =>
    Math.sin(k * u) * Math.cos(k * v) + s * (Math.sin(k * v) + Math.cos(k * u))

  let gradSum = 0
  let gradN = 0
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const u = u0 + ((u1 - u0) * i) / 23
      const v = v0 + ((v1 - v0) * j) / 23
      if (Math.abs(f(u, v)) > 0.15) continue
      const h = 1e-4
      gradSum += Math.hypot(
        (f(u + h, v) - f(u - h, v)) / (2 * h),
        (f(u, v + h) - f(u, v - h)) / (2 * h),
      )
      gradN++
    }
  }
  const grad = gradN > 0 ? gradSum / gradN : k
  const threshold = (web / 2) * grad

  const step = Math.max(Math.min(cell / 10, 1.2), 0.25)
  const nu = Math.min(Math.ceil((u1 - u0) / step) + 1, 400)
  const nv = Math.min(Math.ceil((v1 - v0) / step) + 1, 400)
  const du = (u1 - u0) / (nu - 1)
  const dv = (v1 - v0) / (nv - 1)

  const grid: number[][] = []
  for (let i = 0; i < nu; i++) {
    grid[i] = []
    for (let j = 0; j < nv; j++) {
      const edge = i === 0 || j === 0 || i === nu - 1 || j === nv - 1
      grid[i][j] = edge ? -1 : f(u0 + i * du, v0 + j * dv) - threshold
    }
  }

  const loops = marchingSquares(grid, u0, v0, du, dv)
  let merged: Drawing | null = null
  for (const loop of loops) {
    if (loop.length < 4) continue
    let pen = draw(loop[0])
    for (let i = 1; i < loop.length; i++) pen = pen.lineTo(loop[i])
    let piece: Drawing
    try {
      piece = pen.close()
    } catch {
      continue
    }
    merged = merged ? merged.fuse(piece) : piece
  }
  return merged
}

function marchingSquares(
  grid: number[][],
  u0: number,
  v0: number,
  du: number,
  dv: number,
): Vec2[][] {
  const nu = grid.length
  const nv = grid[0].length
  const segments: Array<[Vec2, Vec2]> = []
  const lerp = (a: number, b: number): number => {
    const d = a - b
    return Math.abs(d) < 1e-12 ? 0.5 : a / d
  }

  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = grid[i][j]
      const b = grid[i + 1][j]
      const c = grid[i + 1][j + 1]
      const d = grid[i][j + 1]
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (code === 0 || code === 15) continue
      const x = u0 + i * du
      const y = v0 + j * dv
      const bottom: Vec2 = [x + du * lerp(a, b), y]
      const right: Vec2 = [x + du, y + dv * lerp(b, c)]
      const top: Vec2 = [x + du * lerp(d, c), y + dv]
      const left: Vec2 = [x, y + dv * lerp(a, d)]
      const push = (p: Vec2, q: Vec2) => segments.push([p, q])
      switch (code) {
        case 1:
        case 14:
          push(left, bottom)
          break
        case 2:
        case 13:
          push(bottom, right)
          break
        case 3:
        case 12:
          push(left, right)
          break
        case 4:
        case 11:
          push(right, top)
          break
        case 6:
        case 9:
          push(bottom, top)
          break
        case 7:
        case 8:
          push(left, top)
          break
        case 5: {
          if ((a + b + c + d) / 4 > 0) {
            push(left, top)
            push(bottom, right)
          } else {
            push(left, bottom)
            push(right, top)
          }
          break
        }
        case 10: {
          if ((a + b + c + d) / 4 > 0) {
            push(left, bottom)
            push(right, top)
          } else {
            push(left, top)
            push(bottom, right)
          }
          break
        }
      }
    }
  }
  if (segments.length === 0) return []

  const key = (p: Vec2) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`
  const bins = new Map<string, Array<[Vec2, Vec2]>>()
  for (const seg of segments) {
    for (const end of [key(seg[0]), key(seg[1])]) {
      const list = bins.get(end)
      if (list) list.push(seg)
      else bins.set(end, [seg])
    }
  }

  const used = new Set<Array<Vec2>>()
  const loops: Vec2[][] = []
  for (const start of segments) {
    if (used.has(start as unknown as Array<Vec2>)) continue
    used.add(start as unknown as Array<Vec2>)
    const loop: Vec2[] = [start[0], start[1]]
    let head = start[1]
    for (let guard = 0; guard < segments.length + 4; guard++) {
      const options = bins.get(key(head)) ?? []
      const next = options.find((seg) => !used.has(seg as unknown as Array<Vec2>))
      if (!next) break
      used.add(next as unknown as Array<Vec2>)
      const onward = key(next[0]) === key(head) ? next[1] : next[0]
      if (key(onward) === key(loop[0])) break
      loop.push(onward)
      head = onward
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

function frameSlab(frame: Frame, from: number, to: number): any {
  return sketchOn(drawRectangle(LID_REACH, LID_REACH), frame, from).extrude(to - from)
}

function insetSolid(solid: any, d: number, frame: Frame): any {
  if (d <= 1e-9) return solid.clone()
  const walls = solid
    .clone()
    .shell(d, (f: any) => f.inPlane(new Plane(frame.origin, null, frame.normal)))
  return solid.clone().cut(walls)
}

function lidProportions(wall: number, thickness: number) {
  const skirt = Math.max(Math.min(wall * 0.6, wall - 0.4), 0.8)
  const depth = Math.max(3, thickness * 2)
  const bead = 0.4
  const bandHeight = Math.min(1, depth * 0.3)
  const bandCentre = thickness + depth * 0.6
  return {
    ledge: wall / 2,
    skirt,
    depth,
    bead,
    bandLo: bandCentre + bandHeight / 2,
    bandHi: bandCentre - bandHeight / 2,
  }
}

function wallOfShell(doc: OkcDocument, shellFeatureId: string): number | null {
  const shell = doc.timeline.find((f) => f.id === shellFeatureId)
  return shell?.kind === 'shell' ? Math.abs(shell.thickness) : null
}

function seatCutter(lid: LidFeature, source: PreShell, wall: number): any | null {
  const fit = lid.fit ?? 'friction'
  if (fit === 'friction') return null
  const t = Math.abs(lid.thickness)
  const c = lid.clearance ?? 0
  const prop = lidProportions(wall, t)
  if (fit === 'ledge') {
    return insetSolid(source.shape, wall - prop.ledge, source.frame).intersect(
      frameSlab(source.frame, -t, 0),
    )
  }
  return insetSolid(source.shape, wall - prop.bead, source.frame).intersect(
    frameSlab(source.frame, -(prop.bandLo + c), -(prop.bandHi - c)),
  )
}

function buildLid(lid: LidFeature, source: PreShell, wall: number, walls: any | null): any {
  const t = Math.abs(lid.thickness)
  const c = lid.clearance ?? 0
  const fit = lid.fit ?? 'friction'
  const prop = lidProportions(wall, t)
  const plugInset = fit === 'ledge' ? wall - prop.ledge + c : wall + c
  let cap = insetSolid(source.shape, plugInset, source.frame).intersect(
    frameSlab(source.frame, -t, 0),
  )
  if (fit === 'snap') {
    const outer = insetSolid(source.shape, wall + c, source.frame)
    const inner = insetSolid(source.shape, wall + c + prop.skirt, source.frame)
    const skirt = outer
      .clone()
      .cut(inner.clone())
      .intersect(frameSlab(source.frame, -(t + prop.depth), -t))
    cap = cap.fuse(skirt)
    const proud = insetSolid(source.shape, wall + c - prop.bead, source.frame)
    const ring = proud.cut(inner).intersect(frameSlab(source.frame, -prop.bandLo, -prop.bandHi))
    cap = cap.fuse(ring)
  }
  if (walls) {
    const seat = seatCutter(lid, source, wall)
    cap = cap.cut(seat ? walls.cut(seat) : walls)
  }
  return cap
}

function hintForFailure(feature: Feature, message: string): string | undefined {
  const m = message.toLowerCase()
  if (feature.kind === 'fillet' || feature.kind === 'chamfer') {
    return 'The radius is probably too big for the edge it is being applied to. Try a smaller number.'
  }
  if (feature.kind === 'shell') {
    return 'Hollowing fails when the wall is thicker than the smallest detail on the shape. Try a thinner wall.'
  }
  if (feature.kind === 'lid') {
    return 'A thinner wall, a smaller gap, or a plain drop-in fit will usually go through.'
  }
  if (feature.kind === 'lidSocket') {
    return 'The wall may be too thin for this kind of fit. Try a thicker wall or a plain drop-in lid.'
  }
  if (
    feature.kind === 'snapFit' ||
    feature.kind === 'fitPins' ||
    feature.kind === 'lipGroove' ||
    feature.kind === 'dovetail' ||
    feature.kind === 'snapRing' ||
    feature.kind === 'bayonet' ||
    feature.kind === 'hinge'
  ) {
    return 'Moving it a little away from edges and corners, or making it smaller, usually lets it build.'
  }
  if (m.includes('null') || m.includes('undefined')) {
    return 'Something this step depends on is missing. Check the steps before it.'
  }
  return undefined
}
export interface Snapshot {
  key: string
  bodies: ReadonlyMap<string, BodyState>
  meshBodies: ReadonlyMap<string, MeshBodyState>
  sketches: ReadonlyMap<string, SketchFeature>
  preShell: ReadonlyMap<string, PreShell>
  planes: ReadonlyMap<string, Frame>
  errors: readonly KernelError[]
  failed: ReadonlySet<string>
}

export function emptySnapshot(key: string): Snapshot {
  return {
    key,
    bodies: new Map(),
    meshBodies: new Map(),
    sketches: new Map(),
    preShell: new Map(),
    planes: new Map(),
    errors: [],
    failed: new Set(),
  }
}

export type ToolCapture = (shape: any, kind: 'cut' | 'intersect', owned: boolean) => void

export interface FeatureContext {
  doc: OkcDocument
  available: (featureId: string) => boolean
  capture?: ToolCapture
  meshData?: (id: string) => TriMesh | undefined
}

interface Stage {
  bodies: Map<string, BodyState>
  meshBodies: Map<string, MeshBodyState>
  sketches: Map<string, SketchFeature>
  preShell: Map<string, PreShell>
  planes: Map<string, Frame>
  report: (
    severity: KernelError['severity'],
    message: string,
    hint?: string,
    bodyId?: string,
  ) => void
}

export function evaluateFeature(
  ctx: FeatureContext,
  feature: Feature,
  key: string,
  prev: Snapshot,
): Snapshot {
  const errors: KernelError[] = []
  let failed = false
  const report: Stage['report'] = (severity, message, hint, bodyId) => {
    const error: KernelError = { featureId: feature.id, severity, message }
    if (hint) error.hint = hint
    if (bodyId) error.bodyId = bodyId
    errors.push(error)
    if (severity === 'error') failed = true
  }
  const stage: Stage = {
    bodies: new Map(prev.bodies),
    meshBodies: new Map(prev.meshBodies),
    sketches: new Map(prev.sketches),
    preShell: new Map(prev.preShell),
    planes: new Map(prev.planes),
    report,
  }

  const dependency = featureDependencies(ctx.doc, feature).find((id) => prev.failed.has(id))
  if (dependency) {
    const name = ctx.doc.timeline.find((f) => f.id === dependency)?.name ?? dependency
    report(
      'error',
      `Depends on ${name}, which failed.`,
      'Fix that step first and this one will build again.',
    )
  } else {
    try {
      runFeature(ctx, feature, key, stage)
    } catch (e) {
      const message = (e as Error)?.message || 'This step could not be built.'
      const prefix =
        feature.kind === 'lid'
          ? 'Could not build the lid: '
          : feature.kind === 'lidSocket'
            ? 'Could not cut the seat for the lid: '
            : ''
      const hint =
        e instanceof NamingError
          ? 'Edit this step and pick the geometry again.'
          : hintForFailure(feature, message)
      report('error', prefix + message, hint)
    }
  }

  return {
    key,
    bodies: failed ? prev.bodies : stage.bodies,
    meshBodies: failed ? prev.meshBodies : stage.meshBodies,
    sketches: failed ? prev.sketches : stage.sketches,
    preShell: failed ? prev.preShell : stage.preShell,
    planes: failed ? prev.planes : stage.planes,
    errors: errors.length ? [...prev.errors, ...errors] : prev.errors,
    failed: failed ? new Set([...prev.failed, feature.id]) : prev.failed,
  }
}

function runFeature(ctx: FeatureContext, feature: Feature, key: string, stage: Stage): void {
  const { doc } = ctx
  const oc = occ()
  const bodyName = (id: string) => findBody(doc, id)?.body.name ?? id
  const need = (id: string): BodyState | null => {
    const state = stage.bodies.get(id)
    if (!state && stage.meshBodies.has(id)) {
      stage.report(
        'error',
        `${bodyName(id)} is a mesh body, and this step needs a solid.`,
        'Use Convert Mesh to turn it into a solid first.',
        id,
      )
    } else if (!state) {
      stage.report(
        'error',
        `${bodyName(id)} does not exist at this point in the timeline.`,
        'The step that creates it may be suppressed, rolled back or deleted.',
        id,
      )
    }
    return state ?? null
  }
  const set = (id: string, named: NamedShape) => {
    const shape = cast(named.shape)
    named.shape.delete()
    stage.bodies.set(id, { shape, map: named.map, key, featureId: feature.id })
  }
  const tool = (solid: any, role: string): NamedShape =>
    nameShape(oc, `${feature.id}:${role}`, downcast(solid.wrapped) as unknown as OcShape)
  const planeOf = (ref: PlaneRef): Frame => {
    const frame = frameFromPlaneRef(ref, stage.bodies, stage.planes)
    if (ref.kind === 'face' || ref.kind === 'construction') stage.planes.set(feature.id, frame)
    return frame
  }
  const combineInto = (
    id: string,
    target: BodyState,
    kind: 'fuse' | 'cut' | 'common',
    tools: NamedShape[],
  ) => {
    const operation = kind === 'fuse' ? fuse : kind === 'cut' ? cut : common
    set(id, operation(oc, { featureId: feature.id, target: namedOf(target), tools }))
  }
  const cutWith = (id: string, target: BodyState, solid: any, role: string) => {
    ctx.capture?.(solid.clone(), 'cut', true)
    const shaped = tool(solid, role)
    try {
      combineInto(id, target, 'cut', [shaped])
    } finally {
      releaseNamed([shaped])
    }
  }
  const apply = (result: BodyOperation, solid: NamedShape) => {
    if (result.kind === 'newBody') {
      set(result.bodyId, solid)
      return
    }
    try {
      if (result.kind !== 'join') {
        ctx.capture?.(cast(solid.shape), result.kind === 'cut' ? 'cut' : 'intersect', true)
      }
      if (result.kind === 'join') {
        const target = need(result.bodyId)
        if (target) combineInto(result.bodyId, target, 'fuse', [solid])
        return
      }
      const targets = result.bodyIds.map((id) => [id, need(id)] as const)
      if (targets.some(([, target]) => !target)) return
      for (const [id, target] of targets) {
        combineInto(id, target!, result.kind === 'cut' ? 'cut' : 'common', [solid])
      }
    } finally {
      releaseNamed([solid])
    }
  }

  const solidStage: SolidStage = {
    bodies: stage.bodies,
    report: stage.report,
    bodyName,
    need,
    set,
    apply,
    planeOf,
    sketch: (id) => {
      const sketchFeature = stage.sketches.get(id)
      if (!sketchFeature) return null
      return {
        feature: sketchFeature,
        frame:
          stage.planes.get(sketchFeature.id) ??
          frameFromPlaneRef(sketchFeature.plane, stage.bodies, stage.planes),
      }
    },
    toPlane: (frame) => toReplicadPlane(frame),
    profileFace,
  }
  if (runSolidStep(feature, solidStage) || runFitStep(feature, solidStage)) {
    return
  }

  if (
    runMeshStep(feature, key, {
      meshBodies: stage.meshBodies,
      report: stage.report,
      bodyName,
      planeFrame: planeOf,
      meshData: (id) => ctx.meshData?.(id),
    })
  ) {
    return
  }

  switch (feature.kind) {
    case 'tessellate': {
      const source = need(feature.sourceBodyId)
      if (!source) return
      const mesh = tessellateShape(source.shape, feature.refinement)
      stage.meshBodies.set(feature.bodyId, { mesh, key, featureId: feature.id })
      return
    }

    case 'meshConvert': {
      const source = stage.meshBodies.get(feature.sourceBodyId)
      if (!source) {
        stage.report(
          'error',
          `${bodyName(feature.sourceBodyId)} is not a mesh body at this point in the timeline.`,
          'Pick a mesh body to convert.',
          feature.sourceBodyId,
        )
        return
      }
      if (triangleCount(source.mesh) > CONVERT_LIMIT) {
        stage.report(
          'error',
          `${bodyName(feature.sourceBodyId)} has ${triangleCount(source.mesh)} triangles; Convert Mesh takes up to ${CONVERT_LIMIT}.`,
          'Reduce the mesh first.',
          feature.sourceBodyId,
        )
        return
      }
      const shape = meshToShape(source.mesh, feature.method)
      const named = nameShape(oc, `${feature.id}:mesh`, downcast(shape) as unknown as OcShape)
      shape.delete()
      set(feature.bodyId, named)
      return
    }

    case 'joint':
    case 'jointOrigin':
    case 'rigidGroup':
    case 'motionLink':
    case 'motionStudy':
      return

    case 'sketch': {
      stage.sketches.set(feature.id, feature)
      stage.planes.set(feature.id, frameFromPlaneRef(feature.plane, stage.bodies, stage.planes))
      return
    }

    case 'constructionPlane': {
      const base = frameFromPlaneRef(feature.base, stage.bodies, stage.planes)
      if (feature.method === 'offset') {
        stage.planes.set(feature.id, offsetFrame(base, feature.distance))
        return
      }
      if (feature.method === 'angle') {
        const tilted =
          feature.axis === 'x'
            ? datumFrame({
                kind: 'angled',
                name: 'XY',
                tiltAxis: 'x',
                angle: feature.angle,
                offset: 0,
              })
            : feature.axis === 'y'
              ? datumFrame({
                  kind: 'angled',
                  name: 'XY',
                  tiltAxis: 'y',
                  angle: feature.angle,
                  offset: 0,
                })
              : datumFrame({
                  kind: 'angled',
                  name: 'XZ',
                  tiltAxis: 'y',
                  angle: feature.angle,
                  offset: 0,
                })
        stage.planes.set(feature.id, tilted)
        return
      }
      if (!feature.second) {
        stage.report(
          'error',
          'Midplane needs two planes or faces.',
          'Edit this step and pick a second one.',
        )
        return
      }
      const other = frameFromPlaneRef(feature.second, stage.bodies, stage.planes)
      const middle = midplaneFrame(base, other)
      if (!middle) {
        stage.report(
          'error',
          'Those two planes are the same plane.',
          'Pick two different planes or faces.',
        )
        return
      }
      stage.planes.set(feature.id, middle)
      return
    }

    case 'extrude':
    case 'revolve': {
      const sketchFeature = stage.sketches.get(feature.sketchId)
      if (!sketchFeature) {
        stage.report(
          'error',
          'The sketch this was built from is missing.',
          'It may have been deleted, suppressed or rolled back. Delete this step or point it at another sketch.',
        )
        return
      }
      if (feature.surface) {
        if (feature.result.kind !== 'newBody') {
          stage.report('error', 'A surface is always a new body.', 'Set the operation to New Body.')
          return
        }
        const chains = sketchChains(sketchFeature.sketch).filter(
          (chain) =>
            feature.kind !== 'revolve' ||
            !feature.axisLine ||
            chain.pieces.some((piece) => piece.entityId !== feature.axisLine),
        )
        const surfaceAxis =
          feature.kind === 'revolve'
            ? revolveAxis(
                sketchFeature.sketch,
                stage.planes.get(sketchFeature.id) ??
                  frameFromPlaneRef(sketchFeature.plane, stage.bodies, stage.planes),
                feature,
              )
            : null
        if (feature.kind === 'revolve' && !surfaceAxis) {
          stage.report(
            'error',
            'The line this revolves around is gone from the sketch.',
            'Edit this step and pick another axis.',
          )
          return
        }
        if (!chains.length) {
          stage.report(
            'error',
            'The sketch has no curves to make a surface from.',
            'Draw lines, arcs or splines in the sketch first.',
          )
          return
        }
        const plane =
          stage.planes.get(sketchFeature.id) ??
          frameFromPlaneRef(sketchFeature.plane, stage.bodies, stage.planes)
        const ocAny = oc as any
        const assembler = new ocAny.TopoDS_Builder()
        const compound = new ocAny.TopoDS_Compound()
        assembler.MakeCompound(compound)
        const owned: Array<{ delete(): void }> = [assembler]
        try {
          for (const chain of chains) {
            const wire = (
              chainBlueprint(sketchFeature.sketch, chain).sketchOnPlane(
                toReplicadPlane(plane),
              ) as any
            ).wire
            if (feature.kind === 'extrude') {
              const distance = feature.reverse ? -feature.distance : feature.distance
              const start = feature.symmetric ? -Math.abs(distance) / 2 : 0
              const length = feature.symmetric ? Math.abs(distance) : distance
              const shifted = start ? wire.translate(v3.scale(plane.normal, start)) : wire
              const vector = new ocAny.gp_Vec_4(...v3.scale(plane.normal, length))
              const prism = new ocAny.BRepPrimAPI_MakePrism_1(shifted.wrapped, vector, false, true)
              owned.push(vector, prism)
              assembler.Add(compound, prism.Shape())
            } else {
              const axis = new ocAny.gp_Ax1_2(
                new ocAny.gp_Pnt_3(...surfaceAxis!.origin),
                new ocAny.gp_Dir_4(...surfaceAxis!.direction),
              )
              const angle = feature.angle > 0 && feature.angle < 360 ? feature.angle : 360
              const revolution = new ocAny.BRepPrimAPI_MakeRevol_1(
                wire.wrapped,
                axis,
                (angle * Math.PI) / 180,
                false,
              )
              owned.push(axis, revolution)
              assembler.Add(compound, revolution.Shape())
            }
          }
          set(
            feature.result.bodyId,
            nameShape(oc, feature.id, downcast(compound) as unknown as OcShape),
          )
        } finally {
          for (const item of owned.reverse()) item.delete()
          compound.delete()
        }
        return
      }
      const profile = sketchToProfile(sketchFeature.sketch, feature.profiles)
      if (!profile.ok) {
        stage.report('error', profile.message, profile.hint)
        return
      }
      const frame =
        stage.planes.get(sketchFeature.id) ??
        frameFromPlaneRef(sketchFeature.plane, stage.bodies, stage.planes)
      if (feature.kind === 'extrude') {
        const distance = feature.reverse ? -feature.distance : feature.distance
        const offset = feature.symmetric ? -Math.abs(distance) / 2 : 0
        const length = feature.symmetric ? Math.abs(distance) : distance
        const plane: Frame = {
          ...frame,
          origin: v3.add(frame.origin, v3.scale(frame.normal, offset)),
        }
        const face = profileFace(profile.drawing, plane)
        apply(
          feature.result,
          namedExtrude(oc, {
            featureId: feature.id,
            profile: face.wrapped,
            sketch: sketchFeature.sketch,
            pieces: profile.pieces,
            frame: plane,
            vector: v3.scale(frame.normal, length),
          }),
        )
      } else {
        const axis = revolveAxis(sketchFeature.sketch, frame, feature)
        if (!axis) {
          stage.report(
            'error',
            'The line this revolves around is gone from the sketch.',
            'Edit this step and pick another axis.',
          )
          return
        }
        const face = profileFace(profile.drawing, frame)
        apply(
          feature.result,
          namedRevolve(oc, {
            featureId: feature.id,
            profile: face.wrapped,
            sketch: sketchFeature.sketch,
            pieces: profile.pieces,
            frame,
            axisOrigin: axis.origin,
            axisDirection: axis.direction,
            angle: feature.angle > 0 && feature.angle < 360 ? feature.angle : 360,
          }),
        )
      }
      return
    }

    case 'move': {
      const meshes = feature.bodyIds.filter((id) => stage.meshBodies.has(id))
      const states = feature.bodyIds
        .filter((id) => !stage.meshBodies.has(id))
        .map((id) => [id, need(id)] as const)
      if (!feature.bodyIds.length || states.some(([, state]) => !state)) return
      const [rx, ry, rz] = feature.rotation
      const [dx, dy, dz] = feature.offset
      if (!rx && !ry && !rz && !dx && !dy && !dz) return
      const lo: Vec3 = [Infinity, Infinity, Infinity]
      const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
      for (const [, state] of states) {
        const [bmin, bmax] = state!.shape.boundingBox.bounds
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], bmin[i])
          hi[i] = Math.max(hi[i], bmax[i])
        }
      }
      for (const id of meshes) {
        const { min, max } = meshBounds(stage.meshBodies.get(id)!.mesh)
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], min[i])
          hi[i] = Math.max(hi[i], max[i])
        }
      }
      const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
      let matrix = translationMatrix(v3.scale(centre, -1))
      matrix = multiplyMatrices(rotationMatrix('x', rx), matrix)
      matrix = multiplyMatrices(rotationMatrix('y', ry), matrix)
      matrix = multiplyMatrices(rotationMatrix('z', rz), matrix)
      matrix = multiplyMatrices(translationMatrix(v3.add(centre, [dx, dy, dz])), matrix)
      const moved = states.map(
        ([id, state]) => [id, transformNamed(oc, feature.id, namedOf(state!), matrix)] as const,
      )
      for (const [id, named] of moved) set(id, named)
      for (const id of meshes) {
        const state = stage.meshBodies.get(id)!
        stage.meshBodies.set(id, {
          mesh: transformMesh(state.mesh, matrix),
          key,
          featureId: feature.id,
        })
      }
      return
    }

    case 'box': {
      const frame = planeOf(feature.plane)
      const solid = feature.cornerRadius
        ? tool(
            sketchOn(
              drawRoundedRectangle(feature.width, feature.depth, feature.cornerRadius).translate(
                feature.origin[0] + feature.width / 2,
                feature.origin[1] + feature.depth / 2,
              ),
              frame,
              Math.min(0, feature.height),
            ).extrude(Math.abs(feature.height)),
            'box',
          )
        : namedBox(oc, {
            featureId: feature.id,
            frame,
            origin: feature.origin,
            size: [feature.width, feature.depth, feature.height],
          })
      apply(feature.result, solid)
      return
    }

    case 'cylinder': {
      const frame = planeOf(feature.plane)
      apply(
        feature.result,
        namedCylinder(oc, {
          featureId: feature.id,
          frame,
          centre: feature.centre,
          radius: feature.radius,
          height: feature.height,
        }),
      )
      return
    }

    case 'sphere': {
      const frame = planeOf(feature.plane)
      apply(
        feature.result,
        namedSphere(oc, {
          featureId: feature.id,
          frame,
          centre: feature.centre,
          radius: feature.radius,
          half: feature.half,
        }),
      )
      return
    }

    case 'torus': {
      apply(
        feature.result,
        namedTorus(oc, {
          featureId: feature.id,
          frame: planeOf(feature.plane),
          centre: feature.centre,
          majorRadius: feature.majorRadius,
          minorRadius: feature.minorRadius,
        }),
      )
      return
    }

    case 'fillet':
    case 'chamfer': {
      const target = need(feature.bodyId)
      if (!target) return
      const foreign = feature.edges.find(
        (ref) => ref.bodyId !== feature.bodyId || ref.kind !== 'edge',
      )
      if (foreign) {
        stage.report(
          'error',
          'An edge picked for this step belongs to a different body.',
          'Edit this step and pick edges on the body it changes.',
        )
        return
      }
      const edges: readonly string[] | 'all' = feature.edges.length
        ? feature.edges.map((ref) => ref.name)
        : 'all'
      const options = {
        featureId: feature.id,
        bodyId: feature.bodyId,
        body: namedOf(target),
        edges,
      }
      set(
        feature.bodyId,
        feature.kind === 'fillet'
          ? namedFillet(oc, { ...options, radius: feature.radius })
          : namedChamfer(oc, { ...options, distance: feature.distance }),
      )
      return
    }

    case 'shell': {
      const target = need(feature.bodyId)
      if (!target) return
      const open = feature.openFaces[0]
      if (!open) {
        stage.report(
          'error',
          'No face was chosen to leave open.',
          'Right-click the face you want the opening on and hollow it out from there.',
        )
        return
      }
      stage.preShell.set(feature.id, {
        shape: target.shape.clone(),
        frame: faceFrame(target, open, 0),
      })
      let hollowed: NamedShape
      try {
        hollowed = namedShell(oc, {
          featureId: feature.id,
          bodyId: feature.bodyId,
          body: namedOf(target),
          openFaces: feature.openFaces.map((ref) => ref.name),
          thickness: Math.abs(feature.thickness),
        })
      } catch (error) {
        if (!opensBesideCurvedFace(target, feature.openFaces)) throw error
        stage.report(
          'error',
          'OpenCascade cannot hollow through a face that a rounded edge blends into.',
          'Hollow the part out before rounding the edges around the opening.',
        )
        return
      }
      set(feature.bodyId, hollowed)
      return
    }

    case 'hole': {
      const target = need(feature.bodyId)
      if (!target) return
      const frame = planeOf(feature.plane)
      const positions = resolvePositions(feature.source, frame, doc)
      if (!positions) {
        stage.report(
          'error',
          'The part these holes were placed from is gone.',
          'Delete this step, or place the part again.',
        )
        return
      }
      if (positions.length === 0) return
      const cutter = buildHoleCutter(feature, frame, positions)
      if (cutter) cutWith(feature.bodyId, target, cutter, 'holes')
      return
    }

    case 'standoff': {
      const frame = planeOf(feature.plane)
      const positions = resolvePositions(feature.source, frame, doc)
      if (!positions) {
        stage.report(
          'error',
          'The part these standoffs were placed from is gone.',
          'Delete this step, or place the part again.',
        )
        return
      }
      if (positions.length === 0) return
      const { solid, bores } = buildStandoffs(feature, frame, positions)
      if (!solid) return
      if (feature.result.kind === 'newBody') {
        set(feature.result.bodyId, tool(bores ? solid.cut(bores) : solid, 'pillars'))
        return
      }
      const target = need(feature.result.bodyId)
      if (!target) return
      const pillars = tool(solid, 'pillars')
      const joined = (() => {
        try {
          return fuse(oc, { featureId: feature.id, target: namedOf(target), tools: [pillars] })
        } finally {
          releaseNamed([pillars])
        }
      })()
      if (!bores) {
        set(feature.result.bodyId, joined)
        return
      }
      const drilled = tool(bores, 'bores')
      try {
        set(
          feature.result.bodyId,
          cut(oc, { featureId: feature.id, target: joined, tools: [drilled] }),
        )
      } finally {
        releaseNamed([drilled, joined])
      }
      return
    }

    case 'vent': {
      const target = need(feature.bodyId)
      if (!target) return
      const frame = planeOf(feature.plane)
      const cutter = buildVentCutter(feature, frame, target.shape)
      if (!cutter) {
        stage.report(
          'warning',
          'No holes fitted inside the border you asked for.',
          'Try a smaller hole, tighter spacing, or a thinner edge border.',
        )
        return
      }
      cutWith(feature.bodyId, target, cutter, 'vent')
      return
    }

    case 'lid': {
      const source = stage.preShell.get(feature.shellFeatureId)
      if (!source) {
        stage.report(
          'error',
          'The hollowing this lid belongs to is gone.',
          'It may have been deleted or turned off. Delete this lid, or hollow the part out again.',
        )
        return
      }
      const wall = wallOfShell(doc, feature.shellFeatureId) ?? Math.abs(feature.thickness)
      const walls = stage.bodies.get(feature.sourceBodyId)?.shape ?? null
      apply(feature.result, tool(buildLid(feature, source, wall, walls), 'lid'))
      return
    }

    case 'lidSocket': {
      const target = need(feature.bodyId)
      if (!target) return
      const lid = doc.timeline.find((f) => f.id === feature.lidFeatureId)
      if (!lid || lid.kind !== 'lid' || !ctx.available(lid.id)) {
        stage.report(
          'error',
          'The lid this seat was cut for is gone.',
          'Delete this step, or make the lid again.',
        )
        return
      }
      const source = stage.preShell.get(lid.shellFeatureId)
      if (!source) return
      const wall = wallOfShell(doc, lid.shellFeatureId) ?? Math.abs(lid.thickness)
      const cutter = seatCutter(lid, source, wall)
      if (cutter) cutWith(feature.bodyId, target, cutter, 'seat')
      return
    }

    case 'combine': {
      const target = need(feature.bodyId)
      if (!target) return
      const tools = feature.toolBodyIds
        .filter((id) => id !== feature.bodyId)
        .map((id) => [id, need(id)] as const)
      if (!tools.length || tools.some(([, tool]) => !tool)) return
      if (feature.operation !== 'join') {
        for (const [, state] of tools) {
          ctx.capture?.(state!.shape, feature.operation === 'cut' ? 'cut' : 'intersect', false)
        }
      }
      combineInto(
        feature.bodyId,
        target,
        feature.operation === 'join' ? 'fuse' : feature.operation === 'cut' ? 'cut' : 'common',
        tools.map(([, state]) => namedOf(state!)),
      )
      if (!feature.keepTools) for (const [id] of tools) stage.bodies.delete(id)
      return
    }

    case 'portCutout': {
      const target = need(feature.bodyId)
      if (!target) return
      const placed = placedPart(doc, feature.occurrencePath, feature.contextPath)
      if (!placed) {
        stage.report(
          'error',
          'The part these openings were made for is gone.',
          'Delete this step, or place the part again.',
        )
        return
      }
      const cutter = buildPortCutters(placed, feature.connectorIds, feature.tolerance)
      if (cutter) cutWith(feature.bodyId, target, cutter, 'ports')
      return
    }
  }
}
