import { cast, downcast, getOC, measureVolume } from 'replicad'
import { v3, type Frame, type Vec3 } from '../core/math'
import type { EmbossFeature, Feature, SketchFeature } from '../doc/types'
import {
  cut,
  extrude as namedExtrude,
  fuse,
  nameShape,
  NamingError,
  resolveElement,
  Scratch,
  subShapes,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import { sketchToProfile, type ProfileResult } from './profile'
import type { SolidStage } from './solidSteps'

type OcAny = any

const EMBED = 0.2

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function faceNormal(oc: OcAny, face: OcShape, scratch: Scratch): { point: Vec3; normal: Vec3 } {
  const cast = scratch.track(oc.TopoDS.Face_1(face))
  const surface = scratch.track(new oc.BRepAdaptor_Surface_2(cast, true))
  const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2
  const v = (surface.FirstVParameter() + surface.LastVParameter()) / 2
  const props = scratch.track(new oc.BRepGProp_Face_2(cast, false))
  const point = scratch.track(new oc.gp_Pnt_1())
  const normal = scratch.track(new oc.gp_Vec_1())
  props.Normal(u, v, point, normal)
  return {
    point: [point.X(), point.Y(), point.Z()],
    normal: v3.norm([normal.X(), normal.Y(), normal.Z()]),
  }
}

function planarTool(
  oc: OC,
  stage: SolidStage,
  feature: EmbossFeature,
  profile: Extract<ProfileResult, { ok: true }>,
  sketch: { feature: SketchFeature; frame: Frame },
  face: { point: Vec3; normal: Vec3 },
): NamedShape[] | null {
  const frame = sketch.frame
  if (Math.abs(Math.abs(v3.dot(frame.normal, face.normal)) - 1) > 1e-6) {
    stage.report(
      'error',
      'The sketch is not parallel to the face.',
      'Sketch on the face itself, or on a plane offset from it.',
    )
    return null
  }
  const along = v3.dot(v3.sub(face.point, frame.origin), frame.normal)
  const start = feature.effect === 'emboss' ? -EMBED : EMBED
  const origin = v3.add(
    v3.add(frame.origin, v3.scale(frame.normal, along)),
    v3.scale(face.normal, start),
  )
  const at: Frame = { ...frame, origin }
  const length = feature.depth + EMBED
  const base = stage.profileFace(profile.drawing, at)
  try {
    return [
      namedExtrude(oc, {
        featureId: feature.id,
        profile: base.wrapped,
        sketch: sketch.feature.sketch,
        pieces: profile.pieces,
        frame: at,
        vector: v3.scale(face.normal, feature.effect === 'emboss' ? length : -length),
      }),
    ]
  } finally {
    quietly(base)
  }
}

function wrappedTool(
  oc: OC,
  stage: SolidStage,
  feature: EmbossFeature,
  profile: Extract<ProfileResult, { ok: true }>,
  frame: Frame,
  target: OcShape,
): NamedShape[] | null {
  const occ = oc as OcAny
  const scratch = new Scratch()
  try {
    const castFace = scratch.track(occ.TopoDS.Face_1(target))
    const surface = scratch.track(new occ.BRepAdaptor_Surface_2(castFace, true))
    const cylinder = scratch.track(surface.Cylinder())
    const position = scratch.track(cylinder.Position())
    const pnt = (p: any): Vec3 => [p.X(), p.Y(), p.Z()]
    const dir = (d: any): Vec3 => v3.norm([d.X(), d.Y(), d.Z()])
    const location = pnt(scratch.track(position.Location()))
    const axis = dir(scratch.track(position.Direction()))
    const xAxis = dir(scratch.track(position.XDirection()))
    const yAxis = v3.norm(v3.cross(axis, xAxis))
    const radius = cylinder.Radius()
    if (Math.abs(v3.dot(frame.normal, axis)) > 1e-6) {
      stage.report(
        'error',
        'The sketch has to run along the round face.',
        'Put the sketch on a plane parallel to the axis of the round face.',
      )
      return null
    }
    const outwardOf = (face: { point: Vec3; normal: Vec3 }) => {
      const offset = v3.sub(face.point, location)
      const radial = v3.sub(offset, v3.scale(axis, v3.dot(offset, axis)))
      return v3.dot(radial, face.normal) > 0 ? 1 : -1
    }
    const outward = outwardOf(faceNormal(occ, target, scratch))
    if (feature.depth >= radius && (feature.effect === 'deboss') === outward > 0) {
      stage.report(
        'error',
        'The depth is deeper than the round face is wide.',
        'Use a smaller depth.',
      )
      return null
    }
    const facing = v3.norm(v3.sub(frame.normal, v3.scale(axis, v3.dot(frame.normal, axis))))
    const start = Math.atan2(v3.dot(facing, yAxis), v3.dot(facing, xAxis))
    const tangent = v3.add(v3.scale(xAxis, -Math.sin(start)), v3.scale(yAxis, Math.cos(start)))
    const turn = Math.atan2(v3.dot(frame.xDir, axis), v3.dot(frame.xDir, tangent))
    const shift = v3.sub(frame.origin, location)
    const drawing = profile.drawing
      .rotate((turn * 180) / Math.PI, [0, 0])
      .translate(radius * start + v3.dot(shift, tangent), v3.dot(shift, axis))
    const box = drawing.boundingBox
    if (box.width >= 2 * Math.PI * radius - 1e-6) {
      stage.report(
        'error',
        'The shape is longer than the way round the face.',
        'Make the text smaller, or emboss it on a bigger round face.',
      )
      return null
    }
    const base = cast(scratch.track(occ.TopoDS.Face_1(target)))
    scratch.track(base)
    const wrapped = drawing.sketchOnFace(base as any, 'original') as any
    const skin = typeof wrapped.face === 'function' ? wrapped.face() : wrapped.faces()
    scratch.track(skin)
    const skinFaces = subShapes(occ, skin.wrapped, 'TopAbs_FACE', scratch)
    if (!skinFaces.length) throw new Error('The shape could not be wrapped onto the face.')
    const skinSide = outwardOf(faceNormal(occ, skinFaces[0], scratch))
    const emboss = feature.effect === 'emboss'
    const lift = (emboss ? -outward : outward) * EMBED * skinSide
    const thickness = (emboss ? outward : -outward) * (feature.depth + EMBED) * skinSide
    const solids = skinFaces.map((skinFace) => {
      const offset = scratch.track(new occ.BRepOffsetAPI_MakeOffsetShape())
      offset.PerformBySimple(skinFace, lift)
      if (!offset.IsDone()) throw new Error('The wrapped shape could not be moved off the face.')
      const lifted = scratch.track(offset.Shape())
      const thicken = scratch.track(new occ.BRepOffsetAPI_MakeThickSolid())
      thicken.MakeThickSolidBySimple(lifted, thickness)
      if (!thicken.IsDone()) throw new Error('The wrapped shape could not be given depth.')
      const thick = scratch.track(thicken.Shape())
      return measureVolume(cast(thick) as any) < 0 ? scratch.track(thick.Reversed()) : thick
    })
    return solids.map((solid, index) =>
      nameShape(oc, `${feature.id}:raised${index}`, downcast(solid) as unknown as OcShape),
    )
  } finally {
    scratch.release()
  }
}

export function runEmbossStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'emboss') return false
  const oc = getOC() as unknown as OC
  const occ = oc as OcAny
  if (!(feature.depth > 0)) {
    stage.report('error', 'The depth has to be more than zero.')
    return true
  }
  const bodyId = feature.face.bodyId
  const body = stage.need(bodyId)
  if (!body) return true
  const sketch = stage.sketch(feature.sketchId)
  if (!sketch) {
    stage.report(
      'error',
      'The sketch this emboss uses is missing.',
      'It may have been deleted, suppressed or rolled back.',
    )
    return true
  }
  const profile = sketchToProfile(sketch.feature.sketch, feature.profiles)
  if (!profile.ok) {
    stage.report('error', profile.message, profile.hint)
    return true
  }
  const resolution = resolveElement(body.map, { bodyId, kind: 'face', name: feature.face.name })
  if (!resolution.ok) throw new NamingError(resolution.error)
  const target = resolution.element.shape
  const scratch = new Scratch()
  let tools: NamedShape[] | null = null
  try {
    const castFace = scratch.track(occ.TopoDS.Face_1(target))
    const surface = scratch.track(new occ.BRepAdaptor_Surface_2(castFace, true))
    const type = surface.GetType()
    if (type === occ.GeomAbs_SurfaceType.GeomAbs_Plane) {
      tools = planarTool(oc, stage, feature, profile, sketch, faceNormal(occ, target, scratch))
    } else if (type === occ.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      tools = wrappedTool(oc, stage, feature, profile, sketch.frame, target)
    } else {
      stage.report(
        'error',
        'Emboss works on flat faces and round faces.',
        'Pick a flat face, or the curved side of a cylinder.',
      )
      return true
    }
    if (!tools?.length) return true
    const current: NamedShape = { shape: body.shape.wrapped, map: body.map }
    let next: NamedShape
    try {
      next = (feature.effect === 'emboss' ? fuse : cut)(oc, {
        featureId: feature.id,
        target: current,
        tools,
      })
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error(
        feature.effect === 'emboss'
          ? `Could not raise the shape on ${stage.bodyName(bodyId)}.`
          : `Could not sink the shape into ${stage.bodyName(bodyId)}.`,
      )
    }
    stage.set(bodyId, next)
    return true
  } finally {
    for (const tool of tools ?? []) {
      tool.map.dispose()
      tool.shape.delete()
    }
    scratch.release()
  }
}
