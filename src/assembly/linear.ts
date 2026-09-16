export function solveSymmetric(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const l = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j]
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k]
      if (i === j) {
        if (!(sum > 0)) return null
        l[i * n + i] = Math.sqrt(sum)
      } else {
        l[i * n + j] = sum / l[j * n + j]
      }
    }
  }
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = b[i]
    for (let k = 0; k < i; k++) sum -= l[i * n + k] * y[k]
    y[i] = sum / l[i * n + i]
  }
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k]
    x[i] = sum / l[i * n + i]
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return null
  return x
}

export interface Eigen {
  values: Float64Array
  vectors: Float64Array
}

export function symmetricEigen(matrix: Float64Array, n: number): Eigen {
  const a = new Float64Array(matrix)
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1
  let scale = 0
  for (let i = 0; i < n * n; i++) scale += a[i] * a[i]
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q]
    if (off <= 1e-30 * scale || off === 0) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (apq === 0) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        a[p * n + q] = 0
        a[q * n + p] = 0
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]
          const vkq = v[k * n + q]
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const values = new Float64Array(n)
  for (let i = 0; i < n; i++) values[i] = a[i * n + i]
  return { values, vectors: v }
}

export function gram(rows: Float64Array[], columns: number): Float64Array {
  const h = new Float64Array(columns * columns)
  for (const row of rows) {
    for (let i = 0; i < columns; i++) {
      const ri = row[i]
      if (ri === 0) continue
      for (let j = 0; j < columns; j++) h[i * columns + j] += ri * row[j]
    }
  }
  return h
}

export function rankOf(rows: Float64Array[], columns: number, threshold: number): number {
  if (!rows.length || !columns) return 0
  const small = rows.length <= columns
  const size = small ? rows.length : columns
  const m = new Float64Array(size * size)
  if (small) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows.length; j++) {
        let sum = 0
        for (let k = 0; k < columns; k++) sum += rows[i][k] * rows[j][k]
        m[i * size + j] = sum
      }
    }
  } else {
    m.set(gram(rows, columns))
  }
  const { values } = symmetricEigen(m, size)
  let rank = 0
  for (const value of values) if (value > threshold * threshold) rank++
  return rank
}
