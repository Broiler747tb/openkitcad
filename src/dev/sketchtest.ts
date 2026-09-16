import { v2, type Vec2 } from '../core/math'
import { closestPoint, curveOf, intersectEntities, pointLookup, tessellate } from '../sketch/curves'
import { applySolve, solveSketch } from '../sketch/solver'
import { emptySketch, type Constraint, type Sketch2D, type SketchEntity } from '../sketch/types'
import type { TestResult } from './selftest'

type Draft = { sketch: Sketch2D; id: (prefix: string) => string }

function draft(): Draft {
  const sketch = emptySketch()
  let n = 0
  return { sketch, id: (prefix) => `${prefix}${++n}` }
}

function point(d: Draft, x: number, y: number): string {
  const id = d.id('p')
  d.sketch.points.push({ id, x, y })
  return id
}

function entity(d: Draft, e: Record<string, unknown>): string {
  const id = d.id('e')
  d.sketch.entities.push({ ...e, id } as SketchEntity)
  return id
}

function constrain(d: Draft, c: Record<string, unknown>): void {
  d.sketch.constraints.push({ ...c, id: d.id('c') } as Constraint)
}

function solved(d: Draft) {
  const result = solveSketch(d.sketch)
  applySolve(d.sketch, result)
  return result
}

function at(d: Draft, id: string): Vec2 {
  const p = d.sketch.points.find((candidate) => candidate.id === id)!
  return [p.x, p.y]
}

function byId(d: Draft, id: string): SketchEntity {
  return d.sketch.entities.find((candidate) => candidate.id === id)!
}

export function runSketchTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Sketch: ${name}`, pass, detail })
  const guard = (name: string, body: () => void) => {
    try {
      body()
    } catch (error) {
      check(name, false, `threw: ${(error as Error).message}`)
    }
  }

  guard('ellipse', () => {
    const d = draft()
    const c = point(d, 3, 2)
    const e = entity(d, { kind: 'ellipse', c, rx: 12, ry: 5, rotation: 20, construction: false })
    constrain(d, { kind: 'coincident', a: c, b: 'origin' })
    constrain(d, { kind: 'radius', e, value: 20, axis: 'major' })
    constrain(d, { kind: 'radius', e, value: 8, axis: 'minor' })
    const a = point(d, -5, 0)
    const b = point(d, 5, 1)
    const axis = entity(d, { kind: 'line', p1: a, p2: b, construction: true })
    constrain(d, { kind: 'horizontal', e: axis })
    constrain(d, { kind: 'ellipseAxis', line: axis, e, axis: 'major' })
    const result = solved(d)
    const ellipse = byId(d, e) as Extract<SketchEntity, { kind: 'ellipse' }>
    const turn = ((ellipse.rotation % 180) + 180) % 180
    check(
      'an ellipse takes its axes, its centre and its rotation from constraints',
      result.ok &&
        Math.abs(ellipse.rx - 20) < 1e-6 &&
        Math.abs(ellipse.ry - 8) < 1e-6 &&
        v2.len(at(d, c)) < 1e-6 &&
        (turn < 1e-4 || Math.abs(turn - 180) < 1e-4),
      `rx ${ellipse.rx.toFixed(4)}, ry ${ellipse.ry.toFixed(4)}, rotation ${ellipse.rotation.toFixed(4)}, residual ${result.residual.toExponential(2)}`,
    )

    const p = point(d, 30, 10)
    constrain(d, { kind: 'pointOnCurve', p, e })
    solved(d)
    const pts = pointLookup(d.sketch)
    const onEllipse = closestPoint(byId(d, e), pts, at(d, p)).distance
    check(
      'a point constrained onto an ellipse lies on it',
      onEllipse < 1e-5,
      `${onEllipse.toExponential(2)} mm away`,
    )

    const t1 = point(d, -30, 12)
    const t2 = point(d, 30, 14)
    const tangent = entity(d, { kind: 'line', p1: t1, p2: t2, construction: false })
    constrain(d, { kind: 'horizontal', e: tangent })
    constrain(d, { kind: 'tangentCurves', a: tangent, b: e })
    const tangentResult = solved(d)
    const y = at(d, t1)[1]
    check(
      'a horizontal line tangent to an upright ellipse touches its top',
      tangentResult.ok && Math.abs(Math.abs(y) - 8) < 1e-4,
      `line at y = ${y.toFixed(5)}, expected ±8`,
    )
  })

  guard('spline', () => {
    const d = draft()
    const ids = (
      [
        [0, 0],
        [10, 8],
        [25, -4],
        [40, 6],
      ] as Vec2[]
    ).map(([x, y]) => point(d, x, y))
    const spline = entity(d, { kind: 'spline', mode: 'fit', points: ids, construction: false })
    for (const [i, id] of ids.entries()) {
      constrain(d, { kind: 'fix', p: id, x: at(d, id)[0], y: at(d, id)[1] })
      void i
    }
    const result = solved(d)
    const pts = pointLookup(d.sketch)
    const curve = curveOf(byId(d, spline), pts)!
    const passes = ids.every((id) => closestPoint(byId(d, spline), pts, at(d, id)).distance < 1e-6)
    check(
      'a fit spline passes through every one of its points',
      result.ok && passes && v2.dist(curve.at(0), at(d, ids[0])) < 1e-9,
      `through all points: ${passes}, dof ${result.dof}`,
    )

    const q = point(d, 18, 9)
    constrain(d, { kind: 'pointOnCurve', p: q, e: spline })
    solved(d)
    const gap = closestPoint(byId(d, spline), pointLookup(d.sketch), at(d, q)).distance
    check(
      'a point constrained onto a spline lies on it',
      gap < 1e-5,
      `${gap.toExponential(2)} mm away`,
    )

    const centre = point(d, 50, 20)
    const end = point(d, 55, 10)
    const arc = entity(d, {
      kind: 'arc',
      c: centre,
      p1: ids[3],
      p2: end,
      ccw: false,
      construction: false,
    })
    constrain(d, { kind: 'smooth', a: spline, aEnd: 'end', b: arc, bEnd: 'start' })
    const smooth = solved(d)
    const after = pointLookup(d.sketch)
    const splineCurve = curveOf(byId(d, spline), after)!
    const arcCurve = curveOf(byId(d, arc), after)!
    const turn = Math.abs(v2.cross(v2.norm(splineCurve.d1(1)), v2.norm(arcCurve.d1(0))))
    check(
      'a smooth join lines a spline end up with the arc it meets',
      smooth.ok && turn < 1e-5 && v2.dist(splineCurve.at(1), arcCurve.at(0)) < 1e-6,
      `tangent mismatch ${turn.toExponential(2)}, residual ${smooth.residual.toExponential(2)}`,
    )
  })

  guard('relations', () => {
    const d = draft()
    const c1 = point(d, 0, 0)
    const c2 = point(d, 3, 4)
    const small = entity(d, { kind: 'circle', c: c1, r: 5, construction: false })
    const big = entity(d, { kind: 'circle', c: c2, r: 9, construction: false })
    constrain(d, { kind: 'concentric', a: small, b: big })
    const a1 = point(d, 0, 20)
    const a2 = point(d, 10, 21)
    const b1 = point(d, 20, 23)
    const b2 = point(d, 30, 26)
    const la = entity(d, { kind: 'line', p1: a1, p2: a2, construction: false })
    const lb = entity(d, { kind: 'line', p1: b1, p2: b2, construction: false })
    constrain(d, { kind: 'collinear', a: la, b: lb })
    const result = solved(d)
    const across = Math.abs(
      v2.cross(v2.norm(v2.sub(at(d, a2), at(d, a1))), v2.sub(at(d, b2), at(d, a1))),
    )
    check(
      'concentric circles share a centre and collinear lines share a line',
      result.ok && v2.dist(at(d, c1), at(d, c2)) < 1e-6 && across < 1e-6,
      `centres ${v2.dist(at(d, c1), at(d, c2)).toExponential(2)} apart, ${across.toExponential(2)} off line`,
    )

    const m1 = point(d, -10, 50)
    const m2 = point(d, -10, 60)
    const mirror = entity(d, { kind: 'line', p1: m1, p2: m2, construction: true })
    constrain(d, { kind: 'vertical', e: mirror })
    const left = point(d, -20, 55)
    const right = point(d, 4, 57)
    const leftCircle = entity(d, { kind: 'circle', c: left, r: 3, construction: false })
    const rightCircle = entity(d, { kind: 'circle', c: right, r: 4, construction: false })
    constrain(d, {
      kind: 'symmetricEntities',
      a: leftCircle,
      b: rightCircle,
      line: mirror,
      flip: false,
    })
    const mirrored = solved(d)
    const lc = at(d, left)
    const rc = at(d, right)
    const axisX = at(d, m1)[0]
    const radii = [leftCircle, rightCircle].map((id) => (byId(d, id) as { r: number }).r)
    check(
      'circles mirrored about a line sit at equal distances with equal radii',
      mirrored.ok &&
        Math.abs(lc[0] + rc[0] - 2 * axisX) < 1e-6 &&
        Math.abs(lc[1] - rc[1]) < 1e-6 &&
        Math.abs(radii[0] - radii[1]) < 1e-6,
      `left ${lc.map((n) => n.toFixed(3))}, right ${rc.map((n) => n.toFixed(3))}, axis x ${axisX.toFixed(3)}, radii ${radii.map((n) => n.toFixed(3))}`,
    )
  })

  guard('settle', () => {
    for (const [label, rule] of [
      ['perpendicular', { kind: 'perpendicular' }],
      ['at 30 degrees', { kind: 'angle', value: 30 }],
      ['parallel', { kind: 'parallel' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const d = draft()
      const a = point(d, 0, 0)
      const b = point(d, 30, 0)
      const c = point(d, 0, 20)
      const e = point(d, 30, 26)
      const base = entity(d, { kind: 'line', p1: a, p2: b, construction: false })
      const turned = entity(d, { kind: 'line', p1: c, p2: e, construction: false })
      constrain(d, { kind: 'horizontal', e: base })
      const before = v2.dist(at(d, c), at(d, e))
      const middle = v2.mid(at(d, c), at(d, e))
      constrain(d, { ...rule, a: base, b: turned })
      const result = solved(d)
      const after = v2.dist(at(d, c), at(d, e))
      const drift = v2.dist(v2.mid(at(d, c), at(d, e)), middle)
      check(
        `making a line ${label} turns it without changing its length`,
        result.ok && Math.abs(after - before) < 0.05 && drift < 1,
        `${before.toFixed(3)} mm before, ${after.toFixed(3)} mm after, middle moved ${drift.toFixed(3)} mm, ${result.iterations} iterations`,
      )
    }
  })

  guard('curves', () => {
    const d = draft()
    const c = point(d, 0, 0)
    const e = entity(d, { kind: 'ellipse', c, rx: 10, ry: 5, rotation: 0, construction: false })
    const a = point(d, -20, 0)
    const b = point(d, 20, 0)
    const line = entity(d, { kind: 'line', p1: a, p2: b, construction: false })
    const pts = pointLookup(d.sketch)
    const crossings = intersectEntities(byId(d, line), byId(d, e), pts)
      .map((crossing) => crossing.point[0])
      .sort((x, y) => x - y)
    check(
      'a line through an ellipse crosses it at both ends of the major axis',
      crossings.length === 2 &&
        Math.abs(crossings[0] + 10) < 1e-6 &&
        Math.abs(crossings[1] - 10) < 1e-6,
      crossings.map((x) => x.toFixed(6)).join(', '),
    )
    const polyline = tessellate(byId(d, e), pts, 0.01)
    const worst = Math.max(...polyline.map((p) => Math.abs((p[0] / 10) ** 2 + (p[1] / 5) ** 2 - 1)))
    check(
      'an ellipse tessellates onto itself',
      polyline.length > 16 &&
        worst < 1e-9 &&
        v2.dist(polyline[0], polyline[polyline.length - 1]) < 1e-9,
      `${polyline.length} points, worst ${worst.toExponential(2)}`,
    )
  })

  return results
}
