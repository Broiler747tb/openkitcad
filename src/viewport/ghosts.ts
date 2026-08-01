import { frameToWorld, v3, type Frame, type Vec3 } from '../core/math'
import { frameFromPlaneRefLocal } from '../doc/planes'
import { INSERTS, SCREWS } from '../fasteners'
import type { OkcDocument } from '../doc/types'
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
 * Only features tagged with a fastener produce one, which in practice means the
 * ones made from the screws and pillars menu. A hole someone drew by hand is
 * just a hole - there is no way to know what is meant to go in it, and guessing
 * from the diameter would put an M3 ghost in a 3 mm cable gland.
 */
export function fastenerGhosts(doc: OkcDocument, shapes: ShapeResult[]): FastenerGhost[] {
  const out: FastenerGhost[] = []

  for (const body of doc.bodies) {
    if (!body.visible) continue
    const shape = shapes.find((s) => s.id === body.id)

    for (const feature of body.features) {
      if (feature.suppressed) continue
      if (feature.kind !== 'hole' && feature.kind !== 'standoff') continue
      const tag = feature.fastener
      if (!tag) continue
      if (feature.source.kind !== 'explicit') continue

      const frame = frameFromPlaneRefLocal(feature.plane)
      const insert = tag.kind === 'insert'
      const screw = SCREWS[tag.size]
      const spec = INSERTS[tag.size]

      feature.source.positions.forEach((position, index) => {
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
