import { v2, type Vec2 } from '../core/math'
import type { Sketch2D } from './types'

export interface Draft {
  anchors: Vec2[]
  anchorIds: Array<string | null>
}

export const emptyDraft = (): Draft => ({ anchors: [], anchorIds: [] })

/** Use the solved endpoint, not the old cursor position, for the next segment. */
export function continueLine(sketch: Sketch2D, endpointId: string): Draft {
  const p = sketch.points.find(p => p.id === endpointId)
  return p ? { anchors: [[p.x, p.y]], anchorIds: [p.id] } : emptyDraft()
}

/** Reject degenerate circles without silently enlarging valid small circles. */
export function circleRadius(centre: Vec2, edge: Vec2): number | null {
  const radius = v2.dist(centre, edge)
  return Number.isFinite(radius) && radius > 0 ? radius : null
}
