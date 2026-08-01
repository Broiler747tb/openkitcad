/**
 * Standard hole sizes for metric screws and heat-set inserts.
 *
 * This is a table rather than catalogue parts because these are not products.
 * A clearance hole for an M3 is 3.4 mm whoever made the screw, and looking it
 * up is exactly the twenty minutes this app exists to save. The catalogue holds
 * things you place in a design; this holds the numbers you drill.
 *
 * Sources are named per column below, because a CAD tool that quietly rounds a
 * fit is worse than one that makes you look it up yourself.
 */

export type ThreadSize = 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6'

export interface ScrewSpec {
  thread: ThreadSize
  /** Nominal outside diameter of the thread. */
  major: number
  /** ISO 273 "medium" fit: the normal choice for a bolt passing through. */
  clearance: number
  /** ISO 2306 tapping drill for the coarse pitch, near enough 75% thread. */
  tapping: number
  /** ISO 4762 socket head cap screw. */
  headDiameter: number
  headHeight: number
  /**
   * Countersunk head, across the top of the 90 degree cone.
   *
   * M3 upwards are ISO 10642 (hex socket countersunk). M2 and M2.5 are not in
   * that standard, so they are DIN 965, which has a smaller head - mixing the
   * two is deliberate, and noted here so nobody has to work out why the jump
   * from M2.5 to M3 is bigger than it looks.
   */
  countersunkDiameter: number
}

/**
 * Screws, in the sizes a bench actually holds.
 *
 * Every number here comes from a published standard, so these are exact rather
 * than typical.
 */
export const SCREWS: Record<ThreadSize, ScrewSpec> = {
  M2: { thread: 'M2', major: 2, clearance: 2.4, tapping: 1.6, headDiameter: 3.8, headHeight: 2, countersunkDiameter: 3.8 },
  'M2.5': { thread: 'M2.5', major: 2.5, clearance: 2.9, tapping: 2.05, headDiameter: 4.5, headHeight: 2.5, countersunkDiameter: 4.7 },
  M3: { thread: 'M3', major: 3, clearance: 3.4, tapping: 2.5, headDiameter: 5.5, headHeight: 3, countersunkDiameter: 6.72 },
  M4: { thread: 'M4', major: 4, clearance: 4.5, tapping: 3.3, headDiameter: 7, headHeight: 4, countersunkDiameter: 8.96 },
  M5: { thread: 'M5', major: 5, clearance: 5.5, tapping: 4.2, headDiameter: 8.5, headHeight: 5, countersunkDiameter: 11.2 },
  M6: { thread: 'M6', major: 6, clearance: 6.6, tapping: 5, headDiameter: 10, headHeight: 6, countersunkDiameter: 13.44 },
}

export interface InsertSpec {
  thread: ThreadSize
  outerDiameter: number
  length: number
  /** Hole to melt it into. Smaller than the outside, which is the point. */
  pilot: number
}

/**
 * Heat-set inserts.
 *
 * Unlike the screws above, these are NOT standardised. Every supplier's are a
 * different length and knurl, and the numbers below match the commonly sold
 * pattern rather than a specification. The UI says so, and the honest advice is
 * to measure the ones in your drawer and test-fit a single insert before
 * printing a whole enclosure.
 */
export const INSERTS: Record<ThreadSize, InsertSpec> = {
  M2: { thread: 'M2', outerDiameter: 3.5, length: 4, pilot: 3.2 },
  'M2.5': { thread: 'M2.5', outerDiameter: 4, length: 4.6, pilot: 3.6 },
  M3: { thread: 'M3', outerDiameter: 4.6, length: 5.7, pilot: 4 },
  M4: { thread: 'M4', outerDiameter: 5.6, length: 8.1, pilot: 5.1 },
  M5: { thread: 'M5', outerDiameter: 6.4, length: 9.5, pilot: 5.8 },
  M6: { thread: 'M6', outerDiameter: 8, length: 12.7, pilot: 7.3 },
}

export const THREAD_SIZES: ThreadSize[] = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6']

export type FastenerKind =
  /** The screw passes straight through. */
  | 'clearance'
  /** Passes through, with the head sunk below the surface. */
  | 'counterbore'
  /** Passes through, with the head finishing flush. */
  | 'countersink'
  /** The screw cuts its own thread in the plastic. */
  | 'tapped'
  /** A brass insert melted in, so the screw goes into metal. */
  | 'insert'

/** What a hole feature needs, worked out from a thread size and a kind. */
export interface HolePlan {
  style: 'simple' | 'counterbore' | 'countersink' | 'tapped'
  diameter: number
  counterboreDiameter?: number
  counterboreDepth?: number
  countersinkAngle?: number
  /** Depth suggested in the dialog. 0 means straight through. */
  suggestedDepth: number
  name: string
}

/**
 * Turn "M3, head sunk in" into the numbers a hole feature wants.
 *
 * Clearances added here are small and deliberate: a head that fits its
 * counterbore exactly will not go in once the print has a bit of elephant foot
 * on it, and a countersink cut to the exact head diameter leaves the screw
 * standing a hair proud.
 */
export function planHole(kind: FastenerKind, size: ThreadSize): HolePlan {
  const screw = SCREWS[size]
  switch (kind) {
    case 'clearance':
      return {
        style: 'simple',
        diameter: screw.clearance,
        suggestedDepth: 0,
        name: `${size} clearance hole`,
      }
    case 'counterbore':
      return {
        style: 'counterbore',
        diameter: screw.clearance,
        // Half a millimetre round the head, and a little depth over the head
        // height so it definitely sits below the surface.
        counterboreDiameter: screw.headDiameter + 0.5,
        counterboreDepth: screw.headHeight + 0.2,
        suggestedDepth: 0,
        name: `${size} counterbored hole`,
      }
    case 'countersink':
      return {
        style: 'countersink',
        diameter: screw.clearance,
        counterboreDiameter: screw.countersunkDiameter + 0.4,
        countersinkAngle: 90,
        suggestedDepth: 0,
        name: `${size} countersunk hole`,
      }
    case 'tapped':
      return {
        style: 'tapped',
        diameter: screw.tapping,
        // Deep enough for a few threads to engage without being a blind hole
        // the screw bottoms out in.
        suggestedDepth: Math.round(screw.major * 2.5 * 10) / 10,
        name: `${size} threaded hole`,
      }
    case 'insert': {
      const insert = INSERTS[size]
      return {
        style: 'simple',
        diameter: insert.pilot,
        // Half a millimetre under the insert, so it does not bottom out before
        // it is flush and push a bulge out the other side.
        suggestedDepth: Math.round((insert.length + 0.5) * 10) / 10,
        name: `${size} insert hole`,
      }
    }
  }
}
