import {
  assembleWire,
  downcast,
  draw,
  genericSweep,
  getOC,
  makeBSplineApproximation,
  makeCylinder,
  type Wire,
} from 'replicad'
import type { Vec2, Vec3 } from '../core/math'
import { designation, minorDiameter, nearestThread, tapDrill, threadDepth } from '../doc/threads'
import type { Feature, ThreadFeature } from '../doc/types'
import { place } from './fitSteps'
import { cut, fuse, nameShape, type NamedShape, type OC, type OcShape } from './naming'
import { rawBoolean } from './rawBoolean'
import { roundFace, type RoundFace } from './roundFace'
import type { SolidStage } from './solidSteps'

type Solid = {
  wrapped: OcShape
  delete(): void
}

const EMBED = 0.2
const RUN_OUT = 0.2
const CLEAR = 0.3
const POINTS_PER_TURN = 24
const TIP = 0.12
const FLANK = Math.tan(Math.PI / 6)
const FLANK_OFFSET = 1 / Math.cos(Math.PI / 6)

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

export function maxClearance(pitch: number, external: boolean): number {
  return (external ? pitch / 16 : (3 * pitch) / 32) / FLANK_OFFSET
}

export function flankHalfWidth(
  pitch: number,
  radius: number,
  clearance: number,
  external: boolean,
  at: number,
): number {
  const depth = threadDepth(pitch)
  const widen = clearance * FLANK_OFFSET
  return external
    ? pitch / 8 + (at - (radius - depth)) * FLANK + widen
    : (3 * pitch) / 8 - (at - radius) * FLANK + widen
}

export function threadProfile(
  pitch: number,
  radius: number,
  clearance: number,
  external: boolean,
): Vec2[] {
  const depth = threadDepth(pitch)
  const room = Math.min(clearance, maxClearance(pitch, external))
  const widen = room * FLANK_OFFSET
  const base = external ? radius - depth - room : radius
  const crest = external ? radius : radius + depth + room
  const halfBase = external ? (3 * pitch) / 8 - widen : (3 * pitch) / 8 + widen
  const halfCrest = Math.max(external ? pitch / 16 - widen : pitch / 16 + widen, TIP)
  return [
    [base - EMBED, -halfBase],
    [base - EMBED, halfBase],
    [base, halfBase],
    [crest, halfCrest],
    [crest, -halfCrest],
    [base, -halfBase],
  ]
}

export function leadIn(pitch: number, radius: number, clearance: number, external: boolean) {
  return threadProfile(pitch, radius, clearance, external)[2][1] + CLEAR
}

function helix(
  pitch: number,
  height: number,
  radius: number,
  from: number,
  lefthand: boolean,
): Wire {
  const turns = height / pitch
  const count = Math.max(8, Math.ceil(turns * POINTS_PER_TURN))
  const points: Vec3[] = Array.from({ length: count + 1 }, (_, index) => {
    const along = index / count
    const angle = (lefthand ? -2 : 2) * Math.PI * turns * along
    return [radius * Math.cos(angle), radius * Math.sin(angle), from + height * along]
  })
  const edge = makeBSplineApproximation(points, { tolerance: 1e-5, degMin: 3, degMax: 5 })
  try {
    return assembleWire([edge])
  } finally {
    quietly(edge as never)
  }
}

function ridge(
  pitch: number,
  radius: number,
  clearance: number,
  external: boolean,
  lefthand: boolean,
  from: number,
  height: number,
): Solid {
  const points = threadProfile(pitch, radius, clearance, external)
  const pen = draw([points[0][0], points[0][1] + from])
  for (const [x, z] of points.slice(1)) pen.lineTo([x, z + from])
  const profile = pen.close().sketchOnPlane('XZ') as unknown as { wire: never }
  const path = helix(pitch, height, points[2][0], from, lefthand)
  try {
    return genericSweep(profile.wire, path, { frenet: true }) as unknown as Solid
  } finally {
    quietly(path as never)
  }
}

function turnDown(
  pitch: number,
  radius: number,
  clearance: number,
  from: number,
  height: number,
): Solid {
  const room = Math.min(clearance, maxClearance(pitch, true))
  const core = radius - threadDepth(pitch) - room
  const outer = makeCylinder(radius + EMBED, height, [0, 0, from], [0, 0, 1]) as unknown as Solid
  const inner = makeCylinder(core, height + 2, [0, 0, from - 1], [0, 0, 1]) as unknown as Solid
  try {
    return rawBoolean<Solid>('cut', outer, [inner], 'The thread could not be built.')
  } finally {
    quietly(outer)
    quietly(inner)
  }
}

interface ThreadStep {
  kind: 'cut' | 'fuse'
  solids: Solid[]
}

function threadSolids(
  feature: ThreadFeature,
  face: RoundFace,
  pitch: number,
  top: number,
  length: number,
): ThreadStep[] {
  if (!face.convex) {
    const lead = leadIn(pitch, face.radius, feature.clearance, false)
    const high = Math.min(top, -lead)
    const low = Math.max(top - length, lead - face.length)
    return [
      {
        kind: 'cut',
        solids: [
          ridge(pitch, face.radius, feature.clearance, false, feature.lefthand, low, high - low),
        ],
      },
    ]
  }
  const start = top - length
  const tip = top > -1e-6 ? RUN_OUT : 0
  const lead = leadIn(pitch, face.radius, 0, true)
  return [
    { kind: 'cut', solids: [turnDown(pitch, face.radius, 0, start, length + tip)] },
    {
      kind: 'fuse',
      solids: [
        ridge(pitch, face.radius, 0, true, feature.lefthand, start + lead, length - 2 * lead),
      ],
    },
  ]
}

export function runThreadStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'thread') return false
  const thread = feature as ThreadFeature
  const oc = getOC() as unknown as OC
  if (!thread.faces.length) {
    stage.report('error', 'A thread needs a round face to run along.')
    return true
  }
  if (!thread.auto && (!(thread.pitch > 0) || !(thread.nominal > 0))) {
    stage.report('error', 'A thread needs a size and a pitch.')
    return true
  }
  if (!thread.modelled) return true
  const owned: Solid[] = []
  const tools: NamedShape[] = []
  const byBody = new Map<string, ThreadStep[]>()
  try {
    for (const [index, ref] of thread.faces.entries()) {
      const body = stage.need(ref.bodyId)
      if (!body) return true
      const anchor = thread.anchors[index] ?? thread.anchors[0] ?? [0, 0, 0]
      const face = roundFace(stage, ref, anchor, false, {
        notRound: 'A thread goes on a round face.',
        hint: 'Pick the side of a peg, or the inside of a hole.',
      })
      if (!face) return true
      const across = 2 * face.radius
      const size = thread.auto
        ? nearestThread(across, !face.convex)
        : { nominal: thread.nominal, coarse: thread.pitch }
      const pitch = size.coarse
      const name = designation(size.nominal, pitch)
      const fits = face.convex ? size.nominal : minorDiameter(size.nominal, pitch)
      if (!thread.auto && Math.abs(across - fits) > Math.max(0.3, 0.05 * fits)) {
        const fitting = nearestThread(across, !face.convex)
        stage.report(
          'error',
          face.convex
            ? `That peg is ${across.toFixed(2)} mm across, but an ${name} thread is ${size.nominal} mm.`
            : `That hole is ${across.toFixed(2)} mm across, but an ${name} thread wants a ${tapDrill(size.nominal, pitch)} mm hole.`,
          `An ${designation(fitting.nominal, fitting.coarse)} fits it. Pick that, or choose Auto.`,
        )
        return true
      }
      const offset = Math.max(0, Math.min(thread.offset, face.length))
      const wanted = thread.full ? face.length - offset : thread.length
      const length = Math.max(0, Math.min(wanted, face.length - offset))
      if (length < pitch + 2 * leadIn(pitch, face.radius, thread.clearance, face.convex)) {
        stage.report(
          'error',
          'There is not enough of that face to fit one turn of the thread.',
          'Use a finer pitch, a shorter offset, or a longer face.',
        )
        return true
      }
      if (wanted > length + 1e-6) {
        stage.report(
          'warning',
          'The thread is longer than the face it runs along, so it stops at the end.',
          'Shorten it, or turn Full Length on.',
        )
      }
      const room = maxClearance(pitch, false)
      if (!face.convex && thread.clearance > room + 1e-9) {
        stage.report(
          'warning',
          `An ${name} thread has room for ${room.toFixed(2)} mm, so that is what it was given.`,
          'A finer pitch leaves less room between the turns. Use a coarser pitch for a looser fit.',
        )
      }
      const steps = threadSolids(thread, face, pitch, -offset, length).map((step) => ({
        kind: step.kind,
        solids: step.solids.map((solid) => {
          const placed = place(solid, face.frame) as Solid
          owned.push(placed)
          return placed
        }),
      }))
      byBody.set(ref.bodyId, [...(byBody.get(ref.bodyId) ?? []), ...steps])
    }
    for (const [bodyId, steps] of byBody) {
      steps.forEach((step, index) => {
        const body = stage.need(bodyId)
        if (!body) return
        const named = step.solids.map((solid, at) =>
          nameShape(
            oc,
            `${thread.id}:${step.kind}${index}-${at}`,
            downcast(solid.wrapped) as unknown as OcShape,
          ),
        )
        tools.push(...named)
        let next: NamedShape
        try {
          next = (step.kind === 'cut' ? cut : fuse)(oc, {
            featureId: thread.id,
            target: { shape: body.shape.wrapped, map: body.map },
            tools: named,
          })
        } catch (error) {
          if (error instanceof Error) throw error
          throw new Error(`Could not put the thread on ${stage.bodyName(bodyId)}.`)
        }
        stage.set(bodyId, next)
      })
    }
    return true
  } finally {
    for (const tool of tools) {
      tool.map.dispose()
      tool.shape.delete()
    }
    for (const solid of owned) quietly(solid)
  }
}
