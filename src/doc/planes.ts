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

export function frameFromPlaneRefLocal(ref: PlaneRef): Frame {
  if (ref.kind === 'named') {
    const base = NAMED_FRAMES[ref.name]
    return { ...base, origin: v3.add(base.origin, v3.scale(base.normal, ref.offset)) }
  }
  return makeFrame(
    v3.add(ref.face.anchor, v3.scale(ref.face.normal, ref.offset)),
    ref.face.normal,
  )
}

export function planeLabel(ref: PlaneRef): string {
  if (ref.kind === 'named') {
    const names = { XY: 'Top', XZ: 'Front', YZ: 'Right' } as const
    return ref.offset
      ? `${names[ref.name]} plane, ${ref.offset} mm up`
      : `${names[ref.name]} plane`
  }
  return ref.offset ? `A face, ${ref.offset} mm off` : 'A face'
}
