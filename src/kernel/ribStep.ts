import { cast, downcast, getOC, measureVolume } from 'replicad'
import { v3, type Frame, type Vec3 } from '../core/math'
import type { Feature, RibFeature, WebFeature } from '../doc/types'
import { sketchChains, type SketchChain } from '../sketch/chains'
import type { Sketch2D } from '../sketch/types'
import {
  fuse,
  nameShape,
  Scratch,
  subShapes,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import { chainBlueprint } from './profile'
import type { SolidStage } from './solidSteps'

type OcAny = any

type WallFeature = RibFeature | WebFeature

const MARGIN = 1.5

function vector(oc: OcAny, direction: Vec3, length: number, scratch: Scratch) {
  return scratch.track(
    new oc.gp_Vec_4(direction[0] * length, direction[1] * length, direction[2] * length),
  )
}

function prism(oc: OcAny, shape: OcShape, direction: Vec3, length: number, scratch: Scratch) {
  const builder = scratch.track(
    new oc.BRepPrimAPI_MakePrism_1(shape, vector(oc, direction, length, scratch), false, true),
  )
  if (!builder.IsDone()) throw new Error('The wall could not be built.')
  return scratch.track(builder.Shape())
}

function boolean(
  oc: OcAny,
  kind: 'common' | 'cut',
  a: OcShape,
  b: OcShape,
  scratch: Scratch,
): OcShape {
  const progress = scratch.track(new oc.Message_ProgressRange_1())
  const builder = scratch.track(
    kind === 'common'
      ? new oc.BRepAlgoAPI_Common_3(a, b, progress)
      : new oc.BRepAlgoAPI_Cut_3(a, b, progress),
  )
  if (!builder.IsDone() || builder.HasErrors()) throw new Error(`The ${kind} failed.`)
  return scratch.track(builder.Shape())
}

function faceNormal(oc: OcAny, face: OcShape, scratch: Scratch): Vec3 {
  const cast = scratch.track(oc.TopoDS.Face_1(face))
  const surface = scratch.track(new oc.BRepAdaptor_Surface_2(cast, true))
  const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2
  const v = (surface.FirstVParameter() + surface.LastVParameter()) / 2
  const props = scratch.track(new oc.BRepGProp_Face_2(cast, false))
  const point = scratch.track(new oc.gp_Pnt_1())
  const normal = scratch.track(new oc.gp_Vec_1())
  props.Normal(u, v, point, normal)
  return v3.norm([normal.X(), normal.Y(), normal.Z()])
}

function hasVolume(shape: OcShape): boolean {
  try {
    return Math.abs(measureVolume(cast(shape) as never)) > 1e-9
  } catch {
    return false
  }
}

function thickened(
  oc: OcAny,
  shape: OcShape,
  from: number,
  width: number,
  scratch: Scratch,
): OcShape {
  let base = shape
  if (Math.abs(from) > 1e-12) {
    const offset = scratch.track(new oc.BRepOffsetAPI_MakeOffsetShape())
    offset.PerformBySimple(shape, from)
    if (!offset.IsDone()) throw new Error('The wall could not be given thickness.')
    base = scratch.track(offset.Shape())
  }
  const builder = scratch.track(new oc.BRepOffsetAPI_MakeThickSolid())
  builder.MakeThickSolidBySimple(base, width)
  if (!builder.IsDone()) throw new Error('The wall could not be given thickness.')
  const solid = scratch.track(builder.Shape())
  return measureVolume(cast(solid) as never) < 0 ? scratch.track(solid.Reversed()) : solid
}

function belowPlane(
  oc: OcAny,
  frame: Frame,
  down: Vec3,
  landing: number,
  reach: number,
  scratch: Scratch,
): OcShape {
  const across = v3.norm(
    Math.abs(v3.dot(down, [0, 0, 1])) > 0.9 ? v3.cross(down, [1, 0, 0]) : v3.cross(down, [0, 0, 1]),
  )
  const other = v3.cross(down, across)
  const corner = v3.add(
    v3.add(frame.origin, v3.scale(down, landing)),
    v3.add(v3.scale(across, -2 * reach), v3.scale(other, -2 * reach)),
  )
  const axes = scratch.track(
    new oc.gp_Ax2_2(
      scratch.track(new oc.gp_Pnt_3(corner[0], corner[1], corner[2])),
      scratch.track(new oc.gp_Dir_4(down[0], down[1], down[2])),
      scratch.track(new oc.gp_Dir_4(across[0], across[1], across[2])),
    ),
  )
  const box = scratch.track(new oc.BRepPrimAPI_MakeBox_5(axes, 4 * reach, 4 * reach, 2 * reach))
  return scratch.track(box.Shape())
}

function wallDirection(feature: WallFeature, frame: Frame): Vec3 {
  const along = feature.kind === 'web' ? frame.normal : frame.yDir
  return feature.flip ? along : v3.scale(along, -1)
}

function wallSpan(feature: WallFeature): { from: number; width: number } {
  const width = feature.thickness
  if (feature.sides === 'both') return { from: -width / 2, width }
  return { from: feature.flipSide ? -width : 0, width }
}

function slabOf(
  oc: OcAny,
  feature: WallFeature,
  sketch: Sketch2D,
  chain: SketchChain,
  plane: unknown,
  frame: Frame,
  down: Vec3,
  length: number,
  from: number,
  width: number,
  scratch: Scratch,
): OcShape {
  const wire = chainBlueprint(sketch, chain).sketchOnPlane(plane as never).wire
  if (feature.kind === 'web') {
    const ribbon = prism(oc, wire.wrapped, down, length, scratch)
    wire.delete()
    return thickened(oc, ribbon, from, width, scratch)
  }
  const placed = from !== 0 ? wire.translate(v3.scale(frame.normal, from) as never) : wire
  const ribbon = prism(oc, placed.wrapped, frame.normal, width, scratch)
  placed.delete()
  return prism(oc, ribbon, down, length, scratch)
}

function wallShape(
  oc: OcAny,
  stage: SolidStage,
  feature: WallFeature,
  sketch: Sketch2D,
  frame: Frame,
  chain: SketchChain,
  body: OcShape,
  reach: number,
  scratch: Scratch,
): OcShape | null {
  const plane = stage.toPlane(frame)
  const down = wallDirection(feature, frame)
  const length = feature.depth === 'finite' ? feature.distance : reach
  const span = wallSpan(feature)
  const slab = slabOf(
    oc,
    feature,
    sketch,
    chain,
    plane,
    frame,
    down,
    length,
    span.from,
    span.width,
    scratch,
  )
  if (feature.depth === 'finite') return hasVolume(slab) ? slab : null
  const probe = slabOf(
    oc,
    feature,
    sketch,
    chain,
    plane,
    frame,
    down,
    length,
    span.from - feature.thickness,
    span.width + 2 * feature.thickness,
    scratch,
  )
  const inside = boolean(oc, 'common', probe, body, scratch)
  if (!hasVolume(inside)) {
    stage.report(
      'error',
      `${feature.kind === 'web' ? 'A web wall' : 'This rib'} never reaches ${stage.bodyName(feature.bodyId)}.`,
      'Flip it, or give it a depth of its own.',
    )
    return null
  }
  const along = (point: Vec3) => v3.dot(v3.sub(point, frame.origin), down)
  let landing = -Infinity
  for (const face of subShapes(oc, inside, 'TopAbs_FACE', scratch)) {
    if (v3.dot(faceNormal(oc, face, scratch), down) > -1e-6) continue
    const [low, high] = (cast(face) as never as { boundingBox: { bounds: [Vec3, Vec3] } })
      .boundingBox.bounds
    for (const x of [low[0], high[0]]) {
      for (const y of [low[1], high[1]]) {
        for (const z of [low[2], high[2]]) landing = Math.max(landing, along([x, y, z]))
      }
    }
  }
  if (!Number.isFinite(landing)) return null
  const cutter = belowPlane(oc, frame, down, landing, reach, scratch)
  const wall = boolean(oc, 'cut', slab, cutter, scratch)
  return hasVolume(wall) ? wall : null
}

export function runRibStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'rib' && feature.kind !== 'web') return false
  const wall = feature as WallFeature
  const oc = getOC() as unknown as OC
  const occ = oc as OcAny
  if (!(wall.thickness > 0)) {
    stage.report('error', 'The thickness has to be more than zero.')
    return true
  }
  if (wall.depth === 'finite' && !(wall.distance > 0)) {
    stage.report('error', 'The depth has to be more than zero.')
    return true
  }
  const body = stage.need(wall.bodyId)
  if (!body) return true
  const found = stage.sketch(wall.sketchId)
  if (!found) {
    stage.report(
      'error',
      `The sketch this ${wall.kind} uses is missing.`,
      'It may have been deleted, suppressed or rolled back.',
    )
    return true
  }
  const picked = wall.curves?.length ? new Set(wall.curves) : null
  const sketch: Sketch2D = picked
    ? {
        ...found.feature.sketch,
        entities: found.feature.sketch.entities.filter((entity) => picked.has(entity.id)),
      }
    : found.feature.sketch
  const chains = sketchChains(sketch)
  if (!chains.length) {
    stage.report(
      'error',
      `Pick the lines the ${wall.kind} follows.`,
      'They have to be plain sketch curves, not construction lines.',
    )
    return true
  }
  if (wall.kind === 'rib' && chains.length > 1) {
    stage.report(
      'error',
      'A rib follows one run of lines.',
      'Join the lines end to end, or use Web for a set of walls.',
    )
    return true
  }
  const [min, max] = body.shape.boundingBox.bounds
  const reach = Math.max(10, v3.len(v3.sub(max as Vec3, min as Vec3)) * MARGIN)
  const scratch = new Scratch()
  const tools: NamedShape[] = []
  try {
    const walls = chains.flatMap((chain) => {
      const shape = wallShape(
        occ,
        stage,
        wall,
        sketch,
        found.frame,
        chain,
        body.shape.wrapped,
        reach,
        scratch,
      )
      return shape ? [shape] : []
    })
    if (!walls.length) return true
    walls.forEach((shape, index) => {
      tools.push(nameShape(oc, `${wall.id}:wall${index}`, downcast(shape) as unknown as OcShape))
    })
    let next: NamedShape
    try {
      next = fuse(oc, {
        featureId: wall.id,
        target: { shape: body.shape.wrapped, map: body.map },
        tools,
      })
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error(`Could not join the ${wall.kind} onto ${stage.bodyName(wall.bodyId)}.`)
    }
    stage.set(wall.bodyId, next)
    return true
  } finally {
    for (const tool of tools) {
      tool.map.dispose()
      tool.shape.delete()
    }
    scratch.release()
  }
}
