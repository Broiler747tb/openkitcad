import { makeFrame, NAMED_FRAMES, v3, type Frame } from '../core/math'
import type { LengthUnit, Matrix4, PlaneRef } from './types'
import { transformDirection, transformPoint } from './model'
import { lengthLabel } from '../core/units'

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

export type DatumPlaneRef = Exclude<PlaneRef, { kind: 'face' } | { kind: 'construction' }>

export function datumFrame(ref: DatumPlaneRef): Frame {
  if (ref.kind === 'named') {
    const base = NAMED_FRAMES[ref.name]
    return { ...base, origin: v3.add(base.origin, v3.scale(base.normal, ref.offset)) }
  }
  return tiltedFrame(ref.name, ref.tiltAxis, ref.angle, ref.offset)
}

export function offsetFrame(frame: Frame, offset: number): Frame {
  return offset ? { ...frame, origin: v3.add(frame.origin, v3.scale(frame.normal, offset)) } : frame
}

export function frameFromPlaneRefLocal(
  ref: PlaneRef,
  resolved: Frame | undefined,
  planes?: ReadonlyMap<string, Frame>,
): Frame | null {
  if (ref.kind === 'construction') {
    const frame = planes?.get(ref.featureId)
    return frame ? offsetFrame(frame, ref.offset) : (resolved ?? null)
  }
  return ref.kind === 'face' ? (resolved ?? null) : datumFrame(ref)
}

export function midplaneFrame(a: Frame, b: Frame): Frame | null {
  if (Math.abs(v3.dot(a.normal, b.normal)) > 1 - 1e-9) {
    const along = v3.dot(v3.sub(b.origin, a.origin), a.normal) / 2
    if (Math.abs(along) < 1e-9) return null
    return offsetFrame(a, along)
  }
  const direction = v3.norm(v3.cross(a.normal, b.normal))
  const da = v3.dot(a.origin, a.normal)
  const db = v3.dot(b.origin, b.normal)
  const point = v3.scale(
    v3.add(
      v3.scale(v3.cross(b.normal, direction), da),
      v3.scale(v3.cross(direction, a.normal), db),
    ),
    1 / v3.dot(direction, v3.cross(a.normal, b.normal)),
  )
  return makeFrame(point, v3.norm(v3.sub(a.normal, b.normal)), direction)
}

export function transformFrame(frame: Frame, m: Matrix4): Frame {
  return {
    origin: transformPoint(m, frame.origin),
    xDir: transformDirection(m, frame.xDir),
    yDir: transformDirection(m, frame.yDir),
    normal: transformDirection(m, frame.normal),
  }
}

export function planeLabel(ref: PlaneRef, unit: LengthUnit = 'mm'): string {
  const names = { XY: 'Top', XZ: 'Front', YZ: 'Right' } as const
  if (ref.kind === 'named') {
    return ref.offset
      ? `${names[ref.name]} plane, ${lengthLabel(ref.offset, unit)} up`
      : `${names[ref.name]} plane`
  }
  if (ref.kind === 'angled') {
    return `${names[ref.name]} plane tipped ${ref.angle}°`
  }
  if (ref.kind === 'construction') {
    return ref.offset ? `A plane, ${lengthLabel(ref.offset, unit)} off` : 'A construction plane'
  }
  return ref.offset ? `A face, ${lengthLabel(ref.offset, unit)} off` : 'A face'
}
