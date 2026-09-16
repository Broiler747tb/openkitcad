import { v2, type Vec2 } from '../../core/math'
import type { ToolAnchor } from './types'

export const DEG = Math.PI / 180
export const TAU = Math.PI * 2

export function freeAnchor(point: Vec2, align: ToolAnchor['align'] = null): ToolAnchor {
  return { point, snapToPointId: null, onEntityId: null, onEntityKind: null, align }
}

export function keepOrFree(cursor: ToolAnchor, point: Vec2): ToolAnchor {
  return v2.dist(cursor.point, point) <= 1e-9 ? cursor : freeAnchor(point)
}

export function wrapAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU
}

export function signedTurn(delta: number): number {
  const wrapped = wrapAngle(delta)
  return wrapped > Math.PI ? wrapped - TAU : wrapped
}

export function degrees(angle: number): number {
  return wrapAngle(angle) / DEG
}

export function alignmentOf(angleDegrees: number | undefined): ToolAnchor['align'] {
  if (angleDegrees === undefined) return null
  const a = ((angleDegrees % 180) + 180) % 180
  if (Math.abs(a) < 1e-9 || Math.abs(a - 180) < 1e-9) return 'horizontal'
  if (Math.abs(a - 90) < 1e-9) return 'vertical'
  return null
}

export function polar(centre: Vec2, radius: number, angle: number): Vec2 {
  return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)]
}

export function perpendicular(v: Vec2): Vec2 {
  return [-v[1], v[0]]
}

export function ring(centre: Vec2, radius: number, segments = 96): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) out.push(polar(centre, radius, (i / segments) * TAU))
  return out
}

export function arcPolyline(centre: Vec2, radius: number, start: number, sweep: number): Vec2[] {
  const segments = Math.max(8, Math.ceil((Math.abs(sweep) / TAU) * 96))
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++)
    out.push(polar(centre, radius, start + (sweep * i) / segments))
  return out
}

export function ellipsePolyline(
  centre: Vec2,
  rx: number,
  ry: number,
  rotation: number,
  segments = 128,
): Vec2[] {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * TAU
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    out.push([centre[0] + c * x - s * y, centre[1] + s * x + c * y])
  }
  return out
}

export function circumcircle(a: Vec2, b: Vec2, c: Vec2): { centre: Vec2; radius: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  const scale = Math.max(v2.dist(a, b), v2.dist(b, c), v2.dist(c, a), 1e-9)
  if (Math.abs(d) < 1e-9 * scale * scale) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const centre: Vec2 = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ]
  return { centre, radius: v2.dist(centre, a) }
}

export interface ArcShape {
  centre: Vec2
  radius: number
  start: number
  sweep: number
}

function arcFromCentre(centre: Vec2, from: Vec2, to: Vec2, via: Vec2): ArcShape {
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0])
  const end = Math.atan2(to[1] - centre[1], to[0] - centre[0])
  const middle = Math.atan2(via[1] - centre[1], via[0] - centre[0])
  const ccwSweep = wrapAngle(end - start) || TAU
  const ccw = wrapAngle(middle - start) <= ccwSweep
  return { centre, radius: v2.dist(centre, from), start, sweep: ccw ? ccwSweep : ccwSweep - TAU }
}

export function arcThrough(from: Vec2, to: Vec2, via: Vec2): ArcShape | null {
  const circle = circumcircle(from, to, via)
  return circle ? arcFromCentre(circle.centre, from, to, via) : null
}

export function arcWithRadius(from: Vec2, to: Vec2, via: Vec2, radius: number): ArcShape | null {
  const chord = v2.sub(to, from)
  const half = v2.len(chord) / 2
  if (half < 1e-9 || radius < half) return null
  const middle = v2.mid(from, to)
  const normal = v2.norm(perpendicular(chord))
  const offset = Math.sqrt(Math.max(0, radius * radius - half * half))
  const viaSide = Math.sign(v2.cross(chord, v2.sub(via, from))) || 1
  const reference = arcThrough(from, to, via)
  const major = reference ? Math.abs(reference.sweep) > Math.PI : false
  const centre = v2.add(middle, v2.scale(normal, (major ? viaSide : -viaSide) * offset))
  return arcFromCentre(centre, from, to, via)
}

export function tangentArc(start: Vec2, direction: Vec2, end: Vec2): ArcShape | null {
  const unit = v2.norm(direction)
  const normal = perpendicular(unit)
  const d = v2.sub(start, end)
  const along = v2.dot(normal, d)
  if (Math.abs(along) < 1e-9 * Math.max(1, v2.len(d))) return null
  const t = -v2.dot(d, d) / (2 * along)
  const centre = v2.add(start, v2.scale(normal, t))
  const from = Math.atan2(start[1] - centre[1], start[0] - centre[0])
  const to = Math.atan2(end[1] - centre[1], end[0] - centre[0])
  const ccw = t > 0
  const sweep = ccw ? wrapAngle(to - from) || TAU : -(wrapAngle(from - to) || TAU)
  return { centre, radius: Math.abs(t), start: from, sweep }
}

export function regularPolygon(
  centre: Vec2,
  radius: number,
  firstAngle: number,
  sides: number,
): Vec2[] {
  const out: Vec2[] = []
  for (let k = 0; k < sides; k++) out.push(polar(centre, radius, firstAngle + (k / sides) * TAU))
  return out
}

export function closed(points: Vec2[]): Vec2[] {
  return points.length ? [...points, points[0]] : points
}

export function slotOutline(c1: Vec2, c2: Vec2, halfWidth: number): Vec2[] {
  const axis = v2.sub(c2, c1)
  const length = v2.len(axis)
  const u: Vec2 = length > 1e-12 ? v2.scale(axis, 1 / length) : [1, 0]
  const angle = Math.atan2(u[1], u[0])
  return [
    ...arcPolyline(c2, halfWidth, angle + Math.PI / 2, -Math.PI),
    ...arcPolyline(c1, halfWidth, angle - Math.PI / 2, -Math.PI),
    polar(c2, halfWidth, angle + Math.PI / 2),
  ]
}
