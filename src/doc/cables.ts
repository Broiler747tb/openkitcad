export type CableEntryKind = 'grommet' | 'gland' | 'tie' | 'clamp'

export interface GlandSpec {
  id: string
  label: string
  /** Panel hole the gland's thread passes through. */
  hole: number
  /** Smallest and largest cable the gland grips. */
  cable: [number, number]
  /** Across the flats of the lock nut. */
  nut: number
  /** How thick the lock nut is. */
  nutHeight: number
}

export const GLANDS: GlandSpec[] = [
  { id: 'PG7', label: 'PG7', hole: 12.5, cable: [3, 6.5], nut: 19, nutHeight: 4 },
  { id: 'PG9', label: 'PG9', hole: 15.2, cable: [4, 8], nut: 22, nutHeight: 4 },
  { id: 'PG11', label: 'PG11', hole: 18.6, cable: [5, 10], nut: 24, nutHeight: 5 },
  { id: 'PG13.5', label: 'PG13.5', hole: 20.4, cable: [6, 12], nut: 27, nutHeight: 5 },
  { id: 'PG16', label: 'PG16', hole: 22.5, cable: [10, 14], nut: 30, nutHeight: 5 },
  { id: 'M12', label: 'M12 x 1.5', hole: 12.5, cable: [3, 6.5], nut: 17, nutHeight: 4 },
  { id: 'M16', label: 'M16 x 1.5', hole: 16.5, cable: [4, 8], nut: 22, nutHeight: 4 },
  { id: 'M20', label: 'M20 x 1.5', hole: 20.5, cable: [6, 12], nut: 25, nutHeight: 5 },
  { id: 'M25', label: 'M25 x 1.5', hole: 25.5, cable: [11, 17], nut: 30, nutHeight: 6 },
]

export function glandSpec(id: string): GlandSpec {
  return GLANDS.find((gland) => gland.id === id) ?? GLANDS[1]
}

export interface TieSpec {
  id: string
  label: string
  width: number
  thickness: number
}

export const TIES: TieSpec[] = [
  { id: 'small', label: '2.5 mm', width: 2.5, thickness: 1.2 },
  { id: 'medium', label: '3.6 mm', width: 3.6, thickness: 1.4 },
  { id: 'large', label: '4.8 mm', width: 4.8, thickness: 1.6 },
]

export function tieSpec(id: string): TieSpec {
  return TIES.find((tie) => tie.id === id) ?? TIES[2]
}

export const CABLE_ENTRIES: Array<{ value: CableEntryKind; label: string; hint: string }> = [
  {
    value: 'grommet',
    label: 'Grommet Hole',
    hint: 'A rounded hole for the cable, chamfered both sides so nothing cuts into it.',
  },
  {
    value: 'gland',
    label: 'Cable Gland',
    hint: 'The panel hole a screw-in gland needs, with room for its nut inside.',
  },
  {
    value: 'tie',
    label: 'Zip-tie Anchor',
    hint: 'A small bridge on the wall to strap the cable to.',
  },
  {
    value: 'clamp',
    label: 'Strain Relief',
    hint: 'Two screw posts and a bar that pinches the cable so pulls never reach the joint.',
  },
]

export function glandFor(cable: number): GlandSpec | null {
  return GLANDS.find((gland) => cable >= gland.cable[0] && cable <= gland.cable[1]) ?? null
}
