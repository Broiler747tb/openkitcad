/**
 * The catalogue part schema.
 *
 * This file is the contract a contributor works against when adding a part, so
 * it is written to be read by someone with a caliper and no CAD background.
 *
 * Design rule: the JSON is the *engineering truth*. Outline, mounting holes,
 * keepouts and connector openings are what the app generates real geometry
 * from, and they must be measured, not eyeballed. A prettier visual (a GLB or a
 * vendor STEP file) is optional decoration layered on top and is never used to
 * derive geometry. That split is what lets someone contribute a usable part in
 * fifteen minutes without touching a modelling tool.
 *
 * Coordinate convention for every part: the part lies in its own XY plane with
 * Z up, and the origin is the lower-left corner of its bounding outline. That
 * matches how datasheets dimension mounting holes, so numbers can be copied
 * straight across.
 */
import type { Vec2 } from '../core/math'

/**
 * Categories are deliberately narrow.
 *
 * An earlier version lumped every circuit board under "board", which meant a
 * Raspberry Pi and an Arduino Nano sat in the same list as a 40 mm OLED. People
 * do not shop that way: they think "I need a single-board computer", or "I need
 * a USB socket for this panel". Narrow categories make the list scannable
 * without a search, which is the point of having one.
 */
export type PartCategory =
  | 'sbc'
  | 'mcu'
  | 'connector'
  | 'display'
  | 'sensor'
  | 'power'
  | 'fastener'
  | 'extrusion'
  | 'motor'
  | 'motion'

/** A hole the app can project into whatever the part is mounted on. */
export interface MountingHole {
  id: string
  x: number
  y: number
  /** Hole diameter in the part itself, in mm. */
  diameter: number
  /** Screw this hole is designed for, e.g. "M2.5". Drives standoff sizing. */
  screw?: string
  label?: string
}

/**
 * A volume that must stay clear: a tall capacitor, the underside of a board,
 * the swept space a cable needs. Used by the clearance checker.
 */
export interface Keepout {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  /** Base height above the part origin. */
  z: number
  /** How tall the keepout is from `z`. */
  height: number
}

/**
 * A connector that may need an opening cut through an enclosure wall.
 *
 * Openings are rectangular unless stated otherwise. Round ones matter more than
 * they look: a barrel jack or an audio socket cut as a rectangle is a ruined
 * panel, and those are exactly the parts a beginner reaches for first.
 */
export interface Connector {
  id: string
  label: string
  /** Which side of the part outline the connector faces. */
  side: '+x' | '-x' | '+y' | '-y'
  /** Centre of the opening in part coordinates. */
  x: number
  y: number
  z: number
  /** Rectangular by default. */
  shape?: 'rect' | 'circle'
  /** Size of a rectangular opening, before tolerance. */
  width: number
  height: number
  /** Diameter of a round opening. Used when `shape` is "circle". */
  diameter?: number
  /** How far the connector body sticks out past the outline. */
  protrusion: number
}

export interface Electrical {
  /** Supply voltage(s) the part accepts. */
  voltage?: number[]
  /** Typical current draw in amps. */
  currentTypical?: number
  /** Worst-case current draw in amps, used for the power budget warning. */
  currentPeak?: number
  note?: string
}

/** A pin header, described as a grid so the app can draw and label it. */
export interface PinHeader {
  id: string
  label: string
  x: number
  y: number
  rows: number
  cols: number
  /** Centre-to-centre spacing, almost always 2.54 mm. */
  pitch: number
  /** Optional per-pin names, in column-major order. */
  pins?: string[]
}

/** A raised block drawn on a generated board so it reads as the real thing. */
export interface Bump {
  x: number
  y: number
  w: number
  h: number
  z: number
  height: number
  colour: string
  label?: string
}

/**
 * How the part is turned into geometry. `board` covers anything flat with a
 * hole pattern, which is most of what a tinkerer mounts; the others are
 * parametric recipes for part families where a generic outline would be
 * useless.
 */
export type PartGeometry =
  | {
      kind: 'board'
      outline:
        | { shape: 'rect'; w: number; h: number; cornerRadius?: number }
        | { shape: 'poly'; points: Vec2[] }
      thickness: number
      bumps?: Bump[]
    }
  | {
      kind: 'extrusion'
      /** Slot profile, e.g. 20 for 2020. */
      size: number
      length: number
      /** Number of slots; 4 for standard, 3 for corner profiles. */
      slots?: number
    }
  | {
      kind: 'screw'
      thread: string
      /** Major diameter in mm. */
      diameter: number
      /** Shank length under the head. */
      length: number
      head: 'socket' | 'button' | 'countersunk' | 'pan'
      headDiameter: number
      headHeight: number
    }
  | {
      kind: 'insert'
      thread: string
      /** Outside diameter of the knurled body. */
      outerDiameter: number
      length: number
      /** Recommended hole in the plastic. */
      pilotDiameter: number
    }
  | {
      kind: 'standoff'
      thread: string
      length: number
      /** Across-flats of the hex body. */
      acrossFlats: number
      style: 'male-female' | 'female-female'
    }
  | {
      kind: 'motor'
      /** Square frame size, e.g. 42.3 for NEMA 17. */
      frame: number
      bodyLength: number
      shaftDiameter: number
      shaftLength: number
      /** Raised boss around the shaft. */
      bossDiameter: number
      bossHeight: number
      /** Bolt circle for the four mounting screws. */
      boltSpacing: number
    }
  | {
      kind: 'bearing'
      innerDiameter: number
      outerDiameter: number
      width: number
    }
  /**
   * A socket, plug or panel-mount fitting.
   *
   * Modelled front-on: the part's local origin is the lower-left corner of its
   * body, the body extends backwards behind the panel in -Y, and the mating
   * face points along +Y. Placing one against a wall and generating port
   * openings then cuts exactly the right hole.
   */
  | {
      kind: 'connector'
      /** Body sitting behind the panel. */
      bodyWidth: number
      bodyHeight: number
      bodyDepth: number
      /** How far it protrudes in front of the panel. Often zero. */
      protrusion: number
      /** The hole this needs in the panel. */
      cutout:
        | { shape: 'rect'; w: number; h: number; cornerRadius?: number }
        | { shape: 'circle'; d: number }
      /** Panel thickness the part is designed to clamp onto, if it is panel mount. */
      panelThickness?: number
    }

export type VisualSpec =
  | { kind: 'generated' }
  | { kind: 'glb'; src: string }
  | { kind: 'step'; src: string }

export interface CataloguePart {
  id: string
  name: string
  category: PartCategory
  manufacturer?: string
  /** One line a beginner can understand, shown under the name. */
  summary: string
  geometry: PartGeometry
  mountingHoles?: MountingHole[]
  keepouts?: Keepout[]
  connectors?: Connector[]
  electrical?: Electrical
  pinHeaders?: PinHeader[]
  links?: Array<{ label: string; url: string }>
  visual?: VisualSpec
  /** Free-text search terms, e.g. "pi", "sbc", "linux". */
  tags?: string[]
  /**
   * How much to trust these numbers. Surfaced in the part inspector, because a
   * catalogue that quietly mixes datasheet values with someone's best guess is
   * worse than no catalogue: it costs the user a mis-cut panel and their trust.
   *
   * - `datasheet`   taken from an official mechanical drawing
   * - `measured`    measured from a physical part with calipers
   * - `approximate` close enough to lay out around, verify before cutting
   */
  confidence: 'datasheet' | 'measured' | 'approximate'
  /** Where the numbers came from, and specifically what is *not* verified. */
  source: string
}

export const CONFIDENCE_LABEL: Record<CataloguePart['confidence'], string> = {
  datasheet: 'From official drawing',
  measured: 'Measured from a real part',
  approximate: 'Approximate — check before cutting',
}

/** Colour used in the viewport for each category. */
export const CATEGORY_COLOUR: Record<PartCategory, string> = {
  sbc: '#1f6f4a',
  mcu: '#1c7a6b',
  connector: '#8b9096',
  display: '#20262c',
  sensor: '#2b5f86',
  power: '#7a4436',
  fastener: '#9aa3ad',
  extrusion: '#8d949c',
  motor: '#3a3f45',
  motion: '#7f878f',
}

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  sbc: 'Single-board computers',
  mcu: 'Microcontroller boards',
  connector: 'Ports & connectors',
  display: 'Screens & displays',
  sensor: 'Sensors & modules',
  power: 'Power',
  fastener: 'Screws & standoffs',
  extrusion: 'Extrusion & framing',
  motor: 'Motors & servos',
  motion: 'Bearings & linear motion',
}

/** One line under each category heading, for people who do not know the jargon. */
export const CATEGORY_BLURB: Record<PartCategory, string> = {
  sbc: 'Runs a full operating system. Raspberry Pi and friends.',
  mcu: 'Runs one program. Arduino, Pico, ESP32.',
  connector: 'Sockets and plugs, with the panel cutout each one needs.',
  display: 'Screens you can mount in a panel.',
  sensor: 'Things that measure the world.',
  power: 'Supplies, regulators and battery holders.',
  fastener: 'Screws, nuts, inserts and pillars.',
  extrusion: 'Aluminium profile for building frames.',
  motor: 'Steppers, servos and gearmotors.',
  motion: 'Bearings, rods and everything that slides or spins.',
}

/** Bounding footprint of a part in its own XY plane, in mm. */
export function partFootprint(part: CataloguePart): { w: number; h: number; z: number } {
  const g = part.geometry
  switch (g.kind) {
    case 'board':
      return g.outline.shape === 'rect'
        ? { w: g.outline.w, h: g.outline.h, z: g.thickness }
        : {
            w: Math.max(...g.outline.points.map((p) => p[0])),
            h: Math.max(...g.outline.points.map((p) => p[1])),
            z: g.thickness,
          }
    case 'extrusion':
      return { w: g.length, h: g.size, z: g.size }
    case 'screw':
      return { w: g.headDiameter, h: g.headDiameter, z: g.length + g.headHeight }
    case 'insert':
      return { w: g.outerDiameter, h: g.outerDiameter, z: g.length }
    case 'standoff':
      return { w: g.acrossFlats, h: g.acrossFlats, z: g.length }
    case 'motor':
      return { w: g.frame, h: g.frame, z: g.bodyLength }
    case 'bearing':
      return { w: g.outerDiameter, h: g.outerDiameter, z: g.width }
    case 'connector':
      return { w: g.bodyWidth, h: g.bodyDepth + g.protrusion, z: g.bodyHeight }
  }
}
