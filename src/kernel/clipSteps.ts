import { draw, downcast, getOC, makeBox } from 'replicad'
import { v3, type Vec2, type Vec3 } from '../core/math'
import type { BoardClipsFeature, Feature, Matrix4, OkcDocument } from '../doc/types'
import type { CataloguePart } from '../catalogue'
import { placedPart, transformShape } from './build'
import {
  fuse,
  nameShape,
  Scratch,
  subShapes,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import type { SolidStage } from './solidSteps'

type OcAny = any

type Solid = {
  fuse(other: Solid): Solid
  cut(other: Solid): Solid
  translate(vector: Vec3): Solid
  rotate(angle: number, origin?: Vec3, axis?: Vec3): Solid
  wrapped: OcShape
  clone(): Solid
}

const DROP = 200
const MIN_INSET = 4

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

export interface BoardBox {
  width: number
  depth: number
  thickness: number
}

export function boardBox(part: CataloguePart): BoardBox | null {
  const geometry = part.geometry
  if (geometry.kind !== 'board') return null
  if (geometry.outline.shape === 'rect') {
    return {
      width: geometry.outline.w,
      depth: geometry.outline.h,
      thickness: geometry.thickness,
    }
  }
  const points = geometry.outline.points
  if (!points.length) return null
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
    thickness: geometry.thickness,
  }
}

function clipProfile(feature: BoardClipsFeature, board: BoardBox, floor: number): Solid {
  const gap = feature.gap
  const post = feature.post
  const grip = feature.grip
  const hookBottom = board.thickness + 0.1
  const hookTop = hookBottom + feature.hook
  const slope = gap + grip + post
  const ledged = -floor > 0.4
  const points: Vec2[] = [
    ...(ledged ? ([[-feature.ledge, floor]] as Vec2[]) : ([[gap, floor]] as Vec2[])),
    [gap + post, floor],
    [gap + post, hookTop + slope],
    [-grip, hookTop],
    [-grip, hookBottom],
    [gap, hookBottom],
    ...(ledged
      ? ([
          [gap, 0],
          [-feature.ledge, 0],
        ] as Vec2[])
      : []),
  ]
  const pen = draw(points[0])
  for (const point of points.slice(1)) pen.lineTo(point)
  return pen.close().sketchOnPlane('XZ').extrude(feature.width) as unknown as Solid
}

function edgeClip(
  feature: BoardClipsFeature,
  board: BoardBox,
  floor: number,
  along: number,
  side: 1 | -1,
  longSide: boolean,
): Solid {
  const shape = clipProfile(feature, board, floor)
  const centred = shape.translate([0, feature.width / 2, 0]) as Solid
  const outward = centred.rotate(90, [0, 0, 0], [0, 0, 1]) as Solid
  const turned = side > 0 ? outward : (outward.rotate(180, [0, 0, 0], [0, 0, 1]) as Solid)
  const edge = longSide ? board.depth : board.width
  const across = side > 0 ? edge : 0
  if (longSide) return turned.translate([along, across, 0]) as Solid
  const sideways = turned.rotate(90, [0, 0, 0], [0, 0, 1]) as Solid
  return sideways.translate([across, along, 0]) as Solid
}

function floorUnder(
  oc: OcAny,
  body: Solid,
  matrix: Matrix4,
  at: Vec2,
  width: number,
): number | null {
  const probe = transformShape(
    makeBox(
      [at[0] - width / 2, at[1] - width / 2, -DROP],
      [at[0] + width / 2, at[1] + width / 2, 0],
    ),
    matrix,
  ) as Solid
  let hit: Solid | null = null
  try {
    hit = (body as unknown as { intersect(other: Solid): Solid }).intersect(probe)
  } catch {
    return null
  } finally {
    quietly(probe as never)
  }
  const scratch = new Scratch()
  try {
    const inverse = invertPoint(matrix)
    let top = -Infinity
    for (const solid of subShapes(oc, hit.wrapped, 'TopAbs_SOLID', scratch)) {
      const box = scratch.track(new oc.Bnd_Box_1())
      oc.BRepBndLib.AddOptimal(solid, box, false, false)
      if (box.IsVoid()) continue
      const low = scratch.track(box.CornerMin())
      const high = scratch.track(box.CornerMax())
      for (const x of [low.X(), high.X()]) {
        for (const y of [low.Y(), high.Y()]) {
          for (const z of [low.Z(), high.Z()]) top = Math.max(top, inverse([x, y, z])[2])
        }
      }
    }
    return Number.isFinite(top) ? top : null
  } finally {
    scratch.release()
    quietly(hit as never)
  }
}

function invertPoint(matrix: Matrix4): (point: Vec3) => Vec3 {
  const x: Vec3 = [matrix[0], matrix[1], matrix[2]]
  const y: Vec3 = [matrix[4], matrix[5], matrix[6]]
  const z: Vec3 = [matrix[8], matrix[9], matrix[10]]
  const origin: Vec3 = [matrix[12], matrix[13], matrix[14]]
  return (point) => {
    const d = v3.sub(point, origin)
    return [v3.dot(d, x), v3.dot(d, y), v3.dot(d, z)]
  }
}

export function clipPositions(board: BoardBox, count: number, width: number): number[] {
  const long = Math.max(board.width, board.depth)
  const inset = Math.max(MIN_INSET + width / 2, long * 0.15)
  if (count <= 1) return [long / 2]
  const span = Math.max(0, long - 2 * inset)
  return Array.from({ length: count }, (_, i) => inset + (span * i) / (count - 1))
}

export function runClipStep(feature: Feature, stage: SolidStage, doc: OkcDocument): boolean {
  if (feature.kind !== 'boardClips') return false
  const clips = feature as BoardClipsFeature
  const oc = getOC() as unknown as OC
  const occ = oc as OcAny
  const body = stage.need(clips.bodyId)
  if (!body) return true
  const placed = placedPart(doc, clips.occurrencePath, clips.contextPath)
  const board = placed?.part ? boardBox(placed.part) : null
  if (!placed || !board) {
    stage.report(
      'error',
      'The board these clips were made for is gone.',
      'Delete this step, or place the board again.',
    )
    return true
  }
  if (!(clips.width > 0) || !(clips.post > 0) || !(clips.grip > 0)) {
    stage.report('error', 'A clip needs a width, a post and a grip.')
    return true
  }
  const longSide = board.width >= board.depth
  const positions = clipPositions(board, Math.max(1, Math.round(clips.count)), clips.width)
  const tools: NamedShape[] = []
  const owned: Solid[] = []
  try {
    const solids: Solid[] = []
    for (const along of positions) {
      for (const side of [1, -1] as const) {
        const spot: Vec2 = longSide
          ? [
              along,
              side > 0 ? board.depth + clips.gap + clips.post / 2 : -clips.gap - clips.post / 2,
            ]
          : [
              side > 0 ? board.width + clips.gap + clips.post / 2 : -clips.gap - clips.post / 2,
              along,
            ]
        const floor = floorUnder(
          occ,
          body.shape as unknown as Solid,
          placed.matrix,
          spot,
          clips.post,
        )
        if (floor === null || floor > 0.01) continue
        const clip = edgeClip(clips, board, floor, along, side, longSide)
        owned.push(clip)
        solids.push(transformShape(clip, placed.matrix) as Solid)
      }
    }
    if (!solids.length) {
      stage.report(
        'error',
        `The clips have nothing to stand on under ${stage.bodyName(clips.bodyId)}.`,
        'Put the board over the floor of the part, or move the part under it.',
      )
      return true
    }
    owned.push(...solids)
    solids.forEach((solid, index) => {
      tools.push(
        nameShape(oc, `${clips.id}:clip${index}`, downcast(solid.wrapped) as unknown as OcShape),
      )
    })
    let next: NamedShape
    try {
      next = fuse(oc, {
        featureId: clips.id,
        target: { shape: body.shape.wrapped, map: body.map },
        tools,
      })
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error(`Could not put the clips on ${stage.bodyName(clips.bodyId)}.`)
    }
    stage.set(clips.bodyId, next)
    return true
  } finally {
    for (const tool of tools) {
      tool.map.dispose()
      tool.shape.delete()
    }
    for (const solid of owned) quietly(solid as never)
  }
}
