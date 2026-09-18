import { downcast, getOC, makeBox, makeCylinder, sketchCircle } from 'replicad'
import type { Vec3 } from '../core/math'
import { partBounds } from '../catalogue/placement'
import { findOccurrence, transformPoint } from '../doc/model'
import type { EnclosureFeature, EnclosureMount, Feature, OkcDocument } from '../doc/types'
import {
  buildPortCutters,
  lidProportions,
  placedPart,
  transformShape,
  type PlacedPart,
} from './build'
import { boardBox, clipPositions, edgeClip, type BoardBox, type ClipSize } from './clipSteps'
import { nameShape, type OC, type OcShape } from './naming'
import { rawBoolean, type RawSolid } from './rawBoolean'
import type { SolidStage } from './solidSteps'

type Solid = RawSolid & { delete(): void }

const SKIRT = 1.2
const HOLD = 1.2
const EMBED = 0.2
const NOTCH = 8
const FLAT = 0.99
const CLIPS_PER_EDGE = 2
const CLIP: Omit<ClipSize, 'gap'> = { width: 8, post: 2.4, grip: 1.2, ledge: 1.2, hook: 1.2 }
const FAILED = 'The enclosure could not be built.'

interface Part {
  name: string
  mount: EnclosureMount
  placed: PlacedPart
  low: Vec3
  high: Vec3
}

export interface Room {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  top: number
}

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function flat(placed: PlacedPart): boolean {
  return placed.matrix[10] > FLAT
}

function worldBox(placed: PlacedPart, ticked: readonly string[]): [Vec3, Vec3] {
  const part = placed.part!
  let [x0, y0, z0, x1, y1, z1] = partBounds(part)
  for (const connector of part.connectors ?? []) {
    if (ticked.includes(connector.id)) continue
    if (connector.side === '+x') x1 = Math.max(x1, connector.x + connector.protrusion)
    if (connector.side === '-x') x0 = Math.min(x0, connector.x - connector.protrusion)
    if (connector.side === '+y') y1 = Math.max(y1, connector.y + connector.protrusion)
    if (connector.side === '-y') y0 = Math.min(y0, connector.y - connector.protrusion)
  }
  const low: Vec3 = [Infinity, Infinity, Infinity]
  const high: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) {
        const point = transformPoint(placed.matrix, [x, y, z])
        for (let i = 0; i < 3; i++) {
          low[i] = Math.min(low[i], point[i])
          high[i] = Math.max(high[i], point[i])
        }
      }
    }
  }
  return [low, high]
}

function clipTop(board: BoardBox, gap: number): number {
  return board.thickness + 0.1 + CLIP.hook + gap + CLIP.grip + CLIP.post
}

function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid {
  return makeBox([x0, y0, z0], [x1, y1, z1]) as unknown as Solid
}

function post(radius: number, x: number, y: number, z0: number, z1: number): Solid {
  return makeCylinder(radius, z1 - z0, [x, y, z0], [0, 0, 1]) as unknown as Solid
}

function ring(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  z0: number,
  z1: number,
  spent: Set<Solid>,
): Solid {
  const outer = block(x0, y0, z0, x1, y1, z1)
  const inner = block(
    x0 + thickness,
    y0 + thickness,
    z0 - 1,
    x1 - thickness,
    y1 - thickness,
    z1 + 1,
  )
  spent.add(outer)
  spent.add(inner)
  return rawBoolean<Solid>('cut', outer, [inner], FAILED)
}

function countersink(x: number, y: number, z: number, hole: number, head: number): Solid {
  const depth = (head - hole) / 2
  return sketchCircle(head / 2 + 0.5, { origin: [x, y, z + 0.5] }).loftWith(
    sketchCircle(hole / 2, { origin: [x, y, z - depth] }),
  ) as unknown as Solid
}

export function enclosureRoom(
  feature: EnclosureFeature,
  low: Vec3,
  high: Vec3,
  clipped: boolean,
): Room {
  const { wall, lidThickness: t, gap: g, clearance } = feature
  const prop = lidProportions(wall, t)
  const reach =
    feature.lid === 'snap' ? g + prop.skirt + prop.bead : feature.lid === 'screws' ? g + SKIRT : 0
  const side = Math.max(clearance, reach + 0.3, clipped ? g + CLIP.post + reach + 0.5 : 0)
  const top = high[2] + clearance
  return {
    x0: low[0] - side,
    y0: low[1] - side,
    z0: low[2] - feature.under,
    x1: high[0] + side,
    y1: high[1] + side,
    z1: feature.lid === 'snap' ? top + t : feature.lid === 'slide' ? top + t + g + HOLD : top,
    top,
  }
}

function screwLid(
  feature: EnclosureFeature,
  room: Room,
  additions: Solid[],
  cuts: Solid[],
  spent: Set<Solid>,
): Solid {
  const { wall, lidThickness: t, gap: g, screw } = feature
  const radius = Math.max(screw * 1.2, 2.4)
  const bottom = room.z0 - feature.floor
  const depth = Math.min(room.z1 - bottom - 1, screw * 4 + 2)
  const hole = screw + 0.5
  const head = Math.min(screw * 2, hole + 2 * (t - 0.6))
  const corners: Array<[number, number]> = [
    [room.x0 - radius, room.y0 - radius],
    [room.x1 + radius, room.y0 - radius],
    [room.x0 - radius, room.y1 + radius],
    [room.x1 + radius, room.y1 + radius],
  ]
  const pieces: Solid[] = []
  const holes: Solid[] = []
  for (const [x, y] of corners) {
    additions.push(post(radius, x, y, bottom, room.z1))
    cuts.push(post((screw - 0.4) / 2, x, y, room.z1 - depth, room.z1 + 1))
    pieces.push(post(radius, x, y, room.z1, room.z1 + t))
    holes.push(post(hole / 2, x, y, room.z1 - 1, room.z1 + t + 1))
    if (head - hole > 0.1) holes.push(countersink(x, y, room.z1 + t, hole, head))
  }
  const plate = block(
    room.x0 - wall,
    room.y0 - wall,
    room.z1,
    room.x1 + wall,
    room.y1 + wall,
    room.z1 + t,
  )
  const lip = Math.min(2, feature.clearance)
  if (lip > 0.3) {
    pieces.push(
      ring(
        room.x0 + g,
        room.y0 + g,
        room.x1 - g,
        room.y1 - g,
        SKIRT,
        room.z1 - lip,
        room.z1 + EMBED,
        spent,
      ),
    )
  }
  for (const solid of [plate, ...pieces, ...holes]) spent.add(solid)
  const joined = rawBoolean<Solid>('fuse', plate, pieces, FAILED)
  spent.add(joined)
  return rawBoolean<Solid>('cut', joined, holes, FAILED)
}

function snapLid(feature: EnclosureFeature, room: Room, cuts: Solid[], spent: Set<Solid>): Solid {
  const { wall, lidThickness: t, gap: g } = feature
  const prop = lidProportions(wall, t)
  const plug = block(room.x0 + g, room.y0 + g, room.z1 - t, room.x1 - g, room.y1 - g, room.z1)
  const skirt = ring(
    room.x0 + g,
    room.y0 + g,
    room.x1 - g,
    room.y1 - g,
    prop.skirt,
    room.z1 - t - prop.depth,
    room.z1 - t + EMBED,
    spent,
  )
  const bead = ring(
    room.x0 + g - prop.bead,
    room.y0 + g - prop.bead,
    room.x1 - g + prop.bead,
    room.y1 - g + prop.bead,
    prop.bead + prop.skirt / 2,
    room.z1 - prop.bandLo,
    room.z1 - prop.bandHi,
    spent,
  )
  for (const solid of [plug, skirt, bead]) spent.add(solid)
  cuts.push(
    block(
      room.x0 - prop.bead,
      room.y0 - prop.bead,
      room.z1 - prop.bandLo - g,
      room.x1 + prop.bead,
      room.y1 + prop.bead,
      room.z1 - prop.bandHi + g,
    ),
  )
  const middle = (room.y0 + room.y1) / 2
  cuts.push(
    block(
      room.x1 - EMBED,
      middle - NOTCH / 2,
      room.z1 - 1,
      room.x1 + wall + 1,
      middle + NOTCH / 2,
      room.z1 + 1,
    ),
  )
  return rawBoolean<Solid>('fuse', plug, [skirt, bead], FAILED)
}

function slideLid(
  feature: EnclosureFeature,
  room: Room,
  slot: number,
  cuts: Solid[],
  spent: Set<Solid>,
): Solid {
  const { wall, lidThickness: t, gap: g } = feature
  cuts.push(
    block(
      room.x0 - slot,
      room.y0 - slot,
      room.top - g,
      room.x1 + wall + 1,
      room.y1 + slot,
      room.top + t + g,
    ),
  )
  const plate = block(
    room.x0 - slot + g,
    room.y0 - slot + g,
    room.top,
    room.x1 + wall + 2,
    room.y1 + slot - g,
    room.top + t,
  )
  const pull = block(
    room.x1 + wall + 0.5,
    room.y0,
    room.top + t - EMBED,
    room.x1 + wall + 2,
    room.y1,
    room.top + t + 1.5,
  )
  spent.add(plate)
  spent.add(pull)
  return rawBoolean<Solid>('fuse', plate, [pull], FAILED)
}

function mounts(
  feature: EnclosureFeature,
  parts: readonly Part[],
  room: Room,
  additions: Solid[],
  cuts: Solid[],
  stage: SolidStage,
) {
  for (const { name, mount, placed } of parts) {
    if (mount.kind === 'none') continue
    if (!flat(placed)) {
      stage.report(
        'warning',
        `${name} is tilted, so it gets no mounts.`,
        'Lay it flat, or choose no mounts for it.',
      )
      continue
    }
    const base = transformPoint(placed.matrix, [0, 0, 0])[2]
    if (mount.kind === 'standoffs') {
      const holes = placed.part!.mountingHoles ?? []
      if (!holes.length) {
        stage.report('warning', `${name} has no mounting holes.`, 'Choose clips for it instead.')
        continue
      }
      const height = base - room.z0
      if (height < 0.5) continue
      for (const hole of holes) {
        const [x, y] = transformPoint(placed.matrix, [hole.x, hole.y, 0])
        const depth = Math.max(height - 1, 2)
        additions.push(post((hole.diameter + 3) / 2, x, y, room.z0 - EMBED, base))
        cuts.push(post(Math.max(hole.diameter - 0.6, 1.2) / 2, x, y, base - depth, base + 1))
      }
      continue
    }
    const board = boardBox(placed.part!)
    if (!board) {
      stage.report('warning', `${name} is not a board, so it cannot be clipped.`)
      continue
    }
    const size: ClipSize = { ...CLIP, gap: feature.gap }
    const longSide = board.width >= board.depth
    for (const along of clipPositions(board, CLIPS_PER_EDGE, CLIP.width)) {
      for (const side of [1, -1] as const) {
        const clip = edgeClip(size, board, room.z0 - base - EMBED, along, side, longSide)
        additions.push(transformShape(clip, placed.matrix) as Solid)
        quietly(clip as never)
      }
    }
  }
}

export function runEnclosureStep(feature: Feature, stage: SolidStage, doc: OkcDocument): boolean {
  if (feature.kind !== 'enclosure') return false
  const enclosure = feature as EnclosureFeature
  const oc = getOC() as unknown as OC
  const { wall, floor, lidThickness, gap, clearance, under } = enclosure
  if (!enclosure.mounts.length) {
    stage.report(
      'error',
      'An enclosure needs at least one part to go round.',
      'Edit it and pick the parts.',
    )
    return true
  }
  if (!(wall > 0) || !(floor > 0) || !(lidThickness > 0)) {
    stage.report('error', 'The walls, the floor and the lid all need some thickness.')
    return true
  }
  if (!(clearance >= 0) || !(under >= 0) || !(gap >= 0)) {
    stage.report('error', 'The room round the parts and the gap cannot be negative.')
    return true
  }
  const slot = Math.min(1.2, wall - 0.8)
  if (enclosure.lid === 'slide' && slot < 0.4) {
    stage.report(
      'error',
      'The walls are too thin to hold a sliding lid.',
      'Make them at least 1.2 mm thick.',
    )
    return true
  }
  const parts: Part[] = []
  for (const mount of enclosure.mounts) {
    const placed = placedPart(doc, mount.occurrencePath, enclosure.contextPath)
    const name =
      findOccurrence(doc, mount.occurrencePath[mount.occurrencePath.length - 1])?.name ?? 'A part'
    if (!placed?.part) {
      stage.report(
        'error',
        `${name} is no longer in the design.`,
        'Edit the enclosure and pick its parts again.',
      )
      return true
    }
    const [low, high] = worldBox(placed, mount.connectorIds)
    const board = boardBox(placed.part)
    if (mount.kind === 'clips' && board && flat(placed)) {
      const base = transformPoint(placed.matrix, [0, 0, 0])[2]
      high[2] = Math.max(high[2], base + clipTop(board, gap))
    }
    parts.push({ name, mount, placed, low, high })
  }
  const low: Vec3 = [0, 1, 2].map((i) => Math.min(...parts.map((part) => part.low[i]))) as Vec3
  const high: Vec3 = [0, 1, 2].map((i) => Math.max(...parts.map((part) => part.high[i]))) as Vec3
  const room = enclosureRoom(
    enclosure,
    low,
    high,
    parts.some((part) => part.mount.kind === 'clips'),
  )
  const spent = new Set<Solid>()
  try {
    const additions: Solid[] = []
    const cuts: Solid[] = []
    const lid =
      enclosure.lid === 'screws'
        ? screwLid(enclosure, room, additions, cuts, spent)
        : enclosure.lid === 'snap'
          ? snapLid(enclosure, room, cuts, spent)
          : slideLid(enclosure, room, slot, cuts, spent)
    spent.add(lid)
    mounts(enclosure, parts, room, additions, cuts, stage)
    for (const { mount, placed } of parts) {
      if (!mount.connectorIds.length) continue
      const cutter = buildPortCutters(placed, mount.connectorIds, enclosure.tolerance)
      if (cutter) cuts.push(cutter)
    }
    for (const solid of [...additions, ...cuts]) spent.add(solid)
    const outer = block(
      room.x0 - wall,
      room.y0 - wall,
      room.z0 - floor,
      room.x1 + wall,
      room.y1 + wall,
      room.z1,
    )
    const hollow = block(room.x0, room.y0, room.z0, room.x1, room.y1, room.z1 + 1)
    spent.add(outer)
    spent.add(hollow)
    let shell = rawBoolean<Solid>('cut', outer, [hollow], FAILED)
    spent.add(shell)
    if (additions.length) {
      shell = rawBoolean<Solid>('fuse', shell, additions, FAILED)
      spent.add(shell)
    }
    if (cuts.length) {
      shell = rawBoolean<Solid>('cut', shell, cuts, FAILED)
      spent.add(shell)
    }
    stage.set(
      enclosure.bodyId,
      nameShape(oc, `${enclosure.id}:box`, downcast(shell.wrapped) as unknown as OcShape),
    )
    stage.set(
      enclosure.lidBodyId,
      nameShape(oc, `${enclosure.id}:lid`, downcast(lid.wrapped) as unknown as OcShape),
    )
    return true
  } finally {
    for (const solid of spent) quietly(solid)
  }
}
