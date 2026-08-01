import { frameToLocal, frameToWorld, v3, type Frame, type Vec2, type Vec3 } from '../core/math'
import { placementToWorld } from '../doc/placement'
import { getPart } from '../catalogue'
import { frameFromPlaneRefLocal } from '../doc/planes'
import { INSERTS, SCREWS, THREAD_SIZES, type FastenerKind, type ThreadSize } from '../fasteners'
import type { HoleFeature, OkcDocument, StandoffFeature } from '../doc/types'
import type { ShapeResult } from '../kernel/types'

/**
 * Ghosts of the screws and inserts a design is drilled for.
 *
 * These are drawn in the viewport and are not part of the model: they have no
 * volume, they are never exported, and nothing can be built on them. The point
 * is only to answer the questions you cannot answer by looking at a hole -
 * whether the head clears the wall next to it, whether the screw comes out the
 * far side, whether an insert actually fits in the pillar you gave it.
 *
 * So they are rough on purpose. A screw is a shaft and a head, with no thread
 * and no drive; modelling the hex socket would cost triangles to tell the user
 * something they already know.
 */
export interface FastenerGhost {
  id: string
  /** Brass for an insert, steel for a screw - it reads at a glance. */
  metal: 'brass' | 'steel'
  /** Where the top of the fastener sits, in world mm. */
  at: Vec3
  /** Unit vector pointing out of the material, along the fastener's axis. */
  up: Vec3
  shaftDiameter: number
  shaftLength: number
  headDiameter: number
  headHeight: number
  /** A cone rather than a cylinder, for a countersunk head. */
  countersunk: boolean
  /** How far below the surface the underside of the head sits. */
  headSink: number
}


/**
 * Where a feature's holes actually are, in its own plane.
 *
 * The kernel has its own copy of this. Sharing it would mean importing the
 * build module, which drags all of OpenCascade onto the main thread, so the
 * dozen lines are repeated rather than the eleven megabytes.
 */
function positionsOf(
  feature: HoleFeature | StandoffFeature,
  frame: Frame,
  doc: OkcDocument,
): Vec2[] {
  const source = feature.source
  if (source.kind === 'explicit') return source.positions
  const placement = doc.placements.find((p) => p.id === source.placementId)
  if (!placement || !placement.visible) return []
  const part = getPart(placement.partId)
  if (!part?.mountingHoles) return []
  const wanted = source.holeIds?.length
    ? part.mountingHoles.filter((h) => source.holeIds!.includes(h.id))
    : part.mountingHoles
  return wanted.map((h) => frameToLocal(frame, placementToWorld(placement, [h.x, h.y, 0])))
}

/** The thread size closest to a diameter, for holes that were never told one. */
function nearestSize(diameter: number, of: (size: ThreadSize) => number): ThreadSize {
  let best: ThreadSize = 'M3'
  let bestGap = Infinity
  for (const size of THREAD_SIZES) {
    const gap = Math.abs(of(size) - diameter)
    if (gap < bestGap) {
      bestGap = gap
      best = size
    }
  }
  return best
}

/**
 * What is going into a hole that was never told what was going into it.
 *
 * Holes generated from a placed board carry no fastener tag - they predate the
 * screws menu - but they need not be guessed at either. The catalogue part
 * names the screw its own mounting holes take, and that is the authority; a Pi
 * says M2.5 and there is nothing to infer. Only when a part omits it does this
 * fall back to matching diameters, and then against the figure the hole was
 * actually built from rather than a bare number.
 *
 * An explicit hole with no tag still gets nothing. Somebody drew that circle
 * themselves and there is no telling whether it is for a screw or a cable.
 */
function inferFastener(
  feature: HoleFeature | StandoffFeature,
  doc: OkcDocument,
): { kind: FastenerKind; size: ThreadSize } | null {
  if (feature.fastener) return feature.fastener
  const source = feature.source
  if (source.kind !== 'placement') return null

  const placement = doc.placements.find((p) => p.id === source.placementId)
  const part = placement ? getPart(placement.partId) : undefined
  const named = part?.mountingHoles?.[0]?.screw
  const size: ThreadSize =
    named && (THREAD_SIZES as string[]).includes(named)
      ? (named as ThreadSize)
      : feature.kind === 'standoff'
        ? nearestSize(feature.boreDiameter, (t) => SCREWS[t].tapping)
        : nearestSize(feature.diameter, (t) => SCREWS[t].clearance)

  if (feature.kind === 'standoff') {
    // Whether the pillar takes a screw straight or an insert is not recorded,
    // so it is read back off the bore: whichever of the two it was drilled for
    // is the one it is closer to. They are far enough apart that this is not a
    // close call - an M3 taps at 2.5 and takes an insert at 4.
    const toTap = Math.abs(feature.boreDiameter - SCREWS[size].tapping)
    const toInsert = Math.abs(feature.boreDiameter - INSERTS[size].pilot)
    return { kind: toInsert < toTap ? 'insert' : 'tapped', size }
  }

  const kind: FastenerKind =
    feature.style === 'counterbore'
      ? 'counterbore'
      : feature.style === 'countersink'
        ? 'countersink'
        : feature.style === 'tapped'
          ? 'tapped'
          : 'clearance'
  return { kind, size }
}

/** How far the solid reaches below a plane, along that plane's normal. */
function depthBelow(frame: Frame, shape: ShapeResult | undefined): number {
  if (!shape) return 0
  const [x0, y0, z0, x1, y1, z1] = shape.bounds
  let lowest = 0
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const d = v3.dot(v3.sub([x, y, z], frame.origin), frame.normal)
        if (d < lowest) lowest = d
      }
    }
  }
  return -lowest
}

/**
 * Work out every ghost the document calls for.
 *
 * Holes and pillars made from the screws and pillars menu say what they are for.
 * Ones generated from a placed board do not, but the board itself names the
 * screw its mounting holes take, so those get a ghost as well - see
 * inferFastener. A hole someone drew by hand and said nothing about stays bare:
 * there is no telling whether it is for a screw or a cable gland.
 */
export function fastenerGhosts(doc: OkcDocument, shapes: ShapeResult[]): FastenerGhost[] {
  const out: FastenerGhost[] = []

  for (const body of doc.bodies) {
    if (!body.visible) continue
    const shape = shapes.find((s) => s.id === body.id)

    for (const feature of body.features) {
      if (feature.suppressed) continue
      if (feature.kind !== 'hole' && feature.kind !== 'standoff') continue
      const tag = inferFastener(feature, doc)
      if (!tag) continue

      const frame = frameFromPlaneRefLocal(feature.plane)
      const insert = tag.kind === 'insert'
      const screw = SCREWS[tag.size]
      const spec = INSERTS[tag.size]

      positionsOf(feature, frame, doc).forEach((position, index) => {
        const base = frameToWorld(frame, position)
        // A pillar puts its opening at the top of the pillar, not on the
        // surface the pillar stands on.
        const rise = feature.kind === 'standoff' ? feature.height : 0
        const at = v3.add(base, v3.scale(frame.normal, rise))

        if (insert) {
          out.push({
            id: `${feature.id}-${index}`,
            metal: 'brass',
            at,
            up: frame.normal,
            shaftDiameter: spec.outerDiameter,
            shaftLength: spec.length,
            headDiameter: 0,
            headHeight: 0,
            countersunk: false,
            headSink: 0,
          })
          return
        }

        // A screw long enough to show what it is doing. Into a blind hole that
        // is the depth of the hole; through a part it is the thickness plus a
        // little, so the tip poking out the far side is visible - which is the
        // thing you most want to catch.
        const blind =
          feature.kind === 'standoff'
            ? feature.boreDepth
            : feature.depth === 'through'
              ? null
              : feature.depth
        const through = depthBelow(frame, shape) + 2
        out.push({
          id: `${feature.id}-${index}`,
          metal: 'steel',
          at,
          up: frame.normal,
          shaftDiameter: screw.major,
          shaftLength: blind ?? through,
          headDiameter:
            feature.kind === 'hole' && feature.style === 'countersink'
              ? screw.countersunkDiameter
              : screw.headDiameter,
          headHeight: screw.headHeight,
          countersunk: feature.kind === 'hole' && feature.style === 'countersink',
          headSink:
            feature.kind === 'hole' && feature.style === 'counterbore'
              ? (feature.counterboreDepth ?? 0)
              : 0,
        })
      })
    }
  }

  return out
}
