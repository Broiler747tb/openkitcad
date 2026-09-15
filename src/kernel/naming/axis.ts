import type { Vec3 } from '../../core/math'

const ISOTROPY = 1e-6

export function canonicalAxis(axis: Vec3 | null): Vec3 | null {
  if (!axis) return null
  const length = Math.hypot(axis[0], axis[1], axis[2])
  if (!(length > 1e-12)) return null
  const unit: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length]
  const largest = Math.max(Math.abs(unit[0]), Math.abs(unit[1]), Math.abs(unit[2]))
  const lead = unit.findIndex((component) => Math.abs(component) >= largest - 1e-9)
  return unit[lead] < 0 ? [-unit[0], -unit[1], -unit[2]] : unit
}

export function symmetricEigen(matrix: number[][]): { values: number[]; vectors: Vec3[] } {
  const a = matrix.map((row) => [...row])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2])
    if (off < 1e-15 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p]
        const akq = a[k][q]
        a[k][p] = c * akp - s * akq
        a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k]
        const aqk = a[q][k]
        a[p][k] = c * apk - s * aqk
        a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]
        const vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq
        v[k][q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i])
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3),
  }
}

export function principalAxisFromInertia(inertia: number[][]): Vec3 | null {
  const trace = inertia[0][0] + inertia[1][1] + inertia[2][2]
  const spread = inertia.map((row, i) => row.map((value, j) => (i === j ? trace / 2 : 0) - value))
  const { values, vectors } = symmetricEigen(spread)
  const scale = Math.max(Math.abs(values[0]), 1e-300)
  if (!Number.isFinite(values[0]) || values[0] - values[1] <= ISOTROPY * scale) return null
  return canonicalAxis(vectors[0])
}
