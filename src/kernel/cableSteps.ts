import { downcast, draw, drawRectangle, getOC, makeCylinder } from 'replicad'
import { frameToWorld, v3, type Frame, type Vec2, type Vec3 } from '../core/math'
import { glandSpec, tieSpec } from '../doc/cables'
import type { CableEntryFeature, Feature } from '../doc/types'
import { planHole, SCREWS, type ThreadSize } from '../fasteners'
import { place } from './fitSteps'
import {
  cut,
  fuse,
  nameShape,
  Scratch,
  subShapes,
  type NamedShape,
  type OC,
  type OcShape,
} from './naming'
import type { SolidStage } from './solidSteps'

type OcAny = any

type Solid = {
  fuse(other: Solid): Solid
  cut(other: Solid): Solid
  translate(vector: Vec3): Solid
  wrapped: OcShape
}

const REACH = 400
const CHAMFER = 0.6
const BRIDGE = 1.6
const PAD = 4

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function localFrame(frame: Frame, position: Vec2, angle: number): Frame {
  const theta = (angle * Math.PI) / 180
  const u = v3.norm(
    v3.add(v3.scale(frame.xDir, Math.cos(theta)), v3.scale(frame.yDir, Math.sin(theta))),
  )
  return {
    origin: frameToWorld(frame, position),
    xDir: u,
    yDir: v3.cross(frame.normal, u),
    normal: frame.normal,
  }
}

function wallThickness(oc: OcAny, body: Solid, frame: Frame, width: number): number | null {
  const probe = place(
    makeCylinder(width / 2, REACH, [0, 0, -REACH], [0, 0, 1]) as unknown as Solid,
    frame,
  ) as Solid
  let hit: Solid | null = null
  try {
    hit = (body as unknown as { intersect(other: Solid): Solid }).intersect(probe)
  } catch {
    return null
  } finally {
    quietly(probe as never)
  }
  const scratch = new Scratch()
  try {
    let near: [number, number] | null = null
    for (const solid of subShapes(oc, hit.wrapped, 'TopAbs_SOLID', scratch)) {
      const box = scratch.track(new oc.Bnd_Box_1())
      oc.BRepBndLib.AddOptimal(solid, box, false, false)
      if (box.IsVoid()) continue
      const low = scratch.track(box.CornerMin())
      const high = scratch.track(box.CornerMax())
      let min = Infinity
      let max = -Infinity
      for (const x of [low.X(), high.X()]) {
        for (const y of [low.Y(), high.Y()]) {
          for (const z of [low.Z(), high.Z()]) {
            const into = -v3.dot(v3.sub([x, y, z], frame.origin), frame.normal)
            min = Math.min(min, into)
            max = Math.max(max, into)
          }
        }
      }
      if (!near || min < near[0]) near = [min, max]
    }
    return near && near[1] > 0 ? near[1] : null
  } finally {
    scratch.release()
    quietly(hit as never)
  }
}

function cone(radius: number, height: number, at: number): Solid {
  return draw([0, at])
    .lineTo([radius, at])
    .lineTo([radius, at + height])
    .lineTo([0, at + height])
    .close()
    .sketchOnPlane('XZ')
    .revolve([0, 0, 1]) as unknown as Solid
}

function taper(from: number, to: number, at: number, height: number): Solid {
  return draw([0, at])
    .lineTo([from, at])
    .lineTo([to, at + height])
    .lineTo([0, at + height])
    .close()
    .sketchOnPlane('XZ')
    .revolve([0, 0, 1]) as unknown as Solid
}

function boxSolid(width: number, depth: number, height: number, at: number): Solid {
  return drawRectangle(width, depth).sketchOnPlane('XY', at).extrude(height) as unknown as Solid
}

interface Parts {
  cuts: Solid[]
  adds: Solid[]
  bar?: Solid
}

function grommetParts(feature: CableEntryFeature, wall: number): Parts {
  const radius = feature.cable / 2 + feature.clearance
  const hole = makeCylinder(radius, wall + 4, [0, 0, -wall - 2], [0, 0, 1]) as unknown as Solid
  const lead = Math.min(CHAMFER, radius / 2)
  const outer = taper(radius + lead, radius, -lead, lead)
  const inner = taper(radius, radius + lead, -wall, lead)
  return { cuts: [hole, outer, inner], adds: [] }
}

function glandParts(feature: CableEntryFeature, wall: number): Parts {
  const gland = glandSpec(feature.gland)
  const radius = gland.hole / 2 + feature.clearance
  const hole = makeCylinder(radius, wall + 4, [0, 0, -wall - 2], [0, 0, 1]) as unknown as Solid
  const lead = Math.min(CHAMFER, radius / 2)
  const outer = taper(radius + lead, radius, -lead, lead)
  const cuts = [hole, outer]
  if (feature.nutRoom) {
    const room = (gland.nut / Math.cos(Math.PI / 6) + 1) / 2
    cuts.push(cone(room, gland.nutHeight + 1, -wall - gland.nutHeight - 1))
  }
  return { cuts, adds: [] }
}

function tieParts(feature: CableEntryFeature): Parts {
  const tie = tieSpec(feature.tie)
  const slotWidth = tie.width + 0.6
  const slotHeight = tie.thickness + 0.4
  const width = slotWidth + 2 * PAD
  const depth = Math.max(feature.cable + 4, 8)
  const height = slotHeight + BRIDGE
  const pad = boxSolid(width, depth, height, 0)
  const slot = boxSolid(slotWidth, depth + 2, slotHeight, 0)
  return { cuts: [], adds: [pad.cut(slot)] }
}

function clampParts(feature: CableEntryFeature): Parts {
  const screw = SCREWS[feature.screw as ThreadSize]
  const tapped = planHole('tapped', feature.screw as ThreadSize)
  const post = screw.headDiameter + 2
  const reach = feature.cable + post + 2
  const height = Math.max(feature.cable / 2 + 2, 4)
  const adds: Solid[] = []
  const cuts: Solid[] = []
  for (const side of [-1, 1]) {
    const at: Vec3 = [(side * reach) / 2, 0, 0]
    adds.push(
      (makeCylinder(post / 2, height, [0, 0, 0], [0, 0, 1]) as unknown as Solid).translate(at),
    )
    cuts.push(
      (
        makeCylinder(tapped.diameter / 2, height + 2, [0, 0, -1], [0, 0, 1]) as unknown as Solid
      ).translate(at),
    )
  }
  const barThickness = Math.max(3, screw.headHeight + 1)
  const squeeze = 0.5
  let bar = boxSolid(reach + post, post, barThickness, height + 0.2) as Solid
  const groove = makeCylinder(
    feature.cable / 2 - squeeze / 2,
    post + 2,
    [0, -(post + 2) / 2, height + 0.2],
    [0, 1, 0],
  ) as unknown as Solid
  bar = bar.cut(groove)
  for (const side of [-1, 1]) {
    const at: Vec3 = [(side * reach) / 2, 0, 0]
    bar = bar.cut(
      (
        makeCylinder(
          screw.clearance / 2,
          barThickness + 2,
          [0, 0, height - 1],
          [0, 0, 1],
        ) as unknown as Solid
      ).translate(at),
    )
  }
  return { cuts, adds, bar }
}

export function runCableStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'cableEntry') return false
  const entry = feature as CableEntryFeature
  const oc = getOC() as unknown as OC
  const occ = oc as OcAny
  if (!(entry.cable > 0)) {
    stage.report('error', 'The cable has to have a size.')
    return true
  }
  const body = stage.need(entry.bodyId)
  if (!body) return true
  const frame = localFrame(stage.planeOf(entry.plane), entry.position, entry.angle)
  const shape = body.shape as unknown as Solid
  let parts: Parts
  if (entry.entry === 'grommet' || entry.entry === 'gland') {
    const width =
      entry.entry === 'gland' ? glandSpec(entry.gland).hole : entry.cable + 2 * entry.clearance
    const wall = wallThickness(occ, shape, frame, width)
    if (!wall) {
      stage.report(
        'error',
        'The wall under this entry could not be measured.',
        'Put it on a face with material behind it.',
      )
      return true
    }
    parts = entry.entry === 'gland' ? glandParts(entry, wall) : grommetParts(entry, wall)
    if (entry.entry === 'gland') {
      const gland = glandSpec(entry.gland)
      if (entry.cable < gland.cable[0] || entry.cable > gland.cable[1]) {
        stage.report(
          'warning',
          `A ${gland.label} gland grips ${gland.cable[0]} to ${gland.cable[1]} mm cable, not ${entry.cable} mm.`,
          'Pick the gland that matches the cable.',
        )
      }
    }
  } else if (entry.entry === 'tie') {
    parts = tieParts(entry)
  } else {
    parts = clampParts(entry)
  }
  const tools: NamedShape[] = []
  const owned: Solid[] = []
  try {
    let current: NamedShape = { shape: body.shape.wrapped, map: body.map }
    let made = false
    const step = (kind: 'fuse' | 'cut', solids: Solid[], role: string) => {
      if (!solids.length) return
      const named = solids.map((solid, index) => {
        const placed = place(solid, frame) as Solid
        owned.push(placed)
        return nameShape(
          oc,
          `${entry.id}:${role}${index}`,
          downcast(placed.wrapped) as unknown as OcShape,
        )
      })
      tools.push(...named)
      const next = (kind === 'fuse' ? fuse : cut)(oc, {
        featureId: entry.id,
        target: current,
        tools: named,
      })
      if (made) {
        current.map.dispose()
        current.shape.delete()
      }
      current = next
      made = true
    }
    try {
      step('fuse', parts.adds, 'add')
      step('cut', parts.cuts, 'cut')
    } catch (error) {
      if (made) {
        current.map.dispose()
        current.shape.delete()
      }
      if (error instanceof Error) throw error
      throw new Error(`Could not put the cable entry on ${stage.bodyName(entry.bodyId)}.`)
    }
    if (made) stage.set(entry.bodyId, current)
    if (parts.bar && entry.barBodyId) {
      const placed = place(parts.bar, frame) as Solid
      owned.push(placed)
      stage.set(
        entry.barBodyId,
        nameShape(oc, `${entry.id}:bar`, downcast(placed.wrapped) as unknown as OcShape),
      )
    }
    return true
  } finally {
    for (const tool of tools) {
      tool.map.dispose()
      tool.shape.delete()
    }
    for (const solid of owned) quietly(solid as never)
  }
}
