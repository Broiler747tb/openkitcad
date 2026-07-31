/**
 * Auto-constraint inference.
 *
 * As the cursor moves, work out what the user probably means: joining to an
 * existing corner, landing on a line, or drawing something dead horizontal.
 * The sketcher then quietly adds the matching constraint, so a beginner ends up
 * with a properly constrained sketch without ever learning the word.
 *
 * All tolerances are in screen pixels converted to millimetres by the caller,
 * so snapping feels the same whether zoomed to a whole machine or a 2 mm hole.
 */
import { v2, type Vec2 } from '../core/math'
import type { Sketch2D, SketchEntity } from './types'

export interface SnapResult {
  /** Where the point should actually go. */
  point: Vec2
  /** Reuse this existing point rather than making a new one. */
  snapToPointId: string | null
  /** Constrain the new point onto this entity. */
  onEntityId: string | null
  onEntityKind: 'line' | 'circle' | 'midpoint' | null
  /** Alignment with the point being drawn from. */
  align: 'horizontal' | 'vertical' | null
  /** Short phrase shown next to the cursor, e.g. "join" or "horizontal". */
  hint: string | null
}

export interface SnapOptions {
  /** Snapping radius in millimetres, derived from the current zoom. */
  tolerance: number
  /** The point the current segment starts from, for alignment inference. */
  from?: Vec2
  /** Points that must not be snapped to, e.g. the one being dragged. */
  exclude?: string[]
  /** Round to whole millimetres when nothing better applies. */
  gridStep?: number
}

/** Something in a sketch the user can point at. */
export interface SketchTarget {
  kind: 'point' | 'entity'
  id: string
}

/**
 * What is under the cursor. Points win over edges, because a corner is a
 * smaller target than the lines meeting at it and is usually what was meant.
 */
export function hitTestSketch(
  sketch: Sketch2D,
  cursor: Vec2,
  tolerance: number,
): SketchTarget | null {
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  let best: { target: SketchTarget; d: number } | null = null
  for (const p of sketch.points) {
    const d = v2.dist(cursor, [p.x, p.y])
    if (d < tolerance && (!best || d < best.d)) {
      best = { target: { kind: 'point', id: p.id }, d }
    }
  }
  if (best) return best.target

  for (const entity of sketch.entities) {
    let d = Infinity
    if (entity.kind === 'line') {
      d = distanceToSegment(cursor, pts.get(entity.p1)!, pts.get(entity.p2)!).d
    } else if (entity.kind === 'circle') {
      d = Math.abs(v2.dist(cursor, pts.get(entity.c)!) - entity.r)
    } else {
      const c = pts.get(entity.c)!
      const r = v2.dist(c, pts.get(entity.p1)!)
      d = Math.abs(v2.dist(cursor, c) - r)
    }
    if (d < tolerance * 1.5 && (!best || d < best.d)) {
      best = { target: { kind: 'entity', id: entity.id }, d }
    }
  }
  return best?.target ?? null
}

/** Add or remove a target from a selection, for shift-clicking. */
export function toggleSelection(
  selection: SketchTarget[],
  target: SketchTarget,
): SketchTarget[] {
  const existing = selection.findIndex(
    (s) => s.kind === target.kind && s.id === target.id,
  )
  if (existing >= 0) return selection.filter((_, i) => i !== existing)
  // Three is the most any constraint here needs (mirror: two points + an axis).
  return [...selection, target].slice(-3)
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const ab = v2.sub(b, a)
  const len2 = v2.dot(ab, ab)
  if (len2 < 1e-12) return { d: v2.dist(p, a), t: 0 }
  let t = v2.dot(v2.sub(p, a), ab) / len2
  t = Math.max(0, Math.min(1, t))
  const proj: Vec2 = [a[0] + ab[0] * t, a[1] + ab[1] * t]
  return { d: v2.dist(p, proj), t }
}

export function findSnap(
  sketch: Sketch2D,
  cursor: Vec2,
  options: SnapOptions,
): SnapResult {
  const { tolerance, from, exclude = [] } = options
  const pts = new Map<string, Vec2>()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])

  const result: SnapResult = {
    point: cursor,
    snapToPointId: null,
    onEntityId: null,
    onEntityKind: null,
    align: null,
    hint: null,
  }

  // 1. Existing points win outright: joining geometry is almost always what
  //    someone means when they click near a corner.
  let bestPoint: { id: string; d: number } | null = null
  for (const p of sketch.points) {
    if (exclude.includes(p.id)) continue
    const d = v2.dist(cursor, [p.x, p.y])
    if (d < tolerance && (!bestPoint || d < bestPoint.d)) bestPoint = { id: p.id, d }
  }
  if (bestPoint) {
    const p = pts.get(bestPoint.id)!
    return {
      ...result,
      point: p,
      snapToPointId: bestPoint.id,
      hint: bestPoint.id === 'origin' ? 'origin' : 'join',
    }
  }

  // 2. Midpoints and centres, which are useful and easy to miss by hand.
  for (const entity of sketch.entities) {
    if (entity.kind !== 'line') continue
    const mid = v2.mid(pts.get(entity.p1)!, pts.get(entity.p2)!)
    if (v2.dist(cursor, mid) < tolerance) {
      return {
        ...result,
        point: mid,
        onEntityId: entity.id,
        onEntityKind: 'midpoint',
        hint: 'middle',
      }
    }
  }

  // 3. Lying on an existing edge.
  let bestEdge: { entity: SketchEntity; point: Vec2; d: number } | null = null
  for (const entity of sketch.entities) {
    if (entity.kind === 'line') {
      const a = pts.get(entity.p1)!
      const b = pts.get(entity.p2)!
      const { d, t } = distanceToSegment(cursor, a, b)
      const on: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (d < tolerance && (!bestEdge || d < bestEdge.d)) {
        bestEdge = { entity, point: on, d }
      }
    } else if (entity.kind === 'circle') {
      const c = pts.get(entity.c)!
      const toCursor = v2.sub(cursor, c)
      const len = v2.len(toCursor)
      if (len < 1e-9) continue
      const on: Vec2 = [
        c[0] + (toCursor[0] / len) * entity.r,
        c[1] + (toCursor[1] / len) * entity.r,
      ]
      const d = Math.abs(len - entity.r)
      if (d < tolerance && (!bestEdge || d < bestEdge.d)) {
        bestEdge = { entity, point: on, d }
      }
    }
  }
  if (bestEdge) {
    return {
      ...result,
      point: bestEdge.point,
      onEntityId: bestEdge.entity.id,
      onEntityKind: bestEdge.entity.kind === 'line' ? 'line' : 'circle',
      hint: 'on edge',
    }
  }

  // 4. Straight across or straight up from where the segment started.
  if (from) {
    const dx = cursor[0] - from[0]
    const dy = cursor[1] - from[1]
    if (Math.abs(dy) < tolerance && Math.abs(dx) > tolerance) {
      return { ...result, point: [cursor[0], from[1]], align: 'horizontal', hint: 'horizontal' }
    }
    if (Math.abs(dx) < tolerance && Math.abs(dy) > tolerance) {
      return { ...result, point: [from[0], cursor[1]], align: 'vertical', hint: 'vertical' }
    }
  }

  // 5. Nothing to infer: fall back to a round number.
  const step = options.gridStep ?? 1
  if (step > 0) {
    result.point = [Math.round(cursor[0] / step) * step, Math.round(cursor[1] / step) * step]
  }
  return result
}
