import type { Frame, Vec2, Vec3 } from '../../core/math'
import type { Sketch2D, SketchEntity } from '../../sketch/types'
import { distanceToEntity, entityEnds, entityPointIds, isCurveEntity } from '../../sketch/curves'
import { textDistance } from '../../sketch/text'
import { compareStrings } from './types'

export const PROFILE_TOLERANCE = 1e-5

export interface EdgeSample {
  points: readonly Vec2[]
}

export interface VertexSample {
  position: Vec2
  edges: readonly number[]
}

export interface PieceSample {
  entityId: string
  token: string
  start: Vec2
  end: Vec2
}

export type ProfileMatch =
  | { ok: true; edges: string[]; vertices: string[] }
  | {
      ok: false
      message: string
      unmatched: number[]
      ambiguous: Array<{ edge: number; entities: string[] }>
    }

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function projectToFrame(frame: Frame, point: Vec3): { point: Vec2; height: number } {
  const d: Vec3 = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ]
  const dot = (axis: Vec3) => d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
  return { point: [dot(frame.xDir), dot(frame.yDir)], height: dot(frame.normal) }
}

function contains(
  entity: SketchEntity,
  points: ReadonlyMap<string, Vec2>,
  q: Vec2,
  tolerance: number,
): boolean {
  if (entity.kind === 'text') {
    const origin = points.get(entity.p)
    return !!origin && textDistance(entity, origin, q, tolerance) <= tolerance
  }
  if (!isCurveEntity(entity)) return false
  if (!entityPointIds(entity).every((id) => points.has(id))) return false
  if (entity.kind === 'line') {
    const a = points.get(entity.p1)!
    const b = points.get(entity.p2)!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    if (length <= tolerance) return false
    const along = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / length
    const across = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / length
    return across <= tolerance && along >= -tolerance && along <= length + tolerance
  }
  return distanceToEntity(entity, points as Map<string, Vec2>, q) <= tolerance
}

function endsMatch(
  entity: SketchEntity,
  points: ReadonlyMap<string, Vec2>,
  sample: EdgeSample,
  tolerance: number,
): boolean {
  const start = sample.points[0]
  const end = sample.points[sample.points.length - 1]
  const ends = entityEnds(entity)
  if (!ends) return distance(start, end) <= tolerance
  const p1 = points.get(ends[0])
  const p2 = points.get(ends[1])
  if (!p1 || !p2) return false
  const near = (a: Vec2, b: Vec2) => distance(a, b) <= tolerance
  return (near(start, p1) && near(end, p2)) || (near(start, p2) && near(end, p1))
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function pieceToken(
  entityId: string,
  sample: EdgeSample,
  pieces: readonly PieceSample[],
  tolerance: number,
): string {
  const own = pieces.filter((piece) => piece.entityId === entityId)
  if (!own.length) return entityId
  if (own.length === 1) return own[0].token
  const start = sample.points[0]
  const end = sample.points[sample.points.length - 1]
  const near = (a: Vec2, b: Vec2) => distance(a, b) <= tolerance
  const matching = own.filter(
    (piece) =>
      (near(start, piece.start) && near(end, piece.end)) ||
      (near(start, piece.end) && near(end, piece.start)),
  )
  const tokens = [...new Set(matching.map((piece) => piece.token))]
  return tokens.length === 1 ? tokens[0] : entityId
}

export function matchProfile(
  sketch: Sketch2D,
  edges: readonly EdgeSample[],
  vertices: readonly VertexSample[],
  tolerance = PROFILE_TOLERANCE,
  pieces: readonly PieceSample[] = [],
): ProfileMatch {
  const points = new Map(sketch.points.map((point) => [point.id, [point.x, point.y] as Vec2]))
  const entities = sketch.entities.filter((entity) => !entity.construction)
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const unmatched: number[] = []
  const ambiguous: Array<{ edge: number; entities: string[] }> = []
  const edgeEntities = edges.map((sample, index) => {
    const holders = entities.filter((entity) =>
      sample.points.every((q) => contains(entity, points, q, tolerance)),
    )
    if (holders.length === 1) return holders[0].id
    const exact = holders.filter((entity) => endsMatch(entity, points, sample, tolerance))
    if (exact.length === 1) return exact[0].id
    const pieced = holders.filter((entity) => pieces.some((piece) => piece.entityId === entity.id))
    if (pieced.length === 1) return pieced[0].id
    if (holders.length === 0) unmatched.push(index)
    else {
      ambiguous.push({
        edge: index,
        entities: holders.map((entity) => entity.id).sort(compareStrings),
      })
    }
    return ''
  })
  if (unmatched.length || ambiguous.length) {
    const parts: string[] = []
    if (unmatched.length) {
      parts.push(`${count(unmatched.length, 'profile edge')} match no sketch curve`)
    }
    if (ambiguous.length) {
      parts.push(
        `${count(ambiguous.length, 'profile edge')} lie on more than one sketch curve (${ambiguous
          .map((entry) => entry.entities.join(' and '))
          .join('; ')})`,
      )
    }
    return { ok: false, message: `${parts.join(', and ')}.`, unmatched, ambiguous }
  }
  const edgeTokens = edgeEntities.map((id, index) =>
    pieceToken(id, edges[index], pieces, tolerance),
  )
  const vertexTokens = vertices.map((sample) => {
    const incident = [...new Set(sample.edges.map((edge) => edgeTokens[edge]))].sort(compareStrings)
    const owners = [...new Set(sample.edges.map((edge) => edgeEntities[edge]))]
    const ids = new Set<string>()
    for (const id of owners) {
      const entity = byId.get(id)
      const ends = entity ? entityEnds(entity) : null
      if (!ends) continue
      for (const pointId of ends) {
        const point = points.get(pointId)
        if (point && distance(point, sample.position) <= tolerance) ids.add(pointId)
      }
    }
    return ids.size ? [...ids].sort(compareStrings)[0] : incident.join('&')
  })
  return { ok: true, edges: edgeTokens, vertices: vertexTokens }
}
