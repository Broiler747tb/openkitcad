/**
 * Sketch-plane resolution for the main thread.
 *
 * The kernel resolves a face-based plane by re-finding the face on the rebuilt
 * solid. The UI cannot do that - the B-rep lives in the worker - so it uses the
 * fingerprint stored on the reference instead. The two agree except in the
 * moment between an edit and the rebuild landing, which is exactly when nobody
 * is drawing anyway.
 */
import { makeFrame, NAMED_FRAMES, v3, type Frame } from '../core/math'
import type { PlaneRef } from './types'

/**
 * Tip a base plane over about one of its own in-plane axes.
 *
 * Kept here rather than in the kernel so the viewport and the geometry engine
 * cannot drift: a sketch drawn on a tilted plane must land in exactly the same
 * place in both.
 */
export function tiltedFrame(
  name: 'XY' | 'XZ' | 'YZ',
  tiltAxis: 'x' | 'y',
  angleDeg: number,
  offset: number,
): Frame {
  const base = NAMED_FRAMES[name]
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)

  let xDir = base.xDir
  let yDir = base.yDir
  let normal: typeof base.normal
  if (tiltAxis === 'x') {
    yDir = v3.norm(v3.add(v3.scale(base.yDir, cos), v3.scale(base.normal, sin)))
    normal = v3.norm(v3.add(v3.scale(base.yDir, -sin), v3.scale(base.normal, cos)))
  } else {
    xDir = v3.norm(v3.sub(v3.scale(base.xDir, cos), v3.scale(base.normal, sin)))
    normal = v3.norm(v3.add(v3.scale(base.xDir, sin), v3.scale(base.normal, cos)))
  }
  return {
    origin: v3.add(base.origin, v3.scale(normal, offset)),
    xDir,
    yDir,
    normal,
  }
}

export function frameFromPlaneRefLocal(ref: PlaneRef): Frame {
  if (ref.kind === 'named') {
    const base = NAMED_FRAMES[ref.name]
    return { ...base, origin: v3.add(base.origin, v3.scale(base.normal, ref.offset)) }
  }
  if (ref.kind === 'angled') {
    return tiltedFrame(ref.name, ref.tiltAxis, ref.angle, ref.offset)
  }
  return makeFrame(
    v3.add(ref.face.anchor, v3.scale(ref.face.normal, ref.offset)),
    ref.face.normal,
  )
}

export function planeLabel(ref: PlaneRef): string {
  const names = { XY: 'Top', XZ: 'Front', YZ: 'Right' } as const
  if (ref.kind === 'named') {
    return ref.offset
      ? `${names[ref.name]} plane, ${ref.offset} mm up`
      : `${names[ref.name]} plane`
  }
  if (ref.kind === 'angled') {
    return `${names[ref.name]} plane tipped ${ref.angle}°`
  }
  return ref.offset ? `A face, ${ref.offset} mm off` : 'A face'
}
