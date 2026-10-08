import { basicFaceExtrusion, makeFace, Vector } from 'replicad'
import { v3, type Vec3 } from '../core/math'
import type { LidFeature } from '../doc/types'

export function lidAppearance(
  cap: any,
  normal: Vec3,
  thickness: number,
  style: Pick<LidFeature, 'cornerStyle' | 'cornerSize' | 'surfaceStyle'>,
): any {
  const size = style.cornerSize ?? 2
  if (style.cornerStyle === 'round')
    cap = cap.fillet(size, (edges: any) =>
      edges.inDirection(normal).ofLength((length: number) => Math.abs(length - thickness) < 0.001),
    )
  if (style.cornerStyle === 'bevel')
    cap = cap.chamfer(size, (edges: any) =>
      edges.inDirection(normal).ofLength((length: number) => Math.abs(length - thickness) < 0.001),
    )
  if (!style.surfaceStyle || style.surfaceStyle === 'flat') return cap
  const faces = cap.faces.filter(
    (face: any) => face.geomType === 'PLANE' && v3.dot(face.normalAt().toTuple(), normal) > 0.99,
  )
  faces.sort(
    (a: any, b: any) => v3.dot(b.center.toTuple(), normal) - v3.dot(a.center.toTuple(), normal),
  )
  if (!faces.length) throw new Error('The lid needs a flat top for this surface style.')
  const top = v3.dot(faces[0].center.toTuple(), normal)
  const candidates = faces.filter(
    (face: any) => Math.abs(v3.dot(face.center.toTuple(), normal) - top) < 0.001,
  )
  const area = (face: any) => {
    const [lo, hi] = face.boundingBox.bounds
    const sides = hi
      .map((value: number, index: number) => value - lo[index])
      .sort((a: number, b: number) => b - a)
    return sides[0] * sides[1]
  }
  candidates.sort((a: any, b: any) => area(b) - area(a))
  const wire = candidates[0].clone().outerWire().offset2D(-Math.max(2, size))
  const face = makeFace(wire)
  const height = Math.min(thickness * 0.35, 1)
  const inset = style.surfaceStyle === 'raised' ? -0.1 : 0.1
  const base = face.clone().translate(v3.scale(normal, inset))
  const panel = basicFaceExtrusion(
    base,
    new Vector(v3.scale(normal, style.surfaceStyle === 'raised' ? height + 0.1 : -height - 0.1)),
  )
  const result = style.surfaceStyle === 'raised' ? cap.fuse(panel) : cap.cut(panel)
  panel.delete()
  base.delete()
  face.delete()
  wire.delete()
  for (const item of faces) item.delete()
  return result
}
