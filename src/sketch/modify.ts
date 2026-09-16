import { v2, type Vec2 } from '../core/math'
import { subBSpline } from './bspline'
import {
  closestPoint,
  curveOf,
  entityEnds,
  intersectEntities,
  isCurveEntity,
  pointLookup,
  sketchBounds,
  splineGeometry,
  type PointLookup,
} from './curves'
import { cleanUnusedPoints, constraintRefs } from './power'
import type { Constraint, NewConstraint, Sketch2D, SketchEntity } from './types'

export interface ModifyResult {
  ok: boolean
  message?: string
}

type Ids = (prefix: string) => string

interface Cut {
  s: number
  entityId: string | null
  pointId: string | null
}

interface Piece {
  from: number
  to: number
  start: Cut | null
  end: Cut | null
}

const CLOSED = new Set(['circle', 'ellipse'])

function scaleOf(sketch: Sketch2D): number {
  const bounds = sketchBounds(sketch)
  return bounds
    ? Math.max(Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]), 1)
    : 1
}

function cutsOn(sketch: Sketch2D, entity: SketchEntity, pts: PointLookup): Cut[] {
  const tolerance = scaleOf(sketch) * 1e-7
  const closed = CLOSED.has(entity.kind)
  const cuts: Cut[] = []
  for (const other of sketch.entities) {
    if (other.id === entity.id) continue
    if (other.kind === 'point') {
      const p = pts.get(other.p)
      const hit = p ? closestPoint(entity, pts, p) : null
      if (hit && hit.distance <= tolerance)
        cuts.push({ s: hit.s, entityId: null, pointId: other.p })
      continue
    }
    if (!isCurveEntity(other)) continue
    for (const id of entityEnds(other) ?? []) {
      const p = pts.get(id)
      if (!p) continue
      const hit = closestPoint(entity, pts, p)
      if (hit.distance <= tolerance) cuts.push({ s: hit.s, entityId: null, pointId: id })
    }
    for (const crossing of intersectEntities(entity, other, pts)) {
      cuts.push({ s: crossing.sa, entityId: other.id, pointId: null })
    }
  }
  const curve = curveOf(entity, pts)!
  const unique: Cut[] = []
  for (const cut of cuts.map((c) => ({ ...c, s: closed ? ((c.s % 1) + 1) % 1 : c.s }))) {
    const same = unique.find((u) => v2.dist(curve.at(u.s), curve.at(cut.s)) <= tolerance * 10)
    if (!same) unique.push(cut)
    else if (cut.pointId && !same.pointId) Object.assign(same, cut)
  }
  return unique
    .filter((cut) => closed || (cut.s > 1e-9 && cut.s < 1 - 1e-9))
    .sort((a, b) => a.s - b.s)
}

function endpointIds(entity: SketchEntity): [string | null, string | null] {
  const ends = entityEnds(entity)
  return ends ? [ends[0], ends[1]] : [null, null]
}

function onConstraint(sketch: Sketch2D, point: string, entityId: string): NewConstraint | null {
  const other = sketch.entities.find((e) => e.id === entityId)
  if (!other) return null
  if (other.kind === 'line') return { kind: 'pointOnLine', p: point, e: other.id }
  if (other.kind === 'circle' || other.kind === 'arc') {
    return { kind: 'pointOnCircle', p: point, e: other.id }
  }
  return { kind: 'pointOnCurve', p: point, e: other.id }
}

function buildPieces(
  sketch: Sketch2D,
  entity: SketchEntity,
  pieces: Piece[],
  ids: Ids,
  pts: PointLookup,
): string[] {
  const curve = curveOf(entity, pts)!
  const closed = CLOSED.has(entity.kind)
  const [first, last] = endpointIds(entity)
  const add = (c: NewConstraint) => sketch.constraints.push({ ...c, id: ids('c') } as Constraint)
  const made = new Map<string, string>()
  const pointAt = (s: number, cut: Cut | null): string => {
    if (!closed && s <= 1e-12 && first) return first
    if (!closed && s >= 1 - 1e-12 && last) return last
    if (cut?.pointId) return cut.pointId
    const key = `${Math.round((((s % 1) + 1) % 1) * 1e9)}`
    const existing = made.get(key)
    if (existing) return existing
    const [x, y] = curve.at(s)
    const id = ids('p')
    sketch.points.push({ id, x, y })
    made.set(key, id)
    if (cut?.entityId) {
      const constraint = onConstraint(sketch, id, cut.entityId)
      if (constraint) add(constraint)
    }
    return id
  }

  const created: SketchEntity[] = pieces.map((piece, index) => {
    const id = index === 0 ? entity.id : ids('e')
    const p1 = pointAt(piece.from, piece.start)
    const p2 = pointAt(piece.to, piece.end)
    switch (entity.kind) {
      case 'line':
        return { ...entity, id, p1, p2 }
      case 'arc':
        return { ...entity, id, p1, p2 }
      case 'circle':
        return {
          id,
          kind: 'arc',
          c: entity.c,
          p1,
          p2,
          ccw: true,
          construction: entity.construction,
        }
      case 'ellipse':
        return {
          id,
          kind: 'ellipticalArc',
          c: entity.c,
          rx: entity.rx,
          ry: entity.ry,
          rotation: entity.rotation,
          p1,
          p2,
          ccw: true,
          construction: entity.construction,
        }
      case 'ellipticalArc':
        return { ...entity, id, p1, p2 }
      case 'spline': {
        const g = splineGeometry(entity, pts)
        const lo = g.knots[g.degree]
        const hi = g.knots[g.ctrl.length]
        const part = subBSpline(g, lo + (hi - lo) * piece.from, lo + (hi - lo) * piece.to)
        const points = part.ctrl.map((p, k) => {
          if (k === 0) return p1
          if (k === part.ctrl.length - 1) return p2
          const pid = ids('p')
          sketch.points.push({ id: pid, x: p[0], y: p[1] })
          return pid
        })
        return {
          id,
          kind: 'spline',
          mode: 'control',
          points,
          knots: part.knots,
          construction: entity.construction,
        }
      }
      default:
        return entity
    }
  })

  sketch.entities = sketch.entities.flatMap((e) => (e.id === entity.id ? created : [e]))
  for (let i = 1; i < created.length; i++) {
    const piece = created[i]
    if (piece.kind === 'line') add({ kind: 'collinear', a: created[0].id, b: piece.id })
    if (piece.kind === 'arc') add({ kind: 'equal', a: created[0].id, b: piece.id })
  }
  if (entity.kind === 'spline') {
    sketch.constraints = sketch.constraints.filter(
      (c) => !(c.kind === 'fixShape' && c.e === entity.id),
    )
  }
  return created.map((e) => e.id)
}

function removeOrphans(sketch: Sketch2D) {
  const used = new Set(['origin'])
  for (const e of sketch.entities) {
    for (const id of e.kind === 'spline' ? e.points : Object.values(e)) {
      if (typeof id === 'string') used.add(id)
    }
  }
  const entityIds = new Set(sketch.entities.map((e) => e.id))
  const pointIds = new Set(sketch.points.map((p) => p.id))
  sketch.constraints = sketch.constraints.filter((c) =>
    constraintRefs(c).every((ref) =>
      pointIds.has(ref) ? used.has(ref) || c.kind === 'fix' : entityIds.has(ref),
    ),
  )
  sketch.constraints = sketch.constraints.filter(
    (c) => !(c.kind === 'fix' && c.p !== 'origin' && !used.has(c.p)),
  )
  cleanUnusedPoints(sketch)
}

function deleteEntity(sketch: Sketch2D, id: string) {
  sketch.entities = sketch.entities.filter((e) => e.id !== id)
  removeOrphans(sketch)
}

function locate(sketch: Sketch2D, entityId: string, at: Vec2) {
  const entity = sketch.entities.find((e) => e.id === entityId)
  if (!entity || !isCurveEntity(entity)) return null
  const pts = pointLookup(sketch)
  if (!curveOf(entity, pts)) return null
  return { entity, pts, s: closestPoint(entity, pts, at).s }
}

function bracket(cuts: Cut[], s: number, closed: boolean) {
  if (closed) {
    for (let i = 0; i < cuts.length; i++) {
      const lo = cuts[i]
      const hi = cuts[(i + 1) % cuts.length]
      const span = i + 1 < cuts.length ? hi.s - lo.s : hi.s + 1 - lo.s
      const offset = (((s - lo.s) % 1) + 1) % 1
      if (offset <= span + 1e-12) return { lo, hi, loS: lo.s, hiS: lo.s + span }
    }
    return { lo: cuts[0], hi: cuts[0], loS: cuts[0].s, hiS: cuts[0].s + 1 }
  }
  let lo: Cut | null = null
  let hi: Cut | null = null
  for (const cut of cuts) {
    if (cut.s <= s) lo = cut
    else if (!hi) hi = cut
  }
  return { lo, hi, loS: lo?.s ?? 0, hiS: hi?.s ?? 1 }
}

export function trimEntity(sketch: Sketch2D, entityId: string, at: Vec2, ids: Ids): ModifyResult {
  const found = locate(sketch, entityId, at)
  if (!found)
    return { ok: false, message: 'Trim works on lines, arcs, circles, ellipses and splines.' }
  const { entity, pts, s } = found
  const closed = CLOSED.has(entity.kind)
  const cuts = cutsOn(sketch, entity, pts)
  if (!cuts.length || (closed && cuts.length < 2)) {
    deleteEntity(sketch, entity.id)
    return { ok: true }
  }
  const { lo, hi, loS, hiS } = bracket(cuts, s, closed)
  const pieces: Piece[] = closed
    ? [{ from: hiS, to: loS + 1 > hiS ? loS + 1 : loS + 2, start: hi as Cut, end: lo as Cut }]
    : [
        ...(lo ? [{ from: 0, to: loS, start: null, end: lo }] : []),
        ...(hi ? [{ from: hiS, to: 1, start: hi, end: null }] : []),
      ]
  if (!pieces.length) {
    deleteEntity(sketch, entity.id)
    return { ok: true }
  }
  buildPieces(sketch, entity, pieces, ids, pts)
  removeOrphans(sketch)
  return { ok: true }
}

export function breakEntity(sketch: Sketch2D, entityId: string, at: Vec2, ids: Ids): ModifyResult {
  const found = locate(sketch, entityId, at)
  if (!found)
    return { ok: false, message: 'Break works on lines, arcs, circles, ellipses and splines.' }
  const { entity, pts, s } = found
  const closed = CLOSED.has(entity.kind)
  const cuts = cutsOn(sketch, entity, pts)
  if (closed ? cuts.length < 2 : !cuts.length) {
    return { ok: false, message: 'Nothing crosses that curve where it could break.' }
  }
  const { lo, hi, loS, hiS } = bracket(cuts, s, closed)
  const pieces: Piece[] = closed
    ? [
        { from: loS, to: hiS, start: lo as Cut, end: hi as Cut },
        { from: hiS, to: loS + 1 > hiS ? loS + 1 : loS + 2, start: hi as Cut, end: lo as Cut },
      ]
    : [
        ...(lo ? [{ from: 0, to: loS, start: null, end: lo }] : []),
        { from: loS, to: hiS, start: lo, end: hi },
        ...(hi ? [{ from: hiS, to: 1, start: hi, end: null }] : []),
      ]
  buildPieces(sketch, entity, pieces, ids, pts)
  removeOrphans(sketch)
  return { ok: true }
}

export function extendEntity(sketch: Sketch2D, entityId: string, at: Vec2, ids: Ids): ModifyResult {
  const entity = sketch.entities.find((e) => e.id === entityId)
  if (!entity || (entity.kind !== 'line' && entity.kind !== 'arc')) {
    return { ok: false, message: 'Extend works on lines and arcs.' }
  }
  const pts = pointLookup(sketch)
  const p1 = pts.get(entity.p1)!
  const p2 = pts.get(entity.p2)!
  const atEnd = v2.dist(at, p2) < v2.dist(at, p1)
  const endId = atEnd ? entity.p2 : entity.p1
  const reach = scaleOf(sketch) * 10 + 100
  const probe: Sketch2D = structuredClone(sketch)
  const probePts = (extra: Array<[string, Vec2]>) => {
    const map = pointLookup(probe)
    for (const [id, p] of extra) map.set(id, p)
    return map
  }
  let best: { s: number; point: Vec2; by: string } | null = null
  if (entity.kind === 'line') {
    const from = atEnd ? p2 : p1
    const dir = v2.norm(v2.sub(from, atEnd ? p1 : p2))
    const ray: SketchEntity = { id: '~ray', kind: 'line', p1: '~a', p2: '~b', construction: true }
    const map = probePts([
      ['~a', from],
      ['~b', v2.add(from, v2.scale(dir, reach))],
    ])
    for (const other of sketch.entities) {
      if (other.id === entity.id || !isCurveEntity(other)) continue
      for (const crossing of intersectEntities(ray, other, map)) {
        if (crossing.sa * reach < 1e-6) continue
        if (!best || crossing.sa < best.s)
          best = { s: crossing.sa, point: crossing.point, by: other.id }
      }
    }
  } else {
    const centre = pts.get(entity.c)!
    const radius = v2.dist(centre, p1)
    const ring: SketchEntity = {
      id: '~ring',
      kind: 'circle',
      c: entity.c,
      r: radius,
      construction: true,
    }
    const a1 = Math.atan2(p1[1] - centre[1], p1[0] - centre[0])
    const a2 = Math.atan2(p2[1] - centre[1], p2[0] - centre[0])
    const tau = Math.PI * 2
    const wrap = (x: number) => ((x % tau) + tau) % tau
    const sweep = entity.ccw ? wrap(a2 - a1) : wrap(a1 - a2)
    for (const other of sketch.entities) {
      if (other.id === entity.id || !isCurveEntity(other)) continue
      for (const crossing of intersectEntities(ring, other, pts)) {
        const angle = Math.atan2(crossing.point[1] - centre[1], crossing.point[0] - centre[0])
        const beyond = atEnd
          ? entity.ccw
            ? wrap(angle - a2)
            : wrap(a2 - angle)
          : entity.ccw
            ? wrap(a1 - angle)
            : wrap(angle - a1)
        if (beyond < 1e-9 || beyond > tau - sweep - 1e-9) continue
        if (!best || beyond < best.s) best = { s: beyond, point: crossing.point, by: other.id }
      }
    }
  }
  if (!best) return { ok: false, message: 'There is nothing ahead for that end to reach.' }
  const shared = sketch.entities.some((e) => e.id !== entity.id && Object.values(e).includes(endId))
  let target = endId
  if (shared) {
    target = ids('p')
    sketch.points.push({ id: target, x: best.point[0], y: best.point[1] })
    if (atEnd) (entity as { p2: string }).p2 = target
    else (entity as { p1: string }).p1 = target
  } else {
    const point = sketch.points.find((p) => p.id === endId)!
    point.x = best.point[0]
    point.y = best.point[1]
    sketch.constraints = sketch.constraints.filter((c) => !(c.kind === 'fix' && c.p === endId))
  }
  const constraint = onConstraint(sketch, target, best.by)
  if (constraint) sketch.constraints.push({ ...constraint, id: ids('c') } as Constraint)
  removeOrphans(sketch)
  return { ok: true }
}

function reflectAcross(a: Vec2, b: Vec2) {
  const d = v2.norm(v2.sub(b, a))
  return (p: Vec2): Vec2 => {
    const w = v2.sub(p, a)
    const along = v2.scale(d, v2.dot(w, d))
    const across = v2.sub(w, along)
    return v2.add(a, v2.sub(along, across))
  }
}

export function mirrorAbout(
  sketch: Sketch2D,
  entityIds: readonly string[],
  lineId: string,
  ids: Ids,
): ModifyResult {
  const line = sketch.entities.find((e) => e.id === lineId)
  if (line?.kind !== 'line') return { ok: false, message: 'Pick a line to mirror about.' }
  const chosen = sketch.entities.filter((e) => entityIds.includes(e.id) && e.id !== lineId)
  if (!chosen.length) return { ok: false, message: 'Select the geometry to mirror first.' }
  const pts = pointLookup(sketch)
  const a = pts.get(line.p1)!
  const b = pts.get(line.p2)!
  const reflect = reflectAcross(a, b)
  const tolerance = scaleOf(sketch) * 1e-9
  const lineDir = v2.norm(v2.sub(b, a))
  const onLine = (p: Vec2) => Math.abs(v2.cross(v2.sub(p, a), lineDir)) <= tolerance
  const angleOf = (degrees: number) => {
    const t = (degrees * Math.PI) / 180
    const tip = reflect(v2.add(a, [Math.cos(t), Math.sin(t)]))
    const base = reflect(a)
    return (Math.atan2(tip[1] - base[1], tip[0] - base[0]) * 180) / Math.PI
  }
  const map = new Map<string, string>()
  const copyPoint = (id: string): string => {
    const existing = map.get(id)
    if (existing) return existing
    const p = pts.get(id)!
    if (onLine(p)) {
      map.set(id, id)
      return id
    }
    const q = reflect(p)
    const next = ids('p')
    sketch.points.push({ id: next, x: q[0], y: q[1] })
    map.set(id, next)
    return next
  }
  const add = (c: NewConstraint) => sketch.constraints.push({ ...c, id: ids('c') } as Constraint)
  for (const entity of chosen) {
    const id = ids('e')
    let copy: SketchEntity
    switch (entity.kind) {
      case 'line':
        copy = { ...entity, id, p1: copyPoint(entity.p1), p2: copyPoint(entity.p2) }
        break
      case 'circle':
        copy = { ...entity, id, c: copyPoint(entity.c) }
        break
      case 'arc':
        copy = {
          ...entity,
          id,
          c: copyPoint(entity.c),
          p1: copyPoint(entity.p1),
          p2: copyPoint(entity.p2),
          ccw: !entity.ccw,
        }
        break
      case 'point':
        copy = { ...entity, id, p: copyPoint(entity.p) }
        break
      case 'text':
        copy = { ...entity, id, p: copyPoint(entity.p), angle: angleOf(entity.angle) }
        break
      case 'ellipse':
        copy = { ...entity, id, c: copyPoint(entity.c), rotation: angleOf(entity.rotation) }
        break
      case 'ellipticalArc':
        copy = {
          ...entity,
          id,
          c: copyPoint(entity.c),
          p1: copyPoint(entity.p1),
          p2: copyPoint(entity.p2),
          rotation: angleOf(entity.rotation),
          ccw: !entity.ccw,
        }
        break
      case 'spline':
        copy = {
          ...entity,
          id,
          points: entity.points.map(copyPoint),
          startHandle: entity.startHandle && {
            ...entity.startHandle,
            ...(() => {
              const tip = reflect(v2.add(a, [entity.startHandle!.dx, entity.startHandle!.dy]))
              const base = reflect(a)
              return { dx: tip[0] - base[0], dy: tip[1] - base[1], k: -entity.startHandle!.k }
            })(),
          },
          endHandle: entity.endHandle && {
            ...entity.endHandle,
            ...(() => {
              const tip = reflect(v2.add(a, [entity.endHandle!.dx, entity.endHandle!.dy]))
              const base = reflect(a)
              return { dx: tip[0] - base[0], dy: tip[1] - base[1], k: -entity.endHandle!.k }
            })(),
          },
        }
        break
    }
    sketch.entities.push(copy)
    if (copy.kind === 'spline') {
      for (const [from, to] of map) {
        if (from !== to && entity.kind === 'spline' && entity.points.includes(from)) {
          add({ kind: 'symmetric', a: from, b: to, line: lineId })
        }
      }
    } else {
      add({ kind: 'symmetricEntities', a: entity.id, b: copy.id, line: lineId, flip: false })
    }
  }
  return { ok: true }
}

export function scaleEntities(
  sketch: Sketch2D,
  entityIds: readonly string[],
  centre: Vec2,
  factor: number,
): ModifyResult {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    return { ok: false, message: 'The scale factor has to be more than zero.' }
  }
  const chosen = sketch.entities.filter((e) => entityIds.includes(e.id))
  if (!chosen.length) return { ok: false, message: 'Select the geometry to scale first.' }
  const moved = new Set<string>()
  for (const e of chosen) {
    for (const value of e.kind === 'spline' ? e.points : Object.values(e)) {
      if (typeof value === 'string' && sketch.points.some((p) => p.id === value)) moved.add(value)
    }
  }
  moved.delete('origin')
  for (const p of sketch.points) {
    if (!moved.has(p.id)) continue
    p.x = centre[0] + (p.x - centre[0]) * factor
    p.y = centre[1] + (p.y - centre[1]) * factor
  }
  const scaled = new Set(chosen.map((e) => e.id))
  for (const e of chosen) {
    if (e.kind === 'circle') e.r *= factor
    if (e.kind === 'ellipse' || e.kind === 'ellipticalArc') {
      e.rx *= factor
      e.ry *= factor
    }
    if (e.kind === 'text') e.height *= factor
  }
  for (const c of sketch.constraints) {
    if (
      (c.kind === 'distance' || c.kind === 'distanceX' || c.kind === 'distanceY') &&
      moved.has(c.a) &&
      moved.has(c.b)
    ) {
      c.value *= factor
    } else if ((c.kind === 'radius' || c.kind === 'diameter') && scaled.has(c.e)) {
      c.value *= factor
    } else if (c.kind === 'fix' && moved.has(c.p)) {
      const p = sketch.points.find((q) => q.id === c.p)!
      c.x = p.x
      c.y = p.y
    }
  }
  return { ok: true }
}

export function moveEntities(
  sketch: Sketch2D,
  entityIds: readonly string[],
  offset: Vec2,
  angle: number,
  centre: Vec2,
): ModifyResult {
  const chosen = sketch.entities.filter((e) => entityIds.includes(e.id))
  if (!chosen.length) return { ok: false, message: 'Select the geometry to move first.' }
  const moved = new Set<string>()
  for (const e of chosen) {
    for (const value of e.kind === 'spline' ? e.points : Object.values(e)) {
      if (typeof value === 'string' && sketch.points.some((p) => p.id === value)) moved.add(value)
    }
  }
  moved.delete('origin')
  const t = (angle * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  for (const p of sketch.points) {
    if (!moved.has(p.id)) continue
    const x = p.x - centre[0]
    const y = p.y - centre[1]
    p.x = centre[0] + x * cos - y * sin + offset[0]
    p.y = centre[1] + x * sin + y * cos + offset[1]
  }
  for (const e of chosen) {
    if (e.kind === 'ellipse' || e.kind === 'ellipticalArc' || e.kind === 'text') {
      if ('rotation' in e) e.rotation += angle
      else e.angle += angle
    }
  }
  for (const c of sketch.constraints) {
    if (c.kind === 'fix' && moved.has(c.p)) {
      const p = sketch.points.find((q) => q.id === c.p)!
      c.x = p.x
      c.y = p.y
    }
  }
  return { ok: true }
}
