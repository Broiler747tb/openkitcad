/**
 * Placement transforms, in pure maths so the viewport, the clearance checker
 * and the kernel all agree on exactly where a placed part is.
 */
import type { Vec2, Vec3 } from '../core/math'
import type { Placement } from './types'

/** Map a point in a part's local frame into world space. */
export function placementToWorld(pl: Placement, p: Vec3): Vec3 {
  let [x, y, z] = p
  // Flip about the part's own X axis first, so a flipped board hangs below
  // its placement point rather than swinging away from it.
  if (pl.flipped) {
    y = -y
    z = -z
  }
  const a = (pl.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const rx = x * cos - y * sin
  const ry = x * sin + y * cos
  return [rx + pl.position[0], ry + pl.position[1], z + pl.position[2]]
}

/** Map a world point back into a part's local frame. */
export function worldToPlacement(pl: Placement, p: Vec3): Vec3 {
  const dx = p[0] - pl.position[0]
  const dy = p[1] - pl.position[1]
  const dz = p[2] - pl.position[2]
  const a = (-pl.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  let x = dx * cos - dy * sin
  let y = dx * sin + dy * cos
  let z = dz
  if (pl.flipped) {
    y = -y
    z = -z
  }
  return [x, y, z]
}

/** Convenience for the very common "a hole on the part's top face" case. */
export function placementHoleWorld(pl: Placement, hole: Vec2): Vec3 {
  return placementToWorld(pl, [hole[0], hole[1], 0])
}
