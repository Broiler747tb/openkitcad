import { getOC } from 'replicad'
import { v3, type Frame, type Vec3 } from '../core/math'
import type { ElementRef } from '../doc/types'
import { NamingError, resolveElement, sampleEdge, Scratch, subShapes, type OcShape } from './naming'
import type { SolidStage } from './solidSteps'

type OcAny = any

export interface RoundFace {
  frame: Frame
  radius: number
  length: number
  convex: boolean
}

export interface RoundFaceMessage {
  notRound: string
  hint?: string
}

export function roundFace(
  stage: SolidStage,
  face: ElementRef,
  anchor: Vec3,
  flipEnd: boolean,
  message: RoundFaceMessage,
): RoundFace | null {
  const oc = getOC() as OcAny
  const body = stage.bodies.get(face.bodyId)
  if (!body) return null
  const resolution = resolveElement(body.map, {
    bodyId: face.bodyId,
    kind: 'face',
    name: face.name,
  })
  if (!resolution.ok) throw new NamingError(resolution.error)
  const shape = resolution.element.shape as OcShape
  const scratch = new Scratch()
  try {
    const cast = scratch.track(oc.TopoDS.Face_1(shape))
    const surface = scratch.track(new oc.BRepAdaptor_Surface_2(cast, true))
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      stage.report('error', message.notRound, message.hint)
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
      stage.report('error', 'That round face has no length to work along.')
      return null
    }
    const u = (surface.FirstUParameter() + surface.LastUParameter()) / 2
    const v = (surface.FirstVParameter() + surface.LastVParameter()) / 2
    const props = scratch.track(new oc.BRepGProp_Face_2(cast, false))
    const point = scratch.track(new oc.gp_Pnt_1())
    const normal = scratch.track(new oc.gp_Vec_1())
    props.Normal(u, v, point, normal)
    const onFace: Vec3 = [point.X(), point.Y(), point.Z()]
    const radial = v3.sub(onFace, v3.add(origin, v3.scale(dir, along(onFace))))
    const convex = v3.dot(radial, [normal.X(), normal.Y(), normal.Z()]) > 0
    const at = along(anchor)
    const fromLow = Math.abs(at - low) <= Math.abs(high - at) ? !flipEnd : flipEnd
    const z = fromLow ? v3.scale(dir, -1) : dir
    const base = v3.add(origin, v3.scale(dir, fromLow ? low : high))
    const x = v3.norm(v3.cross(z, Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
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
