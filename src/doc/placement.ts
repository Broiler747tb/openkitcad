import type { Vec3 } from '../core/math'
import type { Matrix4 } from './types'
import { placementMatrix, transformPoint } from './model'

export type Bounds = [number, number, number, number, number, number]

export function worldBounds(bounds: Bounds, m: Matrix4): Bounds {
  const [x0, y0, z0, x1, y1, z1] = bounds
  const out: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const p = transformPoint(m, [x, y, z])
        for (let i = 0; i < 3; i++) {
          out[i] = Math.min(out[i], p[i])
          out[i + 3] = Math.max(out[i + 3], p[i])
        }
      }
    }
  }
  return out
}

export interface Pose {
  position: Vec3
  turn: number
  flipped: boolean
}

export function poseOf(m: Matrix4): Pose {
  const degrees = (Math.atan2(m[1], m[0]) * 180) / Math.PI
  const turn = Math.round((((degrees % 360) + 360) % 360) * 1e6) / 1e6
  return { position: [m[12], m[13], m[14]], turn: turn === 360 ? 0 : turn, flipped: m[10] < 0 }
}

export function poseMatrix(pose: Pose): Matrix4 {
  return placementMatrix(pose.position, pose.turn, pose.flipped)
}

export function withPose(m: Matrix4, patch: Partial<Pose>): Matrix4 {
  return poseMatrix({ ...poseOf(m), ...patch })
}
