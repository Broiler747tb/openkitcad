/** Small vector/plane helpers. Everything is millimetres and degrees-free. */

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export const v2 = {
  add: (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]],
  sub: (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]],
  scale: (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s],
  dot: (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1],
  cross: (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0],
  len: (a: Vec2) => Math.hypot(a[0], a[1]),
  dist: (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  mid: (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  norm: (a: Vec2): Vec2 => {
    const l = Math.hypot(a[0], a[1])
    return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]
  },
  rot90: (a: Vec2): Vec2 => [-a[1], a[0]],
  angle: (a: Vec2) => Math.atan2(a[1], a[0]),
}

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2])
    return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
  },
}

/** An oriented plane: where a sketch lives and how its 2D maps into the world. */
export interface Frame {
  origin: Vec3
  /** Unit vector that 2D +x maps to. */
  xDir: Vec3
  /** Unit vector that 2D +y maps to. */
  yDir: Vec3
  /** xDir cross yDir. */
  normal: Vec3
}

export function makeFrame(origin: Vec3, normal: Vec3, xHint?: Vec3): Frame {
  const n = v3.norm(normal)
  // Pick any axis not parallel to the normal to seed the in-plane x direction.
  let x = xHint ?? (Math.abs(n[2]) < 0.9 ? ([0, 0, 1] as Vec3) : ([1, 0, 0] as Vec3))
  x = v3.norm(v3.sub(x, v3.scale(n, v3.dot(x, n))))
  if (v3.len(x) < 1e-9) x = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const y = v3.norm(v3.cross(n, x))
  return { origin, xDir: x, yDir: y, normal: n }
}

export function frameToWorld(f: Frame, p: Vec2): Vec3 {
  return [
    f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1],
    f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1],
    f.origin[2] + f.xDir[2] * p[0] + f.yDir[2] * p[1],
  ]
}

export function frameToLocal(f: Frame, p: Vec3): Vec2 {
  const d = v3.sub(p, f.origin)
  return [v3.dot(d, f.xDir), v3.dot(d, f.yDir)]
}

/** The three standard planes, matching replicad's plane names. */
export const NAMED_FRAMES: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] },
}

/** Rounds to a sane number of decimals for display without trailing noise. */
export function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '--'
  const r = Number(n.toFixed(decimals))
  return String(Object.is(r, -0) ? 0 : r)
}
