import { frameToLocal, frameToWorld, v3, type Frame, type Vec2, type Vec3 } from '../core/math'
import { getPart, type CataloguePart } from '../catalogue'
import { frameFromPlaneRefLocal } from '../doc/planes'
import { INSERTS, SCREWS, THREAD_SIZES, type FastenerKind, type ThreadSize } from '../fasteners'
import type { HoleFeature, Matrix4, OkcDocument, StandoffFeature } from '../doc/types'
import type { BodyMesh, Instance } from '../kernel/types'
import {
  activeFeatures,
  findComponent,
  findOccurrence,
  invertRigidMatrix,
  multiplyMatrices,
  pathComponent,
  pathMatrix,
  transformDirection,
  transformPoint,
} from '../doc/model'
import type { Bounds } from '../doc/placement'

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

interface PlacedPart {
  part: CataloguePart | undefined
  matrix: Matrix4
  visible: boolean
}

function occurrencePart(
  doc: OkcDocument,
  source: { occurrencePath: string[]; contextPath: string[] },
): PlacedPart | null {
  if (!source.occurrencePath.length) return null
  const partMatrix = pathMatrix(doc, source.occurrencePath)
  const contextMatrix = pathMatrix(doc, source.contextPath)
  const componentId = pathComponent(doc, source.occurrencePath)
  const component = componentId ? findComponent(doc, componentId) : undefined
  if (!partMatrix || !contextMatrix || component?.source.kind !== 'catalogue') return null
  return {
    part: getPart(component.source.partId),
    matrix: multiplyMatrices(invertRigidMatrix(contextMatrix), partMatrix),
    visible: source.occurrencePath.every((id) => findOccurrence(doc, id)?.visible),
  }
}

function positionsOf(
  feature: HoleFeature | StandoffFeature,
  frame: Frame,
  doc: OkcDocument,
): Vec2[] {
  const source = feature.source
  if (source.kind === 'explicit') return source.positions
  const placed = occurrencePart(doc, source)
  if (!placed || !placed.visible) return []
  const holes = placed.part?.mountingHoles
  if (!holes) return []
  const wanted = source.holeIds?.length
    ? holes.filter((h) => source.holeIds!.includes(h.id))
    : holes
  return wanted.map((h) => frameToLocal(frame, transformPoint(placed.matrix, [h.x, h.y, 0])))
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

function inferFastener(
  feature: HoleFeature | StandoffFeature,
  doc: OkcDocument,
): { kind: FastenerKind; size: ThreadSize } | null {
  if (feature.fastener) return feature.fastener
  const source = feature.source
  if (source.kind !== 'occurrence') return null

  const part = occurrencePart(doc, source)?.part
  const named = part?.mountingHoles?.[0]?.screw
  const size: ThreadSize =
    named && (THREAD_SIZES as string[]).includes(named)
      ? (named as ThreadSize)
      : feature.kind === 'standoff'
        ? nearestSize(feature.boreDiameter, (t) => SCREWS[t].tapping)
        : nearestSize(feature.diameter, (t) => SCREWS[t].clearance)

  if (feature.kind === 'standoff') {
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

function depthBelow(frame: Frame, bounds: Bounds | undefined): number {
  if (!bounds) return 0
  const [x0, y0, z0, x1, y1, z1] = bounds
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

export function fastenerGhosts(
  doc: OkcDocument,
  instances: Instance[],
  meshes: ReadonlyMap<string, Pick<BodyMesh, 'bounds'>>,
): FastenerGhost[] {
  const out: FastenerGhost[] = []

  for (const feature of activeFeatures(doc)) {
    if (feature.kind !== 'hole' && feature.kind !== 'standoff') continue
    const bodyId = feature.kind === 'hole' ? feature.bodyId : feature.result.bodyId
    const targets = instances.filter(
      (instance) => instance.kind === 'body' && instance.bodyId === bodyId && instance.visible,
    )
    if (!targets.length) continue
    const tag = inferFastener(feature, doc)
    if (!tag) continue

    const frame = frameFromPlaneRefLocal(feature.plane)
    const insert = tag.kind === 'insert'
    const screw = SCREWS[tag.size]
    const spec = INSERTS[tag.size]
    const positions = positionsOf(feature, frame, doc)

    for (const instance of targets) {
      const bounds = meshes.get(instance.meshKey)?.bounds
      const up = v3.norm(transformDirection(instance.matrix, frame.normal))
      positions.forEach((position, index) => {
        const base = frameToWorld(frame, position)
        const rise = feature.kind === 'standoff' ? feature.height : 0
        const at = transformPoint(instance.matrix, v3.add(base, v3.scale(frame.normal, rise)))
        const id = `${instance.id}/${feature.id}-${index}`

        if (insert) {
          out.push({
            id,
            metal: 'brass',
            at,
            up,
            shaftDiameter: spec.outerDiameter,
            shaftLength: spec.length,
            headDiameter: 0,
            headHeight: 0,
            countersunk: false,
            headSink: 0,
          })
          return
        }

        const blind =
          feature.kind === 'standoff'
            ? feature.boreDepth
            : feature.depth === 'through'
              ? null
              : feature.depth
        const through = depthBelow(frame, bounds) + 2
        out.push({
          id,
          metal: 'steel',
          at,
          up,
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
