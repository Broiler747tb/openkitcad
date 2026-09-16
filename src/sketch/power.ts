import type { Vec2 } from '../core/math'
import { entityLength, entityPointIds, pointLookup } from './curves'
import type { Sketch2D, SketchEntity, Constraint } from './types'

type Id = (prefix: string) => string
export const pointIds = (e: SketchEntity): string[] => entityPointIds(e)
export function constraintRefs(c: Constraint): string[] {
  return Object.entries(c)
    .filter(
      ([key, value]) =>
        ['a', 'b', 'p', 'e', 'line', 'circle'].includes(key) && typeof value === 'string',
    )
    .map(([, value]) => value as string)
}

export function addExactShape(
  s: Sketch2D,
  kind: 'line' | 'rectangle' | 'circle' | 'ring',
  centre: Vec2,
  a: number,
  b: number,
  angle: number,
  id: Id,
): string[] {
  if (
    ![...centre, a, b, angle].every(Number.isFinite) ||
    a <= 0 ||
    (kind !== 'line' && kind !== 'circle' && b <= 0)
  )
    throw new Error('Dimensions must be positive and finite.')
  if ([...centre, a, b].some((v) => Math.abs(v) > 1e6))
    throw new Error('Keep dimensions and coordinates within 1,000,000 mm.')
  if (kind === 'ring' && b >= a)
    throw new Error('Inner diameter must be smaller than outer diameter.')
  const theta = (angle * Math.PI) / 180,
    cos = Math.cos(theta),
    sin = Math.sin(theta)
  const p = (x: number, y: number) => {
    const key = id('p')
    s.points.push({ id: key, x: centre[0] + x * cos - y * sin, y: centre[1] + x * sin + y * cos })
    return key
  }
  const added: string[] = []
  const line = (p1: string, p2: string) => {
    const key = id('e')
    s.entities.push({ id: key, kind: 'line', p1, p2, construction: false })
    added.push(key)
  }
  if (kind === 'line') line(p(0, 0), p(a, 0))
  else if (kind === 'rectangle') {
    const corners = [p(-a / 2, -b / 2), p(a / 2, -b / 2), p(a / 2, b / 2), p(-a / 2, b / 2)]
    for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4])
  } else {
    const c = p(0, 0)
    for (const diameter of kind === 'ring' ? [a, b] : [a]) {
      const key = id('e')
      s.entities.push({ id: key, kind: 'circle', c, r: diameter / 2, construction: false })
      added.push(key)
    }
  }
  // Exact construction is fixed intentionally; Unfix exposes its degrees of freedom.
  setFixed(s, added, true, id)
  return added
}

/** Copies are independent and unconstrained; shared vertices stay shared within each copy. */
export function copyTransformed(
  s: Sketch2D,
  selected: string[],
  options: { dx: number; dy: number; angle: number; scale: number; centre: Vec2; count: number },
  id: Id,
): string[] {
  const { dx, dy, angle, scale, centre, count } = options
  if (
    ![dx, dy, angle, scale, ...centre, count].every(Number.isFinite) ||
    scale <= 0 ||
    count < 1 ||
    count > 100 ||
    !Number.isInteger(count)
  )
    throw new Error('Use a positive scale and 1–100 whole copies.')
  const entities = s.entities.filter((e) => selected.includes(e.id))
  if (!entities.length) throw new Error('Select geometry to copy.')
  if (entities.length * count > 500)
    throw new Error('Limit each operation to 500 copied entities for solver responsiveness.')
  const sourcePoints = new Map(s.points.map((p) => [p.id, p]))
  const refs = [...new Set(entities.flatMap(pointIds))]
  if (refs.some((key) => !sourcePoints.has(key)))
    throw new Error('Selection contains missing points.')
  const added: string[] = []
  for (let n = 1; n <= count; n++) {
    const theta = (angle * n * Math.PI) / 180,
      cos = Math.cos(theta),
      sin = Math.sin(theta)
    const remap = new Map<string, string>()
    for (const key of refs) {
      const p = sourcePoints.get(key)!,
        next = id('p'),
        x = (p.x - centre[0]) * scale,
        y = (p.y - centre[1]) * scale
      if (
        ![
          x,
          y,
          centre[0] + x * cos - y * sin + dx * n,
          centre[1] + x * sin + y * cos + dy * n,
        ].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6)
      )
        throw new Error('Copied geometry exceeds the coordinate limit (1,000,000 mm).')
      s.points.push({
        id: next,
        x: centre[0] + x * cos - y * sin + dx * n,
        y: centre[1] + x * sin + y * cos + dy * n,
      })
      remap.set(key, next)
    }
    const turnHandle = (h: { dx: number; dy: number; k: number }) => ({
      dx: (h.dx * cos - h.dy * sin) * scale,
      dy: (h.dx * sin + h.dy * cos) * scale,
      k: h.k / scale,
    })
    for (const e of entities) {
      const next = structuredClone(e)
      next.id = id('e')
      switch (next.kind) {
        case 'circle':
          next.c = remap.get(next.c)!
          next.r *= scale
          break
        case 'line':
          next.p1 = remap.get(next.p1)!
          next.p2 = remap.get(next.p2)!
          break
        case 'arc':
          next.p1 = remap.get(next.p1)!
          next.p2 = remap.get(next.p2)!
          next.c = remap.get(next.c)!
          break
        case 'point':
          next.p = remap.get(next.p)!
          break
        case 'text':
          next.p = remap.get(next.p)!
          next.height *= scale
          next.angle += angle * n
          break
        case 'ellipse':
          next.c = remap.get(next.c)!
          next.rx *= scale
          next.ry *= scale
          next.rotation += angle * n
          break
        case 'ellipticalArc':
          next.c = remap.get(next.c)!
          next.p1 = remap.get(next.p1)!
          next.p2 = remap.get(next.p2)!
          next.rx *= scale
          next.ry *= scale
          next.rotation += angle * n
          break
        case 'spline':
          next.points = next.points.map((key) => remap.get(key)!)
          if (next.startHandle) next.startHandle = turnHandle(next.startHandle)
          if (next.endHandle) next.endHandle = turnHandle(next.endHandle)
          break
      }
      s.entities.push(next)
      added.push(next.id)
    }
  }
  return added
}

export function setFixed(s: Sketch2D, selected: string[], fixed: boolean, id: Id) {
  const entities = s.entities.filter((e) => selected.includes(e.id)),
    points = new Set(entities.flatMap(pointIds).filter((id) => id !== 'origin')),
    circles = new Set(entities.filter((e) => e.kind === 'circle').map((e) => e.id)),
    shaped = new Set(entities.map((e) => e.id))
  s.constraints = s.constraints.filter(
    (c) =>
      !(c.kind === 'fix' && points.has(c.p)) &&
      !(c.kind === 'radius' && circles.has(c.e)) &&
      !(c.kind === 'fixShape' && shaped.has(c.e)),
  )
  if (!fixed) return
  for (const p of s.points)
    if (points.has(p.id)) s.constraints.push({ id: id('c'), kind: 'fix', p: p.id, x: p.x, y: p.y })
  for (const e of entities)
    if (e.kind === 'circle')
      s.constraints.push({ id: id('c'), kind: 'radius', e: e.id, value: e.r })
  for (const e of entities) {
    if (e.kind === 'ellipse' || e.kind === 'ellipticalArc') {
      s.constraints.push({
        id: id('c'),
        kind: 'fixShape',
        e: e.id,
        rx: e.rx,
        ry: e.ry,
        rotation: e.rotation,
      })
    } else if (e.kind === 'spline' && (e.startHandle || e.endHandle)) {
      s.constraints.push({
        id: id('c'),
        kind: 'fixShape',
        e: e.id,
        ...(e.startHandle ? { start: { ...e.startHandle } } : {}),
        ...(e.endHandle ? { end: { ...e.endHandle } } : {}),
      })
    }
  }
}

export function isFixed(s: Sketch2D, entityId: string): boolean {
  const e = s.entities.find((x) => x.id === entityId)
  if (!e) return false
  const fixedPoints = new Set(
    s.constraints.filter((c) => c.kind === 'fix').map((c) => (c as { p: string }).p),
  )
  return pointIds(e).every((p) => fixedPoints.has(p))
}

export function deleteGeometry(s: Sketch2D, selected: string[]) {
  const removed = new Set(selected)
  s.entities = s.entities.filter((e) => !removed.has(e.id))
  s.constraints = s.constraints.filter((c) => !constraintRefs(c).some((ref) => removed.has(ref)))
  // Retain points referenced by constraints, including the fixed origin.
  cleanUnusedPoints(s)
}
export function cleanUnusedPoints(s: Sketch2D) {
  const used = new Set([
    'origin',
    ...s.entities.flatMap(pointIds),
    ...s.constraints.flatMap(constraintRefs),
  ])
  s.points = s.points.filter((p) => used.has(p.id))
}

export function geometryLength(s: Sketch2D, selected: string[]): number {
  const points = new Map(s.points.map((p) => [p.id, p]))
  let lookup: ReturnType<typeof pointLookup> | null = null
  let total = 0
  for (const e of s.entities.filter((e) => selected.includes(e.id))) {
    if (e.kind === 'circle') {
      total += 2 * Math.PI * e.r
      continue
    }
    if (e.kind !== 'line' && e.kind !== 'arc') {
      lookup ??= pointLookup(s)
      total += entityLength(e, lookup)
      continue
    }
    const a = points.get(e.p1)!,
      b = points.get(e.p2)!
    if (e.kind === 'line') {
      total += Math.hypot(b.x - a.x, b.y - a.y)
      continue
    }
    const c = points.get(e.c)!,
      start = Math.atan2(a.y - c.y, a.x - c.x),
      end = Math.atan2(b.y - c.y, b.x - c.x)
    const sweep = ((e.ccw ? end - start : start - end) + 2 * Math.PI) % (2 * Math.PI)
    total += sweep * Math.hypot(a.x - c.x, a.y - c.y)
  }
  return total
}
