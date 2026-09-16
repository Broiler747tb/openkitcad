import type { Vec2 } from '../core/math'

export interface BSpline {
  ctrl: Vec2[]
  knots: number[]
  degree: number
}

export interface HandleValue {
  dx: number
  dy: number
  k: number
}

export function splineDegree(count: number, knots?: number[]): number {
  if (knots && knots.length > count + 1) {
    const degree = knots.length - count - 1
    if (degree >= 1 && degree <= 3) return degree
  }
  return Math.max(1, Math.min(3, count - 1))
}

export function clampedKnots(count: number, degree: number): number[] {
  const knots: number[] = []
  const spans = count - degree
  for (let i = 0; i <= degree; i++) knots.push(0)
  for (let i = 1; i < spans; i++) knots.push(i / spans)
  for (let i = 0; i <= degree; i++) knots.push(1)
  return knots
}

export function validKnots(knots: number[] | undefined, count: number): number[] {
  const degree = splineDegree(count, knots)
  if (!knots || knots.length !== count + degree + 1) return clampedKnots(count, degree)
  for (let i = 1; i < knots.length; i++) {
    if (!(knots[i] >= knots[i - 1])) return clampedKnots(count, degree)
  }
  if (!(knots[count] > knots[degree])) return clampedKnots(count, degree)
  return knots
}

export function findSpan(count: number, degree: number, u: number, knots: number[]): number {
  const n = count - 1
  if (u >= knots[n + 1]) {
    let span = n
    while (span > degree && knots[span] >= knots[n + 1]) span--
    return span
  }
  if (u <= knots[degree]) {
    let span = degree
    while (span < n && knots[span + 1] <= knots[degree]) span++
    return span
  }
  let low = degree
  let high = n + 1
  let mid = (low + high) >> 1
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid
    else low = mid
    mid = (low + high) >> 1
  }
  return mid
}

export function basisDerivatives(
  span: number,
  u: number,
  degree: number,
  order: number,
  knots: number[],
): number[][] {
  const p = degree
  const ndu: number[][] = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0))
  const left = new Array<number>(p + 1).fill(0)
  const right = new Array<number>(p + 1).fill(0)
  ndu[0][0] = 1
  for (let j = 1; j <= p; j++) {
    left[j] = u - knots[span + 1 - j]
    right[j] = knots[span + j] - u
    let saved = 0
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r]
      const temp = ndu[r][j - 1] / ndu[j][r]
      ndu[r][j] = saved + right[r + 1] * temp
      saved = left[j - r] * temp
    }
    ndu[j][j] = saved
  }
  const ders: number[][] = Array.from({ length: order + 1 }, () => new Array<number>(p + 1).fill(0))
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p]
  const top = Math.min(order, p)
  const a: number[][] = [new Array<number>(p + 1).fill(0), new Array<number>(p + 1).fill(0)]
  for (let r = 0; r <= p; r++) {
    let s1 = 0
    let s2 = 1
    a[0][0] = 1
    for (let k = 1; k <= top; k++) {
      let d = 0
      const rk = r - k
      const pk = p - k
      if (r >= k) {
        a[s2][0] = a[s1][0] / ndu[pk + 1][rk]
        d = a[s2][0] * ndu[rk][pk]
      }
      const j1 = rk >= -1 ? 1 : -rk
      const j2 = r - 1 <= pk ? k - 1 : p - r
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j]
        d += a[s2][j] * ndu[rk + j][pk]
      }
      if (r <= pk) {
        a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r]
        d += a[s2][k] * ndu[r][pk]
      }
      ders[k][r] = d
      const swap = s1
      s1 = s2
      s2 = swap
    }
  }
  let factor = p
  for (let k = 1; k <= top; k++) {
    for (let j = 0; j <= p; j++) ders[k][j] *= factor
    factor *= p - k
  }
  return ders
}

export function evaluateBSpline(spline: BSpline, u: number, order = 0): Vec2[] {
  const { ctrl, knots, degree } = spline
  const span = findSpan(ctrl.length, degree, u, knots)
  const ders = basisDerivatives(span, u, degree, order, knots)
  const out: Vec2[] = []
  for (let k = 0; k <= order; k++) {
    let x = 0
    let y = 0
    for (let j = 0; j <= degree; j++) {
      const point = ctrl[span - degree + j]
      x += ders[k][j] * point[0]
      y += ders[k][j] * point[1]
    }
    out.push([x, y])
  }
  return out
}

export function knotMultiplicity(knots: number[], u: number): number {
  return knots.filter((k) => k === u).length
}

export function insertKnot(spline: BSpline, u: number): BSpline {
  const { ctrl, knots, degree: p } = spline
  const n = ctrl.length
  const k = findSpan(n, p, u, knots)
  const nextKnots = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)]
  const nextCtrl: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    if (i <= k - p) nextCtrl.push(ctrl[i])
    else if (i > k) nextCtrl.push(ctrl[i - 1])
    else {
      const alpha = (u - knots[i]) / (knots[i + p] - knots[i])
      nextCtrl.push([
        (1 - alpha) * ctrl[i - 1][0] + alpha * ctrl[i][0],
        (1 - alpha) * ctrl[i - 1][1] + alpha * ctrl[i][1],
      ])
    }
  }
  return { ctrl: nextCtrl, knots: nextKnots, degree: p }
}

export function normalizeKnots(knots: number[]): number[] {
  const lo = knots[0]
  const hi = knots[knots.length - 1]
  const span = hi - lo || 1
  return knots.map((k) => (k - lo) / span)
}

function snapToKnot(knots: number[], u: number): number {
  for (const k of knots) if (Math.abs(k - u) < 1e-10) return k
  return u
}

export function splitBSpline(spline: BSpline, u: number): [BSpline, BSpline] | null {
  const p = spline.degree
  const lo = spline.knots[p]
  const hi = spline.knots[spline.ctrl.length]
  if (!(u > lo + 1e-9 && u < hi - 1e-9)) return null
  const at = snapToKnot(spline.knots, u)
  let current = spline
  let s = knotMultiplicity(current.knots, at)
  while (s < p + 1) {
    current = insertKnot(current, at)
    s++
  }
  const r = current.knots.indexOf(at)
  const left: BSpline = {
    ctrl: current.ctrl.slice(0, r),
    knots: normalizeKnots(current.knots.slice(0, r + p + 1)),
    degree: p,
  }
  const right: BSpline = {
    ctrl: current.ctrl.slice(r),
    knots: normalizeKnots(current.knots.slice(r)),
    degree: p,
  }
  return [left, right]
}

export function subBSpline(spline: BSpline, u0: number, u1: number): BSpline {
  let piece = spline
  const lo = spline.knots[spline.degree]
  const hi = spline.knots[spline.ctrl.length]
  const a = Math.max(lo, Math.min(u0, u1))
  const b = Math.min(hi, Math.max(u0, u1))
  const cutEnd = splitBSpline(piece, b)
  if (cutEnd) piece = cutEnd[0]
  const local = (a - lo) / (b - lo || 1)
  const cutStart = splitBSpline(piece, local)
  if (cutStart) piece = cutStart[1]
  return piece
}

export function reverseBSpline(spline: BSpline): BSpline {
  const lo = spline.knots[0]
  const hi = spline.knots[spline.knots.length - 1]
  return {
    ctrl: [...spline.ctrl].reverse(),
    knots: spline.knots.map((k) => lo + hi - k).reverse(),
    degree: spline.degree,
  }
}

export function elevateBezier(points: Vec2[]): Vec2[] {
  const m = points.length - 1
  const out: Vec2[] = [points[0]]
  for (let i = 1; i <= m; i++) {
    const f = i / (m + 1)
    out.push([
      f * points[i - 1][0] + (1 - f) * points[i][0],
      f * points[i - 1][1] + (1 - f) * points[i][1],
    ])
  }
  out.push(points[m])
  return out
}

export function bezierSegments(spline: BSpline): Array<[Vec2, Vec2, Vec2, Vec2]> {
  const p = spline.degree
  const lo = spline.knots[p]
  const hi = spline.knots[spline.ctrl.length]
  const interior = [...new Set(spline.knots.filter((k) => k > lo && k < hi))]
  let current = spline
  for (const u of interior) {
    let s = knotMultiplicity(current.knots, u)
    while (s < p) {
      current = insertKnot(current, u)
      s++
    }
  }
  const segments: Array<[Vec2, Vec2, Vec2, Vec2]> = []
  for (let i = 0; i + p < current.ctrl.length; i += p) {
    let segment = current.ctrl.slice(i, i + p + 1)
    while (segment.length < 4) segment = elevateBezier(segment)
    segments.push([segment[0], segment[1], segment[2], segment[3]])
  }
  return segments
}

export function chordParameters(points: Vec2[]): number[] {
  const n = points.length
  if (n < 2) return points.map(() => 0)
  const cumulative = [0]
  let total = 0
  for (let i = 1; i < n; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    cumulative.push(total)
  }
  if (total < 1e-12) return points.map((_, i) => i / (n - 1))
  const params = cumulative.map((d) => d / total)
  const gap = 1e-6
  for (let i = 1; i < n; i++) {
    if (params[i] < params[i - 1] + gap) params[i] = params[i - 1] + gap
  }
  const last = params[n - 1]
  return params.map((u) => u / last)
}

export interface FitSystem {
  knots: number[]
  count: number
  weights: number[][]
  sources: number
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-14) return null
    const swap = a[col]
    a[col] = a[pivot]
    a[pivot] = swap
    const d = a[col][col]
    for (let k = 0; k < 2 * n; k++) a[col][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r][col]
      if (f === 0) continue
      for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[col][k]
    }
  }
  return a.map((row) => row.slice(n))
}

export function fitSystem(
  params: number[],
  startHandle: boolean,
  endHandle: boolean,
): FitSystem | null {
  const n = params.length
  if (n < 2) return null
  const interior = params.slice(1, n - 1)
  if (startHandle) interior.push(params[0] + (params[1] - params[0]) / 3)
  if (endHandle) interior.push(params[n - 1] - (params[n - 1] - params[n - 2]) / 3)
  interior.sort((x, y) => x - y)
  const knots = [0, 0, 0, 0, ...interior, 1, 1, 1, 1]
  const count = knots.length - 4
  const matrix: number[][] = Array.from({ length: count }, () => new Array<number>(count).fill(0))
  const rowSource: number[] = []
  for (let k = 0; k < n; k++) {
    const span = findSpan(count, 3, params[k], knots)
    const ders = basisDerivatives(span, params[k], 3, 0, knots)
    for (let j = 0; j <= 3; j++) matrix[k][span - 3 + j] = ders[0][j]
    rowSource.push(k)
  }
  let row = n
  let source = n
  const endRows = (u: number, handle: boolean) => {
    const span = findSpan(count, 3, u, knots)
    const ders = basisDerivatives(span, u, 3, 2, knots)
    if (handle) {
      for (let j = 0; j <= 3; j++) matrix[row][span - 3 + j] = ders[1][j]
      rowSource.push(source++)
      row++
      for (let j = 0; j <= 3; j++) matrix[row][span - 3 + j] = ders[2][j]
      rowSource.push(source++)
      row++
    } else {
      for (let j = 0; j <= 3; j++) matrix[row][span - 3 + j] = ders[2][j]
      rowSource.push(-1)
      row++
    }
  }
  endRows(0, startHandle)
  endRows(1, endHandle)
  const inverse = invertMatrix(matrix)
  if (!inverse) return null
  const weights = inverse.map((line) => {
    const out = new Array<number>(source).fill(0)
    rowSource.forEach((s, r) => {
      if (s >= 0) out[s] = line[r]
    })
    return out
  })
  return { knots, count, weights, sources: source }
}

export function handleSecondDerivative(handle: HandleValue): Vec2 {
  const len = Math.hypot(handle.dx, handle.dy)
  return [-handle.k * len * handle.dy, handle.k * len * handle.dx]
}

export function fitBSpline(
  points: Vec2[],
  startHandle?: HandleValue,
  endHandle?: HandleValue,
): BSpline {
  if (points.length < 2) {
    const only = points[0] ?? [0, 0]
    return { ctrl: [only, only], knots: [0, 0, 1, 1], degree: 1 }
  }
  const params = chordParameters(points)
  const system = fitSystem(params, !!startHandle, !!endHandle)
  if (!system) {
    return { ctrl: points.slice(), knots: clampedKnots(points.length, 1), degree: 1 }
  }
  const values: Vec2[] = [...points]
  if (startHandle)
    values.push([startHandle.dx, startHandle.dy], handleSecondDerivative(startHandle))
  if (endHandle) values.push([endHandle.dx, endHandle.dy], handleSecondDerivative(endHandle))
  const ctrl = system.weights.map((line): Vec2 => {
    let x = 0
    let y = 0
    for (let s = 0; s < line.length; s++) {
      x += line[s] * values[s][0]
      y += line[s] * values[s][1]
    }
    return [x, y]
  })
  return { ctrl, knots: system.knots, degree: 3 }
}

export function endHandleOf(spline: BSpline, end: 'start' | 'end'): HandleValue {
  const [, d1, d2] = evaluateBSpline(spline, end === 'start' ? 0 : 1, 2)
  const speed = Math.hypot(d1[0], d1[1])
  const k = speed < 1e-12 ? 0 : (d1[0] * d2[1] - d1[1] * d2[0]) / speed ** 3
  return { dx: d1[0], dy: d1[1], k }
}
