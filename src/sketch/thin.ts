import { v2, type Vec2 } from '../core/math'
import { sketchChains } from './chains'
import { curveOf, entityEnds, pointLookup, sampleCurve, sketchBounds } from './curves'
import { splitEntityAt } from './modify'
import { offsetChains } from './offset'
import { contains, sketchRegions, type RegionPiece, type RegionRing } from './regions'
import type { Sketch2D, SketchEntity } from './types'

export type WallSide = 'one' | 'center' | 'two'

export type ThinResult =
  { ok: true; sketch: Sketch2D; keys: string[] } | { ok: false; message: string }

export interface ThinOptions {
  thickness: number
  side: WallSide
  profiles?: readonly string[]
  curves?: readonly string[]
}

function span(piece: RegionPiece): [number, number] {
  return [Math.min(piece.from, piece.to), Math.max(piece.from, piece.to)]
}

function scaleOf(sketch: Sketch2D): number {
  const bounds = sketchBounds(sketch)
  return bounds ? Math.max(v2.dist(bounds.min, bounds.max), 1e-6) : 1
}

function traceRings(
  derived: Sketch2D,
  rings: readonly RegionRing[],
  ids: (prefix: string) => string,
): string[] {
  const pts = pointLookup(derived)
  const weld = Math.max(scaleOf(derived) * 1e-6, 1e-9)
  const traced = new Set<string>()
  const partial = new Map<string, RegionPiece[]>()
  for (const piece of rings.flatMap((ring) => ring.pieces)) {
    const entity = derived.entities.find((candidate) => candidate.id === piece.entityId)
    const curve = entity && curveOf(entity, pts)
    if (!curve) continue
    const [a, b] = span(piece)
    if (piece.token === piece.entityId || (curve.closed && b - a > 1 - 1e-9)) {
      traced.add(piece.entityId)
    } else {
      partial.set(piece.entityId, [...(partial.get(piece.entityId) ?? []), piece])
    }
  }
  const shared: Array<{ at: Vec2; id: string }> = []
  const pointAt = (at: Vec2, cause: string, fallback: string) => {
    const found = shared.find((point) => v2.dist(point.at, at) <= weld)
    if (found) return found.id
    const existing = cause
      .split('+')
      .find((part) => part.startsWith('p:') && pts.has(part.slice(2)))
      ?.slice(2)
    const id = existing ?? fallback
    if (!existing) derived.points.push({ id, x: at[0], y: at[1] })
    shared.push({ at, id })
    return id
  }
  for (const [entityId, pieces] of partial) {
    const entity = derived.entities.find((candidate) => candidate.id === entityId)!
    const curve = curveOf(entity, pts)!
    const cuts = new Map<number, { s: number; pointId: string }>()
    for (const piece of pieces) {
      span(piece).forEach((end, index) => {
        const s = curve.closed ? ((end % 1) + 1) % 1 : end
        if (!curve.closed && (s < 1e-9 || s > 1 - 1e-9)) return
        const key = Math.round(s * 1e9)
        if (cuts.has(key)) return
        const cause = piece.causes[index]
        const name = [entityId, cause].sort().join('&')
        cuts.set(key, { s, pointId: pointAt(curve.at(s), cause, name) })
      })
    }
    const made = splitEntityAt(derived, entityId, [...cuts.values()], ids)
    const tokens = new Map<string, string>()
    for (const piece of pieces) {
      const [a, b] = span(piece)
      const match = made.find(
        (candidate) => Math.abs(candidate.from - a) < 1e-9 && Math.abs(candidate.to - b) < 1e-9,
      )
      if (match) tokens.set(match.id, piece.token)
    }
    const pieceIds = new Set(made.map((candidate) => candidate.id))
    derived.entities = derived.entities.flatMap((candidate) => {
      if (!pieceIds.has(candidate.id)) return [candidate]
      const token = tokens.get(candidate.id)
      return token ? [{ ...candidate, id: token }] : []
    })
    tokens.forEach((token) => traced.add(token))
  }
  return [...traced]
}

function capEnds(derived: Sketch2D, ends: readonly string[], side: WallSide): void {
  const known = new Set(derived.points.map((point) => point.id))
  for (const end of ends) {
    const [a, b] = side === 'center' ? [`${end}~wall1`, `${end}~wall0`] : [end, `${end}~wall0`]
    if (!known.has(a) || !known.has(b)) continue
    derived.entities.push({ id: `${end}~cap`, kind: 'line', p1: a, p2: b, construction: false })
  }
}

function polygons(sketch: Sketch2D, entities: SketchEntity[], tolerance: number): Vec2[][] {
  const pts = pointLookup(sketch)
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  return sketchChains({ ...sketch, entities }).map((chain) =>
    chain.pieces.flatMap((piece) => {
      const curve = curveOf(byId.get(piece.entityId)!, pts)!
      const samples = sampleCurve(curve, tolerance).p
      return (piece.reversed ? [...samples].reverse() : samples).slice(0, -1)
    }),
  )
}

export function thinSketch(sketch: Sketch2D, options: ThinOptions): ThinResult {
  const thickness = Math.abs(options.thickness)
  if (!(thickness > 0))
    return { ok: false, message: 'The wall thickness has to be more than zero.' }
  const regions = sketchRegions(sketch).regions
  if (options.profiles?.some((key) => !regions.some((region) => region.key === key))) {
    return { ok: false, message: 'A profile this wall follows is gone from the sketch.' }
  }
  const curves = options.curves ?? []
  if (curves.some((id) => !sketch.entities.some((entity) => entity.id === id))) {
    return { ok: false, message: 'A curve this wall follows is gone from the sketch.' }
  }
  const chosen = options.profiles
    ? regions.filter((region) => options.profiles!.includes(region.key))
    : regions.filter((region) => region.solid)
  const rings = chosen.flatMap((region) => [region.outer, ...region.holes])
  const derived = structuredClone(sketch)
  const needed = new Set([
    ...rings.flatMap((ring) => ring.pieces.map((piece) => piece.entityId)),
    ...curves,
  ])
  derived.entities = derived.entities.filter(
    (entity) => needed.has(entity.id) && !entity.construction,
  )
  derived.constraints = []
  let serial = 0
  const ids = (prefix: string) => `${prefix}~thin${serial++}`
  const traced = traceRings(derived, rings, ids)
  const targets = [
    ...new Set([
      ...traced,
      ...curves.filter((id) => derived.entities.some((entity) => entity.id === id)),
    ]),
  ]
  if (!targets.length)
    return { ok: false, message: 'Pick the profiles or curves the wall follows.' }
  const sources = derived.entities.filter((entity) => targets.includes(entity.id))
  const chains = sketchChains({ ...derived, entities: sources })
  const degree = new Map<string, number>()
  for (const entity of sources) {
    for (const id of entityEnds(entity) ?? []) degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  const ends = [...degree].filter(([, count]) => count === 1).map(([id]) => id)
  const passes =
    options.side === 'center'
      ? [thickness / 2, -thickness / 2]
      : [options.side === 'two' ? -thickness : thickness]
  const taken: Record<string, Set<string>> = {
    p: new Set(derived.points.map((point) => point.id)),
    e: new Set(derived.entities.map((entity) => entity.id)),
  }
  for (const [pass, distance] of passes.entries()) {
    const name = (prefix: string, origin?: string) => {
      const pool = taken[prefix]
      const wanted = origin && pool && `${origin}~wall${pass}`
      const id = wanted && !pool.has(wanted) ? wanted : ids(prefix)
      pool?.add(id)
      return id
    }
    const result = offsetChains(derived, targets, distance, name)
    if (!result.ok) return { ok: false, message: result.message ?? 'The wall could not be offset.' }
  }
  derived.constraints = []
  capEnds(derived, ends, options.side)
  if (options.side === 'center') {
    derived.entities = derived.entities.filter((entity) => !targets.includes(entity.id))
  }
  const tolerance = Math.max(Math.min(thickness, scaleOf(derived)) * 1e-2, 1e-7)
  const walls = chains.map((chain) => {
    const own = chain.pieces.map((piece) => piece.entityId)
    const lines = new Set([
      ...(options.side === 'center' ? [] : own),
      ...own.flatMap((id) =>
        passes
          .flatMap((_, pass) => [`~wall${pass}`, `.0~wall${pass}`, `.1~wall${pass}`])
          .map((suffix) => `${id}${suffix}`),
      ),
      ...sources
        .filter((entity) => own.includes(entity.id))
        .flatMap((entity) => entityEnds(entity) ?? [])
        .map((id) => `${id}~cap`),
    ])
    return polygons(
      derived,
      derived.entities.filter((entity) => lines.has(entity.id)),
      tolerance,
    )
  })
  const band = sketchRegions(derived).regions.filter(
    (region) =>
      [region.outer, ...region.holes].some((ring) =>
        ring.pieces.some((piece) => !targets.includes(piece.entityId)),
      ) &&
      walls.some(
        (wall) => wall.filter((polygon) => contains(polygon, region.inside)).length % 2 === 1,
      ),
  )
  if (!band.length) return { ok: false, message: 'The wall does not close into a shape.' }
  return { ok: true, sketch: derived, keys: band.map((region) => region.key) }
}
