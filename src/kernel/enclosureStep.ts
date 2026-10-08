import { lidAppearance } from './lidAppearance'
import { downcast, getOC, makeBox, makeCylinder, sketchCircle } from 'replicad'
import type { Vec3 } from '../core/math'
import { partBounds } from '../catalogue/placement'
import { partFootprint } from '../catalogue/types'
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

function worldBox(placed: PlacedPart, ticked: readonly string[], protruding = false): [Vec3, Vec3] {
  const part = placed.part!
  let [x0, y0, z0, x1, y1, z1] = partBounds(part)
  if (protruding && part.geometry.kind === 'board') {
    const footprint = partFootprint(part)
    x0 = 0
    y0 = 0
    x1 = footprint.w
    y1 = footprint.h
  }
  for (const connector of part.connectors ?? []) {
    if (protruding && part.geometry.kind === 'board') continue
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
  const side = Math.max(
    clearance,
    reach + 0.3,
    clipped ? g + (feature.clipThickness ?? CLIP.post) + reach + 0.5 : 0,
  )
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
  portCuts: readonly Solid[],
): Solid {
  const { wall, lidThickness: t, gap: g, screw } = feature
  const radius = Math.max(screw * 1.2, 2.4)
  const bottom = room.z0 - feature.floor
  const depth = Math.min(room.z1 - bottom - 1, screw * 4 + 2)
  const hole = screw + 0.5
  const head = Math.min(screw * 2, hole + 2 * (t - 0.6))
  const originalCorners: Array<[number, number]> = [
    [room.x0 - radius, room.y0 - radius],
    [room.x1 + radius, room.y0 - radius],
    [room.x0 - radius, room.y1 + radius],
    [room.x1 + radius, room.y1 + radius],
  ]
  const blocked = portCuts.map(
    (cut) => (cut as unknown as { boundingBox: { bounds: [Vec3, Vec3] } }).boundingBox.bounds,
  )
  const free = ([x, y]: [number, number]) =>
    blocked.every(
      ([lo, hi]) =>
        x + radius + 0.5 < lo[0] ||
        x - radius - 0.5 > hi[0] ||
        y + radius + 0.5 < lo[1] ||
        y - radius - 0.5 > hi[1] ||
        room.z1 < lo[2] ||
        bottom > hi[2],
    )
  const corners: Array<[number, number]> = []
  for (const corner of originalCorners) {
    const candidates: Array<[number, number]> = [corner]
    for (let i = 1; i < 40; i++) {
      const fraction = i / 40
      candidates.push([corner[0], room.y0 + radius + fraction * (room.y1 - room.y0 - 2 * radius)])
      candidates.push([room.x0 + radius + fraction * (room.x1 - room.x0 - 2 * radius), corner[1]])
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a[0] - corner[0], a[1] - corner[1]) -
        Math.hypot(b[0] - corner[0], b[1] - corner[1]),
    )
    const chosen = candidates.find(
      (point) =>
        free(point) &&
        corners.every(
          (other) => Math.hypot(point[0] - other[0], point[1] - other[1]) >= 2 * radius + 1,
        ),
    )
    if (!chosen)
      throw new Error(
        'There is no room for the lid screws beside the connectors. Choose a snap or sliding lid, or increase the room round the parts.',
      )
    corners.push(chosen)
  }
  const pieces: Solid[] = []
  const holes: Solid[] = []
  for (const [x, y] of corners) {
    additions.push(post(radius, x, y, bottom, room.z1))
    cuts.push(post((screw - 0.4) / 2, x, y, room.z1 - depth, room.z1 + 1))
    pieces.push(post(radius, x, y, room.z1, room.z1 + t))
    holes.push(post(hole / 2, x, y, room.z1 - 1, room.z1 + t + 1))
    if (head - hole > 0.1) holes.push(countersink(x, y, room.z1 + t, hole, head))
  }
  let plate = block(
    room.x0 - wall,
    room.y0 - wall,
    room.z1,
    room.x1 + wall,
    room.y1 + wall,
    room.z1 + t,
  )
  spent.add(plate)
  plate = lidAppearance(plate, [0, 0, 1], t, feature) as Solid
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
  let plug = block(room.x0 + g, room.y0 + g, room.z1 - t, room.x1 - g, room.y1 - g, room.z1)
  spent.add(plug)
  plug = lidAppearance(plug, [0, 0, 1], t, feature) as Solid
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
  const z0 = room.top - g
  const z1 = room.top + t + g
  cuts.push(block(room.x0 - slot, room.y0 - slot, z0, room.x1 + wall + 1, room.y0 + 0.2, z1))
  cuts.push(block(room.x0 - slot, room.y1 - 0.2, z0, room.x1 + wall + 1, room.y1 + slot, z1))
  cuts.push(
    block(room.x1 - 0.2, room.y0 - slot, z0, room.x1 + wall + 1, room.y1 + slot, room.z1 + 1),
  )
  cuts.push(block(room.x0 - slot, room.y0, z0, room.x0 + 0.2, room.y1, z1))
  let plate = block(
    room.x0 - slot + g,
    room.y0 - slot + g,
    room.top,
    room.x1 + wall + 2,
    room.y1 + slot - g,
    room.top + t,
  )
  spent.add(plate)
  plate = lidAppearance(plate, [0, 0, 1], t, feature) as Solid
  const pull = block(
    room.x1 + wall + 0.5,
    (room.y0 + room.y1) / 2 - Math.min(6, (room.y1 - room.y0) / 4),
    room.top + t - EMBED,
    room.x1 + wall + 2,
    (room.y0 + room.y1) / 2 + Math.min(6, (room.y1 - room.y0) / 4),
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
        additions.push(
          post(((feature.mountScrew ?? hole.diameter) + 3) / 2, x, y, room.z0 - EMBED, base),
        )
        cuts.push(
          post(
            Math.max((feature.mountScrew ?? hole.diameter - 0.2) - 0.4, 1.2) / 2,
            x,
            y,
            base - depth,
            base + 1,
          ),
        )
      }
      continue
    }
    const board = boardBox(placed.part!)
    if (!board) {
      stage.report('warning', `${name} is not a board, so it cannot be clipped.`)
      continue
    }
    const size: ClipSize = {
      ...CLIP,
      width: feature.clipWidth ?? CLIP.width,
      post: feature.clipThickness ?? CLIP.post,
      hook: feature.clipHook ?? CLIP.hook,
      gap: feature.gap,
    }
    const longSide = board.width >= board.depth
    const length = longSide ? board.width : board.depth
    for (const side of [1, -1] as const) {
      const edge = longSide ? (side > 0 ? '+y' : '-y') : side > 0 ? '+x' : '-x'
      const ports = (placed.part!.connectors ?? []).filter(
        (connector) =>
          mount.connectorIds.includes(connector.id) &&
          connector.side === edge &&
          connector.z <
            clipTop(board, feature.gap) +
              (feature.clipHook ?? CLIP.hook) -
              CLIP.hook +
              (feature.clipThickness ?? CLIP.post) -
              CLIP.post &&
          connector.z + connector.height > room.z0 - base,
      )
      const chosen: number[] = []
      for (const preferred of clipPositions(board, CLIPS_PER_EDGE, size.width)) {
        const candidates = [
          preferred,
          ...Array.from(
            { length: 41 },
            (_, i) => size.width / 2 + 0.5 + (i * Math.max(0, length - size.width - 1)) / 40,
          ),
        ]
        candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
        const along = candidates.find(
          (value) =>
            chosen.every((other) => Math.abs(value - other) >= size.width + 0.5) &&
            ports.every(
              (connector) =>
                Math.abs(value - (longSide ? connector.x : connector.y)) >
                (size.width + connector.width) / 2 + feature.tolerance + 0.5,
            ),
        )
        if (along === undefined) {
          stage.report(
            'warning',
            `${name} has no room for all its clips beside the connectors.`,
            'Use standoffs or increase the board space.',
          )
          continue
        }
        chosen.push(along)
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
  if (enclosure.lid === 'slide' && gap >= slot) {
    stage.report('error', 'The lid gap must be smaller than the depth of its guide rails.')
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
    const selectedMount = enclosure.protrudingConnectors
      ? { ...mount, connectorIds: placed.part.connectors?.map((connector) => connector.id) ?? [] }
      : mount
    const [low, high] = worldBox(placed, selectedMount.connectorIds, enclosure.protrudingConnectors)
    const board = boardBox(placed.part)
    if (mount.kind === 'clips' && board && flat(placed)) {
      const base = transformPoint(placed.matrix, [0, 0, 0])[2]
      high[2] = Math.max(
        high[2],
        base +
          clipTop(board, gap) +
          (enclosure.clipHook ?? CLIP.hook) -
          CLIP.hook +
          (enclosure.clipThickness ?? CLIP.post) -
          CLIP.post,
      )
    }
    parts.push({ name, mount: selectedMount, placed, low, high })
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
    const portCuts: Solid[] = []
    for (const { mount, placed } of parts) {
      for (const id of mount.connectorIds) {
        const cutter = buildPortCutters(placed, [id], enclosure.tolerance)
        if (cutter) {
          cuts.push(cutter)
          portCuts.push(cutter)
          spent.add(cutter)
        }
      }
    }
    let lid =
      enclosure.lid === 'screws'
        ? screwLid(enclosure, room, additions, cuts, spent, portCuts)
        : enclosure.lid === 'snap'
          ? snapLid(enclosure, room, cuts, spent)
          : slideLid(enclosure, room, slot, cuts, spent)
    spent.add(lid)
    mounts(enclosure, parts, room, additions, cuts, stage)
    for (const solid of [...additions, ...cuts]) spent.add(solid)
    if (portCuts.length) {
      lid = rawBoolean<Solid>('cut', lid, portCuts, FAILED)
      spent.add(lid)
    }
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
