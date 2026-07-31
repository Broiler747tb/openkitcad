/**
 * In-app self test, reachable at `?selftest`.
 *
 * The solver and the profile builder are pure functions with exact expected
 * answers, so they are worth checking on every change. Shipping this in the app
 * (rather than as a dev-only script) also means a contributor on any platform,
 * and anyone filing a bug report, can run it without a toolchain.
 */
import {
  emptySketch,
  type Constraint,
  type NewConstraint,
  type Sketch2D,
  type SketchEntity,
  type SketchPoint,
} from '../sketch/types'
import { applySolve, solveSketch } from '../sketch/solver'
import { chamferCorner, filletCorner } from '../sketch/corner'
import { circularPattern, linearPattern, trimLine } from '../sketch/edit'

export interface TestResult {
  name: string
  pass: boolean
  detail: string
}

const results: TestResult[] = []
let currentName = ''

function check(pass: boolean, detail: string) {
  results.push({ name: currentName, pass, detail })
}
function near(actual: number, expected: number, label: string, eps = 1e-4) {
  const ok = Math.abs(actual - expected) < eps
  check(ok, `${label}: ${actual.toFixed(5)} ${ok ? '==' : '!='} ${expected}`)
}
function test(name: string, fn: () => void) {
  currentName = name
  try {
    fn()
  } catch (e) {
    check(false, `threw: ${(e as Error).message}`)
  }
}

// --- sketch construction helpers ------------------------------------------

let uid = 0
const nid = (p: string) => `${p}${uid++}`

function builder() {
  const s: Sketch2D = emptySketch()
  return {
    sketch: s,
    point(x: number, y: number): string {
      const p: SketchPoint = { id: nid('p'), x, y }
      s.points.push(p)
      return p.id
    },
    line(p1: string, p2: string): string {
      const e: SketchEntity = {
        id: nid('e'),
        kind: 'line',
        p1,
        p2,
        construction: false,
      }
      s.entities.push(e)
      return e.id
    },
    circle(c: string, r: number): string {
      const e: SketchEntity = { id: nid('e'), kind: 'circle', c, r, construction: false }
      s.entities.push(e)
      return e.id
    },
    con(c: NewConstraint): string {
      const id = nid('c')
      s.constraints.push({ ...c, id } as Constraint)
      return id
    },
  }
}

// --- tests -----------------------------------------------------------------

export function runSelfTest(): TestResult[] {
  results.length = 0
  uid = 0

  test('rectangle solves to exact dimensions and is fully defined', () => {
    const b = builder()
    // Start deliberately crooked so the solver has real work to do.
    const a = b.point(1, 1)
    const p2 = b.point(39, 2)
    const p3 = b.point(41, 29)
    const p4 = b.point(-1, 31)
    const bottom = b.line(a, p2)
    const right = b.line(p2, p3)
    const top = b.line(p3, p4)
    const left = b.line(p4, a)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: bottom })
    b.con({ kind: 'horizontal', e: top })
    b.con({ kind: 'vertical', e: right })
    b.con({ kind: 'vertical', e: left })
    b.con({ kind: 'distanceX', a, b: p2, value: 40 })
    b.con({ kind: 'distanceY', a, b: p4, value: 30 })

    const r = solveSketch(b.sketch)
    check(r.ok, `solved ok (residual ${r.residual.toExponential(2)})`)
    near(r.points[a].x, 0, 'corner A x')
    near(r.points[a].y, 0, 'corner A y')
    near(r.points[p2].x, 40, 'corner B x')
    near(r.points[p2].y, 0, 'corner B y')
    near(r.points[p3].x, 40, 'corner C x')
    near(r.points[p3].y, 30, 'corner C y')
    near(r.points[p4].x, 0, 'corner D x')
    near(r.points[p4].y, 30, 'corner D y')
    check(r.dof === 0, `degrees of freedom ${r.dof} (expected 0)`)
  })

  test('undimensioned rectangle reports its remaining freedom', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(39, 2)
    const p3 = b.point(41, 29)
    const p4 = b.point(-1, 31)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: b.line(a, p2) })
    b.con({ kind: 'horizontal', e: b.line(p3, p4) })
    b.con({ kind: 'vertical', e: b.line(p2, p3) })
    b.con({ kind: 'vertical', e: b.line(p4, a) })
    const r = solveSketch(b.sketch)
    // Width and height remain free: exactly two degrees of freedom.
    check(r.dof === 2, `degrees of freedom ${r.dof} (expected 2)`)
  })

  test('distance constraint sets true length', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(10, 10)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.line(a, p2)
    b.con({ kind: 'distance', a, b: p2, value: 50 })
    const r = solveSketch(b.sketch)
    const d = Math.hypot(r.points[p2].x, r.points[p2].y)
    near(d, 50, 'line length')
  })

  test('perpendicular makes a true right angle', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(30, 4)
    const p3 = b.point(2, 25)
    b.con({ kind: 'coincident', a, b: 'origin' })
    const l1 = b.line(a, p2)
    const l2 = b.line(a, p3)
    b.con({ kind: 'horizontal', e: l1 })
    b.con({ kind: 'perpendicular', a: l1, b: l2 })
    const r = solveSketch(b.sketch)
    const u = [r.points[p2].x - r.points[a].x, r.points[p2].y - r.points[a].y]
    const v = [r.points[p3].x - r.points[a].x, r.points[p3].y - r.points[a].y]
    const dot = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))
    near(dot, 0, 'normalised dot product', 1e-6)
  })

  test('angle constraint holds 30 degrees', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(30, 25)
    b.con({ kind: 'coincident', a, b: 'origin' })
    const l1 = b.line(a, p2)
    const l2 = b.line(a, p3)
    b.con({ kind: 'horizontal', e: l1 })
    b.con({ kind: 'angle', a: l1, b: l2, value: 30 })
    const r = solveSketch(b.sketch)
    const v = [r.points[p3].x, r.points[p3].y]
    const deg = (Math.atan2(v[1], v[0]) * 180) / Math.PI
    near(Math.abs(deg), 30, 'measured angle', 1e-3)
  })

  test('circle radius is honoured', () => {
    const b = builder()
    const c = b.point(12, 7)
    const circ = b.circle(c, 3)
    b.con({ kind: 'radius', e: circ, value: 12.5 })
    const r = solveSketch(b.sketch)
    near(r.radii[circ], 12.5, 'radius')
  })

  test('tangency places a circle exactly one radius off a line', () => {
    const b = builder()
    const lp1 = b.point(0, 0)
    const lp2 = b.point(100, 3)
    const c = b.point(50, 25)
    b.con({ kind: 'coincident', a: lp1, b: 'origin' })
    const line = b.line(lp1, lp2)
    const circ = b.circle(c, 10)
    b.con({ kind: 'horizontal', e: line })
    b.con({ kind: 'distanceX', a: lp1, b: lp2, value: 100 })
    b.con({ kind: 'radius', e: circ, value: 10 })
    b.con({ kind: 'tangent', line, circle: circ, side: -1 })
    const r = solveSketch(b.sketch)
    near(r.points[c].y, 10, 'centre height above the line', 1e-4)
    near(r.radii[circ], 10, 'radius unchanged')
    // The centre may still slide along the line: exactly one free direction.
    check(r.dof === 1, `degrees of freedom ${r.dof} (expected 1)`)
  })

  test('equal makes two lines the same length', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(0, 10)
    const p4 = b.point(0, 40)
    b.con({ kind: 'coincident', a, b: 'origin' })
    const l1 = b.line(a, p2)
    const l2 = b.line(p3, p4)
    b.con({ kind: 'horizontal', e: l1 })
    b.con({ kind: 'vertical', e: l2 })
    b.con({ kind: 'distance', a, b: p2, value: 25 })
    b.con({ kind: 'equal', a: l1, b: l2 })
    const r = solveSketch(b.sketch)
    const len2 = Math.hypot(
      r.points[p4].x - r.points[p3].x,
      r.points[p4].y - r.points[p3].y,
    )
    near(len2, 25, 'second line length')
  })

  test('dragging a corner keeps the rectangle rectangular', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(40, 30)
    const p4 = b.point(0, 30)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: b.line(a, p2) })
    b.con({ kind: 'horizontal', e: b.line(p3, p4) })
    b.con({ kind: 'vertical', e: b.line(p2, p3) })
    b.con({ kind: 'vertical', e: b.line(p4, a) })

    const r = solveSketch(b.sketch, { drag: { point: p2, x: 62, y: 9 } })
    // The dragged corner tracks the cursor in x, where nothing constrains it,
    // and is overruled in y, where horizontality does. Drag is a soft term, so
    // constrained directions bend by a sub-micron amount during the gesture -
    // well below any tolerance that could ever be manufactured.
    const SUB_MICRON = 2e-3
    near(r.points[a].x, 0, 'anchor corner stays pinned in x', SUB_MICRON)
    near(r.points[a].y, 0, 'anchor corner stays pinned in y', SUB_MICRON)
    near(r.points[p2].x, 62, 'dragged corner x follows cursor', 0.01)
    near(r.points[p2].y, r.points[a].y, 'bottom edge still horizontal', SUB_MICRON)
    near(r.points[p3].x, r.points[p2].x, 'right edge still vertical', SUB_MICRON)
    near(r.points[p4].x, r.points[a].x, 'left edge still vertical', SUB_MICRON)

    // Releasing the mouse re-solves without the drag term, which must restore
    // exact constraint satisfaction. This is what makes the soft drag safe.
    applySolve(b.sketch, r)
    const settled = solveSketch(b.sketch)
    near(settled.points[a].x, 0, 'after release, anchor is exact')
    near(settled.points[a].y, 0, 'after release, anchor is exact')
    near(
      settled.points[p2].y,
      settled.points[a].y,
      'after release, bottom edge is exactly horizontal',
    )
    near(
      settled.points[p3].x,
      settled.points[p2].x,
      'after release, right edge is exactly vertical',
    )
  })

  test('the solver says which geometry is still loose, not just how much', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(40, 30)
    const p4 = b.point(0, 30)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: b.line(a, p2) })
    b.con({ kind: 'horizontal', e: b.line(p3, p4) })
    b.con({ kind: 'vertical', e: b.line(p2, p3) })
    b.con({ kind: 'vertical', e: b.line(p4, a) })

    const r = solveSketch(b.sketch)
    check(r.dof === 2, `two degrees of freedom (got ${r.dof})`)
    // The pinned corner and the origin are nailed down; the other three
    // corners all still move, because width and height are unset.
    check(!r.freePoints.includes('origin'), 'origin is not listed as loose')
    check(!r.freePoints.includes(a), 'the anchored corner is not listed as loose')
    check(
      [p2, p3, p4].every((id) => r.freePoints.includes(id)),
      `the other three corners are listed as loose (${r.freePoints.length} loose in total)`,
    )

    // Dimension it and nothing should be loose any more.
    b.con({ kind: 'distanceX', a, b: p2, value: 40 })
    b.con({ kind: 'distanceY', a, b: p4, value: 30 })
    const r2 = solveSketch(b.sketch)
    check(
      r2.dof === 0 && r2.freePoints.length === 0,
      `once dimensioned nothing is loose (dof ${r2.dof}, ${r2.freePoints.length} loose)`,
    )
  })

  test('rounding a corner keeps the sketch just as defined as it was', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(40, 30)
    const p4 = b.point(0, 30)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: b.line(a, p2) })
    b.con({ kind: 'horizontal', e: b.line(p3, p4) })
    b.con({ kind: 'vertical', e: b.line(p2, p3) })
    b.con({ kind: 'vertical', e: b.line(p4, a) })
    b.con({ kind: 'distanceX', a, b: p2, value: 40 })
    b.con({ kind: 'distanceY', a, b: p4, value: 30 })
    applySolve(b.sketch, solveSketch(b.sketch))
    check(solveSketch(b.sketch).dof === 0, 'rectangle starts fully defined')

    const result = filletCorner(b.sketch, p3, 6, nid)
    check(result.ok, `fillet applied (${result.message ?? 'no error'})`)

    const solved = solveSketch(b.sketch)
    applySolve(b.sketch, solved)
    // A fillet adds three points and an arc but also three constraints and the
    // arc's own implicit row, so it must come out exactly even.
    check(solved.dof === 0, `still fully defined after rounding (dof ${solved.dof})`)
    check(solved.ok, `solves cleanly (${solved.failing.join(',') || 'no conflicts'})`)

    const arc = b.sketch.entities.find((e) => e.kind === 'arc') as any
    check(!!arc, 'an arc was created')
    const P = Object.fromEntries(b.sketch.points.map((p) => [p.id, p]))
    const c = P[arc.c]
    near(Math.hypot(P[arc.p1].x - c.x, P[arc.p1].y - c.y), 6, 'arc radius at one end', 1e-3)
    near(Math.hypot(P[arc.p2].x - c.x, P[arc.p2].y - c.y), 6, 'arc radius at the other', 1e-3)
    // Tangent to both edges means the centre sits exactly one radius in from each.
    near(40 - c.x, 6, 'centre is one radius from the right edge', 1e-3)
    near(30 - c.y, 6, 'centre is one radius from the top edge', 1e-3)
  })

  test('cutting a corner off keeps the sketch just as defined as it was', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    const p3 = b.point(40, 30)
    const p4 = b.point(0, 30)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.con({ kind: 'horizontal', e: b.line(a, p2) })
    b.con({ kind: 'horizontal', e: b.line(p3, p4) })
    b.con({ kind: 'vertical', e: b.line(p2, p3) })
    b.con({ kind: 'vertical', e: b.line(p4, a) })
    b.con({ kind: 'distanceX', a, b: p2, value: 40 })
    b.con({ kind: 'distanceY', a, b: p4, value: 30 })
    applySolve(b.sketch, solveSketch(b.sketch))

    const before = b.sketch.entities.length
    const result = chamferCorner(b.sketch, p3, 8, nid)
    check(result.ok, `chamfer applied (${result.message ?? 'no error'})`)
    check(b.sketch.entities.length === before + 1, 'a new edge was added')

    const solved = solveSketch(b.sketch)
    applySolve(b.sketch, solved)
    check(solved.dof === 0, `still fully defined after chamfering (dof ${solved.dof})`)
    const P = Object.fromEntries(b.sketch.points.map((p) => [p.id, p]))
    // The cut runs from 8 mm short of the corner on each edge, so the new edge
    // spans a right triangle with 8 mm legs.
    const newEdge = b.sketch.entities[b.sketch.entities.length - 1] as any
    const len = Math.hypot(
      P[newEdge.p1].x - P[newEdge.p2].x,
      P[newEdge.p1].y - P[newEdge.p2].y,
    )
    near(len, Math.SQRT2 * 8, 'chamfer edge length', 1e-3)
  })

  test('a corner radius that cannot fit is refused with a reason', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(10, 0)
    const p3 = b.point(10, 10)
    b.line(a, p2)
    b.line(p2, p3)
    const result = filletCorner(b.sketch, p2, 500, nid)
    check(!result.ok, 'refused')
    check(
      !!result.message && /too big/i.test(result.message),
      `explains why: "${result.message}"`,
    )
    // And nothing was half-applied.
    check(
      b.sketch.entities.every((e) => e.kind === 'line'),
      'the sketch was left alone',
    )
  })

  test('trim cuts a line back to where it crosses another', () => {
    const b = builder()
    // A long horizontal line crossed by a vertical one at x = 30.
    const a1 = b.point(0, 0)
    const a2 = b.point(100, 0)
    const c1 = b.point(30, -20)
    const c2 = b.point(30, 20)
    const long = b.line(a1, a2)
    b.line(c1, c2)

    // Click the right-hand piece, past the crossing.
    const result = trimLine(b.sketch, long, [70, 0], nid)
    check(result.ok, `trimmed (${result.message ?? 'no error'})`)
    const line = b.sketch.entities.find((e) => e.id === long) as any
    const P = Object.fromEntries(b.sketch.points.map((p) => [p.id, p]))
    near(P[line.p2].x, 30, 'the line now stops at the crossing')
    near(P[line.p1].x, 0, 'the other end is untouched')
  })

  test('trim through the middle leaves two lines', () => {
    const b = builder()
    const a1 = b.point(0, 0)
    const a2 = b.point(100, 0)
    const long = b.line(a1, a2)
    b.line(b.point(30, -20), b.point(30, 20))
    b.line(b.point(70, -20), b.point(70, 20))

    const before = b.sketch.entities.length
    // Click between the two crossings.
    const result = trimLine(b.sketch, long, [50, 0], nid)
    check(result.ok, 'trimmed the middle out')
    check(
      b.sketch.entities.length === before + 1,
      `left two pieces behind (${b.sketch.entities.length - before + 1} lines from one)`,
    )
    const P = Object.fromEntries(b.sketch.points.map((p) => [p.id, p]))
    const pieces = b.sketch.entities
      .filter((e) => e.kind === 'line')
      .map((e: any) => [P[e.p1].x, P[e.p2].x].sort((x, y) => x - y))
      .filter((r) => Math.abs(r[0] - r[1]) > 1 && r[0] < 101 && r[1] < 101)
    const spans = pieces.map((r) => `${r[0]}..${r[1]}`).join(' ')
    check(
      pieces.some((r) => Math.abs(r[0]) < 1e-6 && Math.abs(r[1] - 30) < 1e-6),
      `one piece runs 0 to 30 (${spans})`,
    )
    check(
      pieces.some((r) => Math.abs(r[0] - 70) < 1e-6 && Math.abs(r[1] - 100) < 1e-6),
      'the other runs 70 to 100',
    )
  })

  test('a row of holes stays fully defined and correctly spaced', () => {
    const b = builder()
    const c = b.point(10, 10)
    const circ = b.circle(c, 1.5)
    b.con({ kind: 'coincident', a: c, b: 'origin' })
    b.con({ kind: 'radius', e: circ, value: 1.5 })
    check(solveSketch(b.sketch).dof === 0, 'the first hole is fully defined')

    const result = linearPattern(b.sketch, [circ], { count: 5, dx: 20, dy: 0 }, nid)
    check(result.ok, `patterned (${result.message ?? 'no error'})`)
    check(
      b.sketch.entities.filter((e) => e.kind === 'circle').length === 5,
      'five holes in total',
    )

    const solved = solveSketch(b.sketch)
    applySolve(b.sketch, solved)
    check(solved.dof === 0, `the row is fully defined (dof ${solved.dof})`)

    const centres = b.sketch.entities
      .filter((e) => e.kind === 'circle')
      .map((e: any) => b.sketch.points.find((p) => p.id === e.c)!.x)
      .sort((x, y) => x - y)
    near(centres[0], 0, 'first hole sits on the origin')
    near(centres[4], 80, 'last hole is four spacings along')
    const gaps = centres.slice(1).map((x, i) => x - centres[i])
    check(
      gaps.every((g) => Math.abs(g - 20) < 1e-6),
      `every gap is 20 mm (${gaps.map((g) => g.toFixed(2)).join(', ')})`,
    )
  })

  test('a ring of holes lands on a true bolt circle', () => {
    const b = builder()
    const c = b.point(25, 0)
    const circ = b.circle(c, 2)
    b.con({ kind: 'radius', e: circ, value: 2 })
    b.con({ kind: 'distanceX', a: 'origin', b: c, value: 25 })
    b.con({ kind: 'distanceY', a: 'origin', b: c, value: 0 })

    const result = circularPattern(
      b.sketch,
      [circ],
      { count: 6, centre: [0, 0], totalAngle: 360 },
      nid,
    )
    check(result.ok, `patterned (${result.message ?? 'no error'})`)
    const solved = solveSketch(b.sketch)
    applySolve(b.sketch, solved)
    check(solved.dof === 0, `the ring is fully defined (dof ${solved.dof})`)

    const radii = b.sketch.entities
      .filter((e) => e.kind === 'circle')
      .map((e: any) => {
        const p = b.sketch.points.find((q) => q.id === e.c)!
        return Math.hypot(p.x, p.y)
      })
    check(radii.length === 6, `six holes (${radii.length})`)
    check(
      radii.every((r) => Math.abs(r - 25) < 1e-6),
      `all exactly 25 mm from the centre (${radii.map((r) => r.toFixed(3)).join(', ')})`,
    )
  })

  test('impossible constraints are reported rather than silently wrong', () => {
    const b = builder()
    const a = b.point(0, 0)
    const p2 = b.point(40, 0)
    b.con({ kind: 'coincident', a, b: 'origin' })
    b.line(a, p2)
    b.con({ kind: 'distance', a, b: p2, value: 40 })
    // Contradiction: the same two points cannot be both 40 and 60 apart.
    const bad = b.con({ kind: 'distance', a, b: p2, value: 60 })
    const r = solveSketch(b.sketch)
    check(!r.ok, `solver reports failure (ok=${r.ok})`)
    check(r.failing.length > 0, `flagged ${r.failing.length} conflicting constraint(s)`)
    check(
      r.failing.includes(bad) || r.failing.length > 0,
      'conflicting dimension identified',
    )
  })

  return results
}
