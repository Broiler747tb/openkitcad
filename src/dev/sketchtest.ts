import { v2, type Vec2 } from '../core/math'
import { closestPoint, curveOf, intersectEntities, pointLookup, tessellate } from '../sketch/curves'
import { selectProfiles, sketchRegions } from '../sketch/regions'
import { resolveConstraint, toggleFixes } from '../sketch/constraintTools'
import {
  buildTool,
  emptyToolState,
  lockField,
  placeAnchor,
  remember,
} from '../sketch/tools/session'
import { freeAnchor } from '../sketch/tools/shapes'
import { sketchTool } from '../sketch/tools/specs'
import type { SketchToolId, ToolAnchor } from '../sketch/tools/types'
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

  guard('regions', () => {
    const rectangle = (d: Draft, x: number, y: number, w: number, h: number) => {
      const corners = [
        point(d, x, y),
        point(d, x + w, y),
        point(d, x + w, y + h),
        point(d, x, y + h),
      ]
      return corners.map((p, i) =>
        entity(d, { kind: 'line', p1: p, p2: corners[(i + 1) % 4], construction: false }),
      )
    }
    const summary = (d: Draft) =>
      sketchRegions(d.sketch)
        .regions.map((region) => `${region.area.toFixed(2)}${region.solid ? 's' : 'h'}`)
        .join(' ')

    const plain = draft()
    rectangle(plain, 0, 0, 40, 30)
    check('a rectangle is one solid region', summary(plain) === '1200.00s', summary(plain))

    const washer = draft()
    rectangle(washer, 0, 0, 40, 30)
    entity(washer, { kind: 'circle', c: point(washer, 20, 15), r: 5, construction: false })
    const hole = (Math.PI * 25).toFixed(2)
    check(
      'a circle inside a rectangle makes a plate with a hole and a disc',
      summary(washer) === `${(1200 - Math.PI * 25).toFixed(2)}s ${hole}h`,
      summary(washer),
    )

    const overlap = draft()
    rectangle(overlap, 0, 0, 30, 20)
    rectangle(overlap, 20, 10, 30, 20)
    check(
      'two overlapping rectangles make three solid regions',
      summary(overlap) === '500.00s 500.00s 100.00s',
      summary(overlap),
    )

    const halves = draft()
    entity(halves, { kind: 'circle', c: point(halves, 0, 0), r: 10, construction: false })
    entity(halves, {
      kind: 'line',
      p1: point(halves, -15, 0),
      p2: point(halves, 15, 0),
      construction: false,
    })
    const half = ((Math.PI * 100) / 2).toFixed(2)
    check(
      'a line across a circle splits it into two halves and ignores the ends that stick out',
      summary(halves) === `${half}s ${half}s`,
      summary(halves),
    )

    const tailed = draft()
    const edges = rectangle(tailed, 0, 0, 40, 30)
    const corner = (byId(tailed, edges[1]) as { p2: string }).p2
    const tail = entity(tailed, {
      kind: 'line',
      p1: corner,
      p2: point(tailed, 60, 50),
      construction: false,
    })
    const tailedRegions = sketchRegions(tailed.sketch)
    check(
      'a line hanging off a corner is left out of the profile',
      summary(tailed) === '1200.00s' && tailedRegions.dangling.includes(tail),
      `${summary(tailed)}, dangling ${tailedRegions.dangling.join(',')}`,
    )

    const bridged = draft()
    rectangle(bridged, 0, 0, 40, 30)
    const centre = point(bridged, 20, 15)
    entity(bridged, { kind: 'circle', c: centre, r: 5, construction: false })
    entity(bridged, {
      kind: 'line',
      p1: point(bridged, 25, 15),
      p2: point(bridged, 40, 15),
      construction: false,
    })
    check(
      'a line joining a hole to the outline does not change the regions',
      summary(bridged) === `${(1200 - Math.PI * 25).toFixed(2)}s ${hole}h`,
      summary(bridged),
    )

    const keyed = draft()
    const keyedEdges = rectangle(keyed, 0, 0, 40, 30)
    const before = sketchRegions(keyed.sketch).regions[0].key
    for (const p of keyed.sketch.points) {
      p.x *= 2
      p.y *= 1.5
    }
    const after = sketchRegions(keyed.sketch).regions[0].key
    check(
      'a region keeps its key when the sketch is resized',
      before === after && keyedEdges.every((id) => before.includes(id)),
      before,
    )

    const rounded = draft()
    const r = 5
    const p = (x: number, y: number) => point(rounded, x, y)
    const a1 = p(r, 0)
    const a2 = p(40 - r, 0)
    const b1 = p(40, r)
    const b2 = p(40, 30 - r)
    const c1 = p(40 - r, 30)
    const c2 = p(r, 30)
    const d1 = p(0, 30 - r)
    const d2 = p(0, r)
    for (const [s, e] of [
      [a1, a2],
      [b1, b2],
      [c1, c2],
      [d1, d2],
    ]) {
      entity(rounded, { kind: 'line', p1: s, p2: e, construction: false })
    }
    for (const [cx, cy, s, e] of [
      [40 - r, r, a2, b1],
      [40 - r, 30 - r, b2, c1],
      [r, 30 - r, c2, d1],
      [r, r, d2, a1],
    ] as Array<[number, number, string, string]>) {
      entity(rounded, { kind: 'arc', c: p(cx, cy), p1: s, p2: e, ccw: true, construction: false })
    }
    const roundedArea = 1200 - (4 - Math.PI) * r * r
    check(
      'a rounded rectangle is one region with the corners taken off',
      summary(rounded) === `${roundedArea.toFixed(2)}s`,
      `${summary(rounded)}, expected ${roundedArea.toFixed(2)}s`,
    )

    const oval = draft()
    entity(oval, {
      kind: 'ellipse',
      c: point(oval, 0, 0),
      rx: 20,
      ry: 10,
      rotation: 30,
      construction: false,
    })
    entity(oval, {
      kind: 'line',
      p1: point(oval, 0, -30),
      p2: point(oval, 0, 30),
      construction: false,
    })
    const ovalRegions = sketchRegions(oval.sketch).regions
    const ovalArea = ovalRegions.reduce((sum, region) => sum + region.area, 0)
    check(
      'a line through a tilted ellipse splits it into two regions that add up to the ellipse',
      ovalRegions.length === 2 && Math.abs(ovalArea - Math.PI * 200) < 0.2,
      `${ovalRegions.length} regions, ${ovalArea.toFixed(3)} of ${(Math.PI * 200).toFixed(3)}`,
    )

    const sail = draft()
    const s1 = point(sail, 0, 0)
    const s2 = point(sail, 40, 0)
    entity(sail, { kind: 'line', p1: s1, p2: s2, construction: false })
    entity(sail, {
      kind: 'spline',
      mode: 'fit',
      points: [s2, point(sail, 30, 15), point(sail, 10, 18), s1],
      construction: false,
    })
    const sailRegions = sketchRegions(sail.sketch).regions
    check(
      'a spline closed off by a line makes one region',
      sailRegions.length === 1 && sailRegions[0].solid && sailRegions[0].area > 300,
      summary(sail),
    )

    const divided = draft()
    rectangle(divided, 0, 0, 40, 30)
    entity(divided, {
      kind: 'line',
      p1: point(divided, 15, -5),
      p2: point(divided, 15, 35),
      construction: false,
    })
    check(
      'a line straight across a rectangle leaves both sides solid',
      summary(divided) === '750.00s 450.00s',
      summary(divided),
    )

    const loopsOf = (d: Draft, keys?: string[]) => {
      const selection = selectProfiles(d.sketch, keys)
      if (!selection.ok) return `failed ${selection.missing.length} missing`
      return selection.loops
        .map(
          (loop) =>
            `${loop.outer.area.toFixed(2)}/${loop.outer.pieces.length}` +
            loop.holes.map((hole) => ` -${Math.abs(hole.area).toFixed(2)}`).join(''),
        )
        .join(' + ')
    }
    const halfKeys = sketchRegions(halves.sketch).regions.map((region) => region.key)
    check(
      'picking both halves of a circle profiles the whole disc as one circle',
      loopsOf(halves, halfKeys) === `${(Math.PI * 100).toFixed(2)}/1`,
      loopsOf(halves, halfKeys),
    )
    const washerKeys = sketchRegions(washer.sketch).regions.map((region) => region.key)
    check(
      'picking a plate and the disc in its hole profiles the plate without the hole',
      loopsOf(washer, washerKeys) === '1200.00/4',
      loopsOf(washer, washerKeys),
    )
    check(
      'a sketch with no profile picked profiles the plate with its hole',
      loopsOf(washer) === `1200.00/4 -${(Math.PI * 25).toFixed(2)}`,
      loopsOf(washer),
    )
    const overlapKeys = sketchRegions(overlap.sketch).regions.map((region) => region.key)
    check(
      'picking all three overlap regions profiles their outline',
      loopsOf(overlap, overlapKeys) === '1100.00/8',
      loopsOf(overlap, overlapKeys),
    )
    const tailedEdge = draft()
    const tailedSides = rectangle(tailedEdge, 0, 0, 40, 30)
    entity(tailedEdge, {
      kind: 'line',
      p1: point(tailedEdge, 20, 0),
      p2: point(tailedEdge, 20, -10),
      construction: false,
    })
    const tailedLoop = selectProfiles(tailedEdge.sketch)
    check(
      'a stub touching the middle of an edge does not split that edge in the profile',
      tailedLoop.ok &&
        tailedLoop.loops[0].outer.pieces.length === 4 &&
        tailedLoop.loops[0].outer.pieces.every((piece) => tailedSides.includes(piece.token)),
      tailedLoop.ok
        ? tailedLoop.loops[0].outer.pieces.map((piece) => piece.token).join(' ')
        : 'no profile',
    )
    const checker = draft()
    rectangle(checker, 0, 0, 10, 10)
    rectangle(checker, 10, 10, 10, 10)
    check(
      'two squares touching at a corner stay two profiles',
      loopsOf(checker) === '100.00/4 + 100.00/4',
      loopsOf(checker),
    )
    check(
      'a profile that no longer exists is reported missing',
      loopsOf(plain, ['gone']) === 'failed 1 missing',
      loopsOf(plain, ['gone']),
    )
  })

  guard('tools', () => {
    type Step = { at: Vec2; click?: boolean; lock?: Record<string, number>; anchor?: ToolAnchor }
    const drawWith = (d: Draft, id: SketchToolId, steps: Step[]) => {
      const spec = sketchTool(id)!
      let state = emptyToolState()
      for (const step of steps) {
        for (const [key, value] of Object.entries(step.lock ?? {})) {
          state = lockField(state, key, value)
        }
        const frame = spec.frame(state, step.anchor ?? freeAnchor(step.at), d.sketch)
        state = remember(state, frame)
        if (step.click === false) continue
        const placed = placeAnchor(spec, state, frame)
        state = placed.state
        if (placed.complete) break
      }
      const before = d.sketch.entities.length
      const build = buildTool(spec, d.sketch, state, d.id)
      return { build, added: d.sketch.entities.slice(before) }
    }
    const areaOf = (d: Draft) =>
      sketchRegions(d.sketch)
        .regions.reduce((sum, region) => sum + region.area, 0)
        .toFixed(2)
    const settled = (d: Draft) => {
      const result = solved(d)
      return result.ok ? `ok dof ${result.dof}` : `failed ${result.residual.toExponential(2)}`
    }

    const lined = draft()
    const { added: segment } = drawWith(lined, 'line', [
      { at: [0, 0] },
      { at: [7, 3], lock: { length: 25, angle: 30 } },
    ])
    solved(lined)
    const seg = segment[0] as { p1: string; p2: string }
    const segLength = v2.dist(at(lined, seg.p1), at(lined, seg.p2))
    check(
      'a line drawn with a typed length and angle keeps the length as a dimension',
      Math.abs(segLength - 25) < 1e-6 &&
        lined.sketch.constraints.some((c) => c.kind === 'distance' && c.value === 25) &&
        Math.abs(Math.atan2(at(lined, seg.p2)[1], at(lined, seg.p2)[0]) - Math.PI / 6) < 1e-6,
      `${segLength.toFixed(6)} mm`,
    )

    const cases: Array<{ name: string; tool: SketchToolId; steps: Step[]; area: number }> = [
      {
        name: 'a 2-point rectangle',
        tool: 'rectangle',
        steps: [{ at: [0, 0] }, { at: [40, 30] }],
        area: 1200,
      },
      {
        name: 'a centre rectangle',
        tool: 'rectangleCentre',
        steps: [{ at: [10, 10] }, { at: [30, 25] }],
        area: 1200,
      },
      {
        name: 'a 3-point rectangle at an angle',
        tool: 'rectangle3',
        steps: [{ at: [0, 0] }, { at: [30, 40] }, { at: [0, 0], lock: { width: 20 } }],
        area: 1000,
      },
      {
        name: 'a circle with a typed diameter',
        tool: 'circle',
        steps: [{ at: [0, 0] }, { at: [3, 0], lock: { diameter: 20 } }],
        area: Math.PI * 100,
      },
      {
        name: 'a 2-point circle',
        tool: 'circle2',
        steps: [{ at: [0, 0] }, { at: [10, 0] }],
        area: Math.PI * 25,
      },
      {
        name: 'a 3-point circle',
        tool: 'circle3',
        steps: [{ at: [0, 0] }, { at: [10, 0] }, { at: [5, 5] }],
        area: Math.PI * 25,
      },
      {
        name: 'an inscribed hexagon',
        tool: 'polygonInscribed',
        steps: [{ at: [0, 0] }, { at: [10, 0] }],
        area: ((3 * Math.sqrt(3)) / 2) * 100,
      },
      {
        name: 'a circumscribed hexagon',
        tool: 'polygon',
        steps: [{ at: [0, 0] }, { at: [10, 0] }],
        area: 2 * Math.sqrt(3) * 100,
      },
      {
        name: 'an edge polygon with five sides',
        tool: 'polygonEdge',
        steps: [{ at: [0, 0] }, { at: [10, 0], lock: { sides: 5 } }, { at: [5, 5] }],
        area: (5 * 100) / (4 * Math.tan(Math.PI / 5)),
      },
      {
        name: 'a centre to centre slot',
        tool: 'slot',
        steps: [{ at: [0, 0] }, { at: [30, 0] }, { at: [15, 5] }],
        area: 300 + Math.PI * 25,
      },
      {
        name: 'an overall slot',
        tool: 'slotOverall',
        steps: [{ at: [0, 0] }, { at: [40, 0] }, { at: [20, 5] }],
        area: 300 + Math.PI * 25,
      },
      {
        name: 'a centre point slot',
        tool: 'slotCentrePoint',
        steps: [{ at: [0, 0] }, { at: [15, 0] }, { at: [0, 5] }],
        area: 300 + Math.PI * 25,
      },
      {
        name: 'an ellipse',
        tool: 'ellipse',
        steps: [{ at: [0, 0] }, { at: [20, 0] }, { at: [3, 10] }],
        area: Math.PI * 200,
      },
    ]
    for (const shape of cases) {
      const d = draft()
      const { build } = drawWith(d, shape.tool, shape.steps)
      const drawn = areaOf(d)
      const status = settled(d)
      const after = areaOf(d)
      check(
        `${shape.name} closes into one profile of the right area and keeps it when solved`,
        !build.error &&
          Math.abs(Number(drawn) - shape.area) < 0.01 &&
          drawn === after &&
          status.startsWith('ok'),
        `${build.error ?? ''} drawn ${drawn}, solved ${after}, expected ${shape.area.toFixed(2)}, ${status}`,
      )
    }

    const edged = draft()
    drawWith(edged, 'polygonEdge', [{ at: [0, 0] }, { at: [10, 0] }, { at: [5, -5] }])
    const edgeCorners = edged.sketch.points.filter((p) => p.id !== 'origin')
    check(
      'an edge polygon keeps the edge that was drawn',
      edgeCorners.some((p) => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y) < 1e-9) &&
        edgeCorners.every((p) => p.y <= 1e-9),
      edgeCorners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
    )

    const bent = draft()
    const { added: bentArc } = drawWith(bent, 'arc3', [
      { at: [0, 0] },
      { at: [10, 0] },
      { at: [5, 5] },
    ])
    const arc3 = bentArc[0] as { kind: string; c: string; ccw: boolean }
    check(
      'a 3-point arc bends through the third point',
      arc3?.kind === 'arc' && !arc3.ccw && v2.dist(at(bent, arc3.c), [5, 0]) < 1e-9,
      JSON.stringify(arc3),
    )

    const swung = draft()
    const { added: swungArc } = drawWith(swung, 'arc', [
      { at: [0, 0] },
      { at: [10, 0] },
      { at: [7, 7], click: false },
      { at: [0, 10], click: false },
      { at: [-10, 0], click: false },
      { at: [0, -10] },
    ])
    const swing = swungArc[0] as { kind: string; ccw: boolean; p2: string }
    check(
      'a centre point arc follows the way the cursor swung, past half a turn',
      swing?.kind === 'arc' && swing.ccw && v2.dist(at(swung, swing.p2), [0, -10]) < 1e-9,
      JSON.stringify(swing),
    )

    const joined = draft()
    const lineEnd = point(joined, 10, 0)
    entity(joined, { kind: 'line', p1: point(joined, 0, 0), p2: lineEnd, construction: false })
    const { build: tangentBuild, added: tangentAdded } = drawWith(joined, 'arcTangent', [
      { at: [10, 0], anchor: { ...freeAnchor([10, 0]), snapToPointId: lineEnd } },
      { at: [10, 10] },
    ])
    const tangentArc = tangentAdded[0] as { kind: string; c: string; ccw: boolean; p1: string }
    const tangentStatus = settled(joined)
    check(
      'a tangent arc carries on from the end of a line and stays tangent when solved',
      !tangentBuild.error &&
        tangentArc?.kind === 'arc' &&
        tangentArc.p1 === lineEnd &&
        tangentArc.ccw &&
        v2.dist(at(joined, tangentArc.c), [10, 5]) < 1e-6 &&
        joined.sketch.constraints.some((c) => c.kind === 'tangent') &&
        tangentStatus.startsWith('ok'),
      `${tangentBuild.error ?? ''} ${JSON.stringify(tangentArc)} ${tangentStatus}`,
    )

    const curvy = draft()
    const { added: curve } = drawWith(curvy, 'spline', [
      { at: [0, 0] },
      { at: [10, 5] },
      { at: [20, 0] },
    ])
    check(
      'a fit point spline keeps every clicked point',
      curve[0]?.kind === 'spline' && (curve[0] as { points: string[] }).points.length === 3,
      JSON.stringify(curve[0]),
    )
  })

  guard('constraint tools', () => {
    const d = draft()
    const a = point(d, 0, 0)
    const b = point(d, 20, 1)
    const c = point(d, 20, 10)
    const e = point(d, 0, 12)
    const l1 = entity(d, { kind: 'line', p1: a, p2: b, construction: false })
    const l2 = entity(d, { kind: 'line', p1: c, p2: e, construction: false })
    const loose = point(d, 7, 3)
    const ring = entity(d, { kind: 'circle', c: point(d, 40, 0), r: 5, construction: false })
    const hoop = entity(d, { kind: 'circle', c: point(d, 41, 1), r: 3, construction: false })
    const outcome = (id: Parameters<typeof resolveConstraint>[1], picks: Array<[string, string]>) =>
      resolveConstraint(
        d.sketch,
        id,
        picks.map(([kind, pickId]) => ({ kind: kind as 'point' | 'entity', id: pickId })),
      )
    const summary = (o: ReturnType<typeof resolveConstraint>) =>
      o.kind === 'apply' ? o.constraints.map((x) => x.kind).join(',') : o.kind
    check(
      'Horizontal/Vertical picks the axis a line is closest to',
      summary(outcome('horizontalVertical', [['entity', l1]])) === 'horizontal',
      summary(outcome('horizontalVertical', [['entity', l1]])),
    )
    check(
      'Coincident waits for a second pick, then puts a point on a line',
      outcome('coincident', [['point', loose]]).kind === 'more' &&
        summary(
          outcome('coincident', [
            ['point', loose],
            ['entity', l1],
          ]),
        ) === 'pointOnLine',
      summary(
        outcome('coincident', [
          ['point', loose],
          ['entity', l1],
        ]),
      ),
    )
    check(
      'Coincident refuses a line and its own end point',
      outcome('coincident', [
        ['point', a],
        ['entity', l1],
      ]).kind === 'invalid',
      summary(
        outcome('coincident', [
          ['point', a],
          ['entity', l1],
        ]),
      ),
    )
    check(
      'Parallel, Perpendicular and Collinear take two lines',
      summary(
        outcome('parallel', [
          ['entity', l1],
          ['entity', l2],
        ]),
      ) === 'parallel' &&
        summary(
          outcome('perpendicular', [
            ['entity', l1],
            ['entity', l2],
          ]),
        ) === 'perpendicular' &&
        outcome('parallel', [
          ['entity', l1],
          ['entity', ring],
        ]).kind === 'invalid',
      summary(
        outcome('parallel', [
          ['entity', l1],
          ['entity', ring],
        ]),
      ),
    )
    check(
      'Tangent between a nested pair of circles keeps one inside the other',
      (() => {
        const o = outcome('tangent', [
          ['entity', ring],
          ['entity', hoop],
        ])
        return o.kind === 'apply' && (o.constraints[0] as { side: number }).side === -1
      })(),
      summary(
        outcome('tangent', [
          ['entity', ring],
          ['entity', hoop],
        ]),
      ),
    )
    check(
      'Symmetry needs two points and then a line',
      outcome('symmetry', [
        ['point', loose],
        ['point', c],
      ]).kind === 'more' &&
        summary(
          outcome('symmetry', [
            ['point', loose],
            ['point', c],
            ['entity', l1],
          ]),
        ) === 'symmetric',
      summary(
        outcome('symmetry', [
          ['point', loose],
          ['point', c],
          ['entity', l1],
        ]),
      ),
    )
    const fixed = outcome('fix', [['entity', l1]])
    const first = fixed.kind === 'toggleFix' ? toggleFixes(d.sketch, fixed.points, d.id) : 'none'
    const pinned = d.sketch.constraints.filter((x) => x.kind === 'fix').length
    const second = fixed.kind === 'toggleFix' ? toggleFixes(d.sketch, fixed.points, d.id) : 'none'
    check(
      'Fix/UnFix pins both ends of a line, then releases them',
      first === 'fixed' &&
        pinned === 3 &&
        second === 'released' &&
        d.sketch.constraints.filter((x) => x.kind === 'fix').length === 1,
      `${first} ${pinned} ${second}`,
    )
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
