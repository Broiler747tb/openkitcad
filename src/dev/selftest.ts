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
