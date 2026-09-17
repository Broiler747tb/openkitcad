import type { Vec2 } from '../core/math'
import type { GlyphContour, GlyphSegment, Sketch2D, TextEntity, TextOutline } from './types'

export const TEXT_KEY = 'text:'

export function textKey(entityId: string): string {
  return `${TEXT_KEY}${entityId}`
}

export function isTextKey(key: string): boolean {
  return key.startsWith(TEXT_KEY)
}

export function textIdOf(key: string): string {
  return key.slice(TEXT_KEY.length)
}

export function hasOutline(entity: TextEntity): boolean {
  return !!entity.outline?.contours.length
}

export function profileTexts(sketch: Sketch2D): TextEntity[] {
  return sketch.entities.filter(
    (entity): entity is TextEntity =>
      entity.kind === 'text' && !entity.construction && hasOutline(entity),
  )
}

export function textProfileKeys(sketch: Sketch2D): string[] {
  return profileTexts(sketch).map((entity) => textKey(entity.id))
}

export function textPlacer(entity: TextEntity, origin: Vec2): (point: Vec2) => Vec2 {
  const angle = (entity.angle * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const scale = entity.height
  return ([x, y]) => [
    origin[0] + scale * (x * cos - y * sin),
    origin[1] + scale * (x * sin + y * cos),
  ]
}

export function segmentEnd(segment: GlyphSegment): Vec2 {
  return [segment[segment.length - 2], segment[segment.length - 1]]
}

export function segmentPoint(from: Vec2, segment: GlyphSegment, t: number): Vec2 {
  const s = 1 - t
  if (segment.length === 2) {
    return [s * from[0] + t * segment[0], s * from[1] + t * segment[1]]
  }
  if (segment.length === 4) {
    const [cx, cy, x, y] = segment
    return [
      s * s * from[0] + 2 * s * t * cx + t * t * x,
      s * s * from[1] + 2 * s * t * cy + t * t * y,
    ]
  }
  const [ax, ay, bx, by, x, y] = segment
  return [
    s * s * s * from[0] + 3 * s * s * t * ax + 3 * s * t * t * bx + t * t * t * x,
    s * s * s * from[1] + 3 * s * s * t * ay + 3 * s * t * t * by + t * t * t * y,
  ]
}

export function flattenContour(contour: GlyphContour, steps = 8): Vec2[] {
  const out: Vec2[] = [contour.start]
  let from: Vec2 = contour.start
  for (const segment of contour.segments) {
    const count = segment.length === 2 ? 1 : steps
    for (let i = 1; i <= count; i++) out.push(segmentPoint(from, segment, i / count))
    from = segmentEnd(segment)
  }
  const last = out[out.length - 1]
  if (out.length > 1 && Math.hypot(last[0] - out[0][0], last[1] - out[0][1]) < 1e-9) out.pop()
  return out
}

export function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]
    const [x1, y1] = polygon[(i + 1) % polygon.length]
    sum += x0 * y1 - x1 * y0
  }
  return sum / 2
}

export function winding(polygon: readonly Vec2[], point: Vec2): number {
  let total = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]
    const [x1, y1] = polygon[(i + 1) % polygon.length]
    const side = (x1 - x0) * (point[1] - y0) - (point[0] - x0) * (y1 - y0)
    if (y0 <= point[1]) {
      if (y1 > point[1] && side > 0) total++
    } else if (y1 <= point[1] && side < 0) total--
  }
  return total
}

export function filledAt(polygons: readonly (readonly Vec2[])[], point: Vec2): boolean {
  let total = 0
  for (const polygon of polygons) total += winding(polygon, point)
  return total !== 0
}

export interface GlyphShape {
  outer: number
  holes: number[]
}

export function glyphShapes(polygons: readonly (readonly Vec2[])[]): GlyphShape[] {
  const areas = polygons.map((polygon) => signedArea(polygon))
  let largest = -1
  areas.forEach((area, i) => {
    if (largest < 0 || Math.abs(area) > Math.abs(areas[largest])) largest = i
  })
  if (largest < 0 || areas[largest] === 0) return []
  const fill = Math.sign(areas[largest])
  const shapes: GlyphShape[] = []
  polygons.forEach((_, i) => {
    if (Math.sign(areas[i]) === fill) shapes.push({ outer: i, holes: [] })
  })
  polygons.forEach((polygon, i) => {
    if (Math.sign(areas[i]) !== -fill || !polygon.length) return
    let best = -1
    shapes.forEach((shape, index) => {
      if (Math.abs(areas[shape.outer]) <= Math.abs(areas[i])) return
      if (winding(polygons[shape.outer], interiorProbe(polygon)) === 0) return
      if (best < 0 || Math.abs(areas[shape.outer]) < Math.abs(areas[shapes[best].outer])) {
        best = index
      }
    })
    if (best >= 0) shapes[best].holes.push(i)
  })
  return shapes
}

function interiorProbe(polygon: readonly Vec2[]): Vec2 {
  let sx = 0
  let sy = 0
  for (const [x, y] of polygon) {
    sx += x
    sy += y
  }
  const centre: Vec2 = [sx / polygon.length, sy / polygon.length]
  return winding(polygon, centre) !== 0 ? centre : polygon[0]
}

export function outlineBounds(outline: TextOutline): { min: Vec2; max: Vec2 } | null {
  let min: Vec2 = [Infinity, Infinity]
  let max: Vec2 = [-Infinity, -Infinity]
  const grow = (x: number, y: number) => {
    min = [Math.min(min[0], x), Math.min(min[1], y)]
    max = [Math.max(max[0], x), Math.max(max[1], y)]
  }
  for (const contour of outline.contours) {
    grow(contour.start[0], contour.start[1])
    for (const segment of contour.segments) {
      for (let i = 0; i < segment.length; i += 2) grow(segment[i], segment[i + 1])
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null
}

export function placeSegment(segment: GlyphSegment, place: (point: Vec2) => Vec2): GlyphSegment {
  const out: number[] = []
  for (let i = 0; i < segment.length; i += 2) out.push(...place([segment[i], segment[i + 1]]))
  return out as GlyphSegment
}

interface Part {
  from: Vec2
  segment: GlyphSegment
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function segmentTangent(from: Vec2, segment: GlyphSegment, t: number): Vec2 {
  if (segment.length === 2) return [segment[0] - from[0], segment[1] - from[1]]
  const s = 1 - t
  if (segment.length === 4) {
    const [cx, cy, x, y] = segment
    return [2 * s * (cx - from[0]) + 2 * t * (x - cx), 2 * s * (cy - from[1]) + 2 * t * (y - cy)]
  }
  const [ax, ay, bx, by, x, y] = segment
  return [
    3 * s * s * (ax - from[0]) + 6 * s * t * (bx - ax) + 3 * t * t * (x - bx),
    3 * s * s * (ay - from[1]) + 6 * s * t * (by - ay) + 3 * t * t * (y - by),
  ]
}

function splitSegment(
  from: Vec2,
  segment: GlyphSegment,
  t: number,
): { first: GlyphSegment; second: GlyphSegment; at: Vec2 } {
  if (segment.length === 2) {
    const end: Vec2 = [segment[0], segment[1]]
    const at = lerp(from, end, t)
    return { first: [at[0], at[1]], second: [end[0], end[1]], at }
  }
  if (segment.length === 4) {
    const control: Vec2 = [segment[0], segment[1]]
    const end: Vec2 = [segment[2], segment[3]]
    const a = lerp(from, control, t)
    const b = lerp(control, end, t)
    const at = lerp(a, b, t)
    return { first: [a[0], a[1], at[0], at[1]], second: [b[0], b[1], end[0], end[1]], at }
  }
  const one: Vec2 = [segment[0], segment[1]]
  const two: Vec2 = [segment[2], segment[3]]
  const end: Vec2 = [segment[4], segment[5]]
  const a = lerp(from, one, t)
  const b = lerp(one, two, t)
  const c = lerp(two, end, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const at = lerp(d, e, t)
  return {
    first: [a[0], a[1], d[0], d[1], at[0], at[1]],
    second: [e[0], e[1], c[0], c[1], end[0], end[1]],
    at,
  }
}

function refineCrossing(
  a: Part,
  b: Part,
  start: number,
  other: number,
): { t: number; u: number; at: Vec2 } | null {
  let t = start
  let u = other
  for (let i = 0; i < 30; i++) {
    const p = segmentPoint(a.from, a.segment, t)
    const q = segmentPoint(b.from, b.segment, u)
    const fx = p[0] - q[0]
    const fy = p[1] - q[1]
    if (Math.hypot(fx, fy) < 1e-12) break
    const d1 = segmentTangent(a.from, a.segment, t)
    const d2 = segmentTangent(b.from, b.segment, u)
    const det = d2[0] * d1[1] - d1[0] * d2[1]
    if (Math.abs(det) < 1e-14) return null
    t += (fx * d2[1] - d2[0] * fy) / det
    u += (fx * d1[1] - d1[0] * fy) / det
    if (!(t > -0.5 && t < 1.5 && u > -0.5 && u < 1.5)) return null
  }
  const p = segmentPoint(a.from, a.segment, t)
  const q = segmentPoint(b.from, b.segment, u)
  if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) return null
  const edge = 1e-7
  if (t < edge || t > 1 - edge || u < edge || u > 1 - edge) return null
  return { t, u, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] }
}

function partBox(part: Part): [number, number, number, number] {
  let x0 = part.from[0]
  let y0 = part.from[1]
  let x1 = part.from[0]
  let y1 = part.from[1]
  for (let i = 0; i < part.segment.length; i += 2) {
    x0 = Math.min(x0, part.segment[i])
    x1 = Math.max(x1, part.segment[i])
    y0 = Math.min(y0, part.segment[i + 1])
    y1 = Math.max(y1, part.segment[i + 1])
  }
  return [x0, y0, x1, y1]
}

function chordCrossing(p: Vec2, q: Vec2, r: Vec2, s: Vec2): number | null {
  const rx = q[0] - p[0]
  const ry = q[1] - p[1]
  const sx = s[0] - r[0]
  const sy = s[1] - r[1]
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-18) return null
  const t = ((r[0] - p[0]) * sy - (r[1] - p[1]) * sx) / denominator
  const u = ((r[0] - p[0]) * ry - (r[1] - p[1]) * rx) / denominator
  const edge = 1e-9
  return t >= -edge && t <= 1 + edge && u >= -edge && u <= 1 + edge ? t : null
}

function selfCrossings(
  parts: readonly Part[],
  steps = 12,
): Array<{ i: number; t: number; j: number; u: number; at: Vec2 }> {
  const boxes = parts.map(partBox)
  const found: Array<{ i: number; t: number; j: number; u: number; at: Vec2 }> = []
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (j === i + 1 || (i === 0 && j === parts.length - 1)) continue
      const a = boxes[i]
      const b = boxes[j]
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue
      for (let m = 0; m < steps; m++) {
        for (let n = 0; n < steps; n++) {
          const p = segmentPoint(parts[i].from, parts[i].segment, m / steps)
          const q = segmentPoint(parts[i].from, parts[i].segment, (m + 1) / steps)
          const r = segmentPoint(parts[j].from, parts[j].segment, n / steps)
          const t = segmentPoint(parts[j].from, parts[j].segment, (n + 1) / steps)
          if (chordCrossing(p, q, r, t) === null) continue
          const refined = refineCrossing(parts[i], parts[j], (m + 0.5) / steps, (n + 0.5) / steps)
          if (!refined) continue
          if (
            found.some(
              (existing) =>
                Math.hypot(existing.at[0] - refined.at[0], existing.at[1] - refined.at[1]) < 1e-9,
            )
          ) {
            continue
          }
          found.push({ i, t: refined.t, j, u: refined.u, at: refined.at })
        }
      }
    }
  }
  return found
}

function contourParts(contour: GlyphContour): Part[] {
  const parts: Part[] = []
  let from = contour.start
  for (const segment of contour.segments) {
    parts.push({ from, segment })
    from = segmentEnd(segment)
  }
  return parts
}

export function simpleLoops(contour: GlyphContour): GlyphContour[] {
  const parts = contourParts(contour)
  if (parts.length < 4) return [contour]
  const crossings = selfCrossings(parts)
  if (!crossings.length) return [contour]
  const cuts = new Map<number, Array<{ at: number; point: Vec2 }>>()
  for (const crossing of crossings) {
    cuts.set(crossing.i, [...(cuts.get(crossing.i) ?? []), { at: crossing.t, point: crossing.at }])
    cuts.set(crossing.j, [...(cuts.get(crossing.j) ?? []), { at: crossing.u, point: crossing.at }])
  }
  const walk: Array<{ part: Part; node: string | null }> = []
  const key = (point: Vec2) => `${Math.round(point[0] * 1e9)},${Math.round(point[1] * 1e9)}`
  parts.forEach((part, index) => {
    const own = (cuts.get(index) ?? []).sort((a, b) => a.at - b.at)
    if (!own.length) {
      walk.push({ part, node: null })
      return
    }
    let from = part.from
    let segment = part.segment
    let used = 0
    for (const cut of own) {
      const local = (cut.at - used) / (1 - used)
      if (!(local > 1e-9 && local < 1 - 1e-9)) continue
      const split = splitSegment(from, segment, local)
      const first = [...split.first] as number[]
      first[first.length - 2] = cut.point[0]
      first[first.length - 1] = cut.point[1]
      walk.push({ part: { from, segment: first as GlyphSegment }, node: key(cut.point) })
      from = cut.point
      segment = split.second
      used = cut.at
    }
    walk.push({ part: { from, segment }, node: null })
  })
  const loops: GlyphContour[] = []
  const open: Array<{ part: Part; node: string | null }> = []
  const seen = new Map<string, number>()
  const take = (steps: Array<{ part: Part; node: string | null }>) => {
    if (steps.length < 2) return
    const start = steps[0].part.from
    const segments = steps.map((step) => step.part.segment)
    const last = segmentEnd(segments[segments.length - 1])
    if (Math.hypot(last[0] - start[0], last[1] - start[1]) > 1e-9) return
    loops.push({ start, segments })
  }
  for (const step of walk) {
    open.push(step)
    if (!step.node) continue
    const found = seen.get(step.node)
    if (found === undefined) {
      seen.set(step.node, open.length - 1)
      continue
    }
    const inner = open.splice(found + 1)
    take(inner)
    for (const removed of inner) if (removed.node) seen.delete(removed.node)
    seen.set(step.node, found)
  }
  take(open)
  return loops.length ? loops : [contour]
}

const placedCache = new WeakMap<TextEntity, { origin: Vec2; contours: GlyphContour[] }>()

export function placedContours(entity: TextEntity, origin: Vec2): GlyphContour[] {
  if (!entity.outline) return []
  const cached = placedCache.get(entity)
  if (cached && cached.origin[0] === origin[0] && cached.origin[1] === origin[1]) {
    return cached.contours
  }
  const place = textPlacer(entity, origin)
  const contours = entity.outline.contours.flatMap((contour) =>
    simpleLoops({
      start: place(contour.start),
      segments: contour.segments.map((segment) => placeSegment(segment, place)),
    }),
  )
  placedCache.set(entity, { origin: [origin[0], origin[1]], contours })
  return contours
}

export function textPolygons(entity: TextEntity, origin: Vec2, steps = 8): Vec2[][] {
  return placedContours(entity, origin).map((contour) => flattenContour(contour, steps))
}

export function textFills(
  entity: TextEntity,
  origin: Vec2,
): Array<{ contour: Vec2[]; holes: Vec2[][] }> {
  const polygons = textPolygons(entity, origin)
  const oriented = (polygon: Vec2[], ccw: boolean) =>
    signedArea(polygon) > 0 === ccw ? polygon : [...polygon].reverse()
  return glyphShapes(polygons).map((shape) => ({
    contour: oriented(polygons[shape.outer], true),
    holes: shape.holes.map((hole) => oriented(polygons[hole], false)),
  }))
}

function segmentBox(from: Vec2, segment: GlyphSegment): [number, number, number, number] {
  let x0 = from[0]
  let y0 = from[1]
  let x1 = from[0]
  let y1 = from[1]
  for (let i = 0; i < segment.length; i += 2) {
    x0 = Math.min(x0, segment[i])
    x1 = Math.max(x1, segment[i])
    y0 = Math.min(y0, segment[i + 1])
    y1 = Math.max(y1, segment[i + 1])
  }
  return [x0, y0, x1, y1]
}

export function segmentDistance(from: Vec2, segment: GlyphSegment, q: Vec2): number {
  const at = (t: number) => {
    const p = segmentPoint(from, segment, t)
    return Math.hypot(p[0] - q[0], p[1] - q[1])
  }
  if (segment.length === 2) {
    const dx = segment[0] - from[0]
    const dy = segment[1] - from[1]
    const length = dx * dx + dy * dy
    const t = length > 0 ? ((q[0] - from[0]) * dx + (q[1] - from[1]) * dy) / length : 0
    return at(Math.min(1, Math.max(0, t)))
  }
  const samples = 32
  let bestT = 0
  let best = Infinity
  for (let i = 0; i <= samples; i++) {
    const d = at(i / samples)
    if (d < best) {
      best = d
      bestT = i / samples
    }
  }
  let lo = Math.max(0, bestT - 1 / samples)
  let hi = Math.min(1, bestT + 1 / samples)
  for (let i = 0; i < 80 && hi - lo > 1e-15; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (at(a) < at(b)) hi = b
    else lo = a
  }
  return Math.min(best, at((lo + hi) / 2))
}

export function textDistance(entity: TextEntity, origin: Vec2, q: Vec2, limit = Infinity): number {
  let best = Infinity
  for (const contour of placedContours(entity, origin)) {
    let from = contour.start
    for (const segment of contour.segments) {
      const [x0, y0, x1, y1] = segmentBox(from, segment)
      const reach = Math.min(limit, best)
      if (q[0] >= x0 - reach && q[0] <= x1 + reach && q[1] >= y0 - reach && q[1] <= y1 + reach) {
        best = Math.min(best, segmentDistance(from, segment, q))
      }
      from = segmentEnd(segment)
    }
  }
  return best
}

export interface TextProfile {
  key: string
  entityId: string
  polygons: Vec2[][]
  fills: Array<{ contour: Vec2[]; holes: Vec2[][] }>
  min: Vec2
  max: Vec2
  area: number
  centre: Vec2
}

const textProfileCache = new WeakMap<Sketch2D, TextProfile[]>()

export function cachedTextProfiles(sketch: Sketch2D): TextProfile[] {
  let result = textProfileCache.get(sketch)
  if (result) return result
  result = []
  for (const entity of profileTexts(sketch)) {
    const point = sketch.points.find((candidate) => candidate.id === entity.p)
    if (!point) continue
    const origin: Vec2 = [point.x, point.y]
    const polygons = textPolygons(entity, origin)
    const fills = textFills(entity, origin)
    let min: Vec2 = [Infinity, Infinity]
    let max: Vec2 = [-Infinity, -Infinity]
    for (const polygon of polygons) {
      for (const [x, y] of polygon) {
        min = [Math.min(min[0], x), Math.min(min[1], y)]
        max = [Math.max(max[0], x), Math.max(max[1], y)]
      }
    }
    if (!Number.isFinite(min[0])) continue
    const area = fills.reduce(
      (sum, fill) =>
        sum +
        Math.abs(signedArea(fill.contour)) -
        fill.holes.reduce((holes, hole) => holes + Math.abs(signedArea(hole)), 0),
      0,
    )
    result.push({
      key: textKey(entity.id),
      entityId: entity.id,
      polygons,
      fills,
      min,
      max,
      area,
      centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
    })
  }
  textProfileCache.set(sketch, result)
  return result
}

export function textProfileAt(
  texts: readonly TextProfile[],
  point: Vec2,
  tolerance: number,
): TextProfile | null {
  let best: { text: TextProfile; gap: number } | null = null
  for (const text of texts) {
    if (
      point[0] < text.min[0] - tolerance ||
      point[0] > text.max[0] + tolerance ||
      point[1] < text.min[1] - tolerance ||
      point[1] > text.max[1] + tolerance
    ) {
      continue
    }
    let gap = filledAt(text.polygons, point) ? 0 : Infinity
    if (gap > 0) {
      for (const polygon of text.polygons) {
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i]
          const b = polygon[(i + 1) % polygon.length]
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const length = dx * dx + dy * dy
          const t =
            length > 0
              ? Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length))
              : 0
          gap = Math.min(gap, Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t))
        }
      }
    }
    if (gap <= tolerance && (!best || gap < best.gap)) best = { text, gap }
  }
  return best?.text ?? null
}
