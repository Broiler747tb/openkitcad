import { downcast, draw, drawCircle, genericSweep, getOC, makeCylinder, makeHelix } from 'replicad'
import { type Vec2, type Vec3 } from '../core/math'
import type { Feature, ScrewLidFeature } from '../doc/types'
import { place } from './fitSteps'
import { cut, fuse, nameShape, type NamedShape, type OC, type OcShape } from './naming'
import { rawBoolean } from './rawBoolean'
import { roundFace, type RoundFace } from './roundFace'
import type { SolidStage } from './solidSteps'

type Solid = {
  fuse(other: Solid): Solid
  cut(other: Solid): Solid
  intersect(other: Solid): Solid
  translate(vector: Vec3): Solid
  rotate(angle: number, origin?: Vec3, axis?: Vec3): Solid
  wrapped: OcShape
}

const LEAD = 1
const EMBED = 0.2
const FLUTES = 12

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function booleanSolid(kind: 'fuse' | 'cut', target: Solid, tool: Solid, touching = false): Solid {
  return rawBoolean<Solid>(kind, target, [tool], 'The lid could not be built.', touching)
}

function threadRidge(
  feature: ScrewLidFeature,
  radius: number,
  height: number,
  grow: number,
  extend = 0,
): Solid {
  const pitch = feature.pitch
  const depth = pitch * 0.38 + grow
  const root = pitch * 0.62 + 2 * grow
  const crest = pitch * 0.34 + 2 * grow
  const bottom = -(height + LEAD) - extend
  const base = radius - EMBED
  const tip = radius + depth
  const points: Vec2[] =
    feature.profile === 'triangle'
      ? [
          [base, bottom - root / 2],
          [base, bottom + root / 2],
          [tip, bottom],
        ]
      : [
          [base, bottom - root / 2],
          [base, bottom + root / 2],
          [tip, bottom + crest / 2],
          [tip, bottom - crest / 2],
        ]
  const pen = draw(points[0])
  for (const point of points.slice(1)) pen.lineTo(point)
  const profile = pen.close().sketchOnPlane('XZ') as unknown as { wire: never }
  const helix = makeHelix(pitch, height + extend, radius, [0, 0, bottom])
  return genericSweep(profile.wire, helix, { frenet: true }) as unknown as Solid
}

function knurlDepth(radius: number): number {
  return Math.min(1, (2 * Math.PI * radius) / (FLUTES * 6))
}

function knurled(radius: number, hole: number, from: number, to: number): Solid {
  const depth = knurlDepth(radius)
  const at = (i: number): Vec2 => {
    const angle = (i / (FLUTES * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? radius : radius - depth
    return [Math.cos(angle) * r, Math.sin(angle) * r]
  }
  const pen = draw(at(0))
  for (let i = 1; i < FLUTES * 2; i++) pen.lineTo(at(i))
  let outline = pen.close()
  if (hole > 0) outline = outline.cut(drawCircle(hole))
  const profile = outline.sketchOnPlane('XY', from) as unknown as {
    extrude(distance: number): Solid
  }
  return profile.extrude(to - from)
}

function capSolid(feature: ScrewLidFeature, opening: RoundFace, height: number): Solid {
  const gap = feature.gap
  const bore = opening.radius + gap
  const outer = bore + feature.wall
  const bottom = -(height + LEAD)
  const core = feature.grip ? outer - knurlDepth(outer) - 0.2 : outer
  const spent: Solid[] = []
  const shell = makeCylinder(core, feature.top - bottom, [0, 0, bottom], [0, 0, 1])
  const hollow = makeCylinder(bore, height + LEAD + 1, [0, 0, bottom - 1], [0, 0, 1])
  const thread = threadRidge(feature, bore, height, gap, feature.pitch)
  spent.push(shell as unknown as Solid, hollow as unknown as Solid, thread)
  let cap = booleanSolid('cut', shell as unknown as Solid, hollow as unknown as Solid)
  spent.push(cap)
  cap = booleanSolid('cut', cap, thread)
  if (feature.grip) {
    const ring = knurled(outer, core, bottom, feature.top)
    spent.push(cap, ring)
    cap = booleanSolid('fuse', cap, ring, true)
  }
  for (const solid of spent) quietly(solid as never)
  return cap
}

function plugSolid(feature: ScrewLidFeature, opening: RoundFace, height: number): Solid {
  const gap = feature.gap
  const shaft = opening.radius - gap
  const bottom = -(height + LEAD)
  const head = shaft + feature.wall + 2
  const spent: Solid[] = []
  const shaftSolid = makeCylinder(shaft, height + LEAD, [0, 0, bottom], [0, 0, 1])
  const grip = feature.grip
    ? knurled(head, 0, 0, feature.top)
    : (makeCylinder(head, feature.top, [0, 0, 0], [0, 0, 1]) as unknown as Solid)
  const thread = threadRidge(feature, shaft, height, 0)
  spent.push(shaftSolid as unknown as Solid, grip, thread)
  let plug = booleanSolid('fuse', shaftSolid as unknown as Solid, grip)
  spent.push(plug)
  plug = booleanSolid('fuse', plug, thread)
  for (const solid of spent) quietly(solid as never)
  return plug
}

export function runScrewStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'screwLid') return false
  const screw = feature as ScrewLidFeature
  const oc = getOC() as unknown as OC
  if (!(screw.pitch > 0) || !(screw.turns > 0)) {
    stage.report('error', 'A screw lid needs a pitch and some turns.')
    return true
  }
  const body = stage.need(screw.face.bodyId)
  if (!body) return true
  const opening = roundFace(stage, screw.face, screw.anchor, screw.flipEnd, {
    notRound: 'A screw lid goes on a round opening.',
    hint: 'Pick the round side of a tube or a jar, near its open end.',
  })
  if (!opening) return true
  const height = screw.pitch * screw.turns
  if (height > opening.length + 1e-6) {
    stage.report(
      'warning',
      'The thread is longer than the round face it sits on.',
      'Use fewer turns, or a smaller pitch.',
    )
  }
  const owned: Solid[] = []
  const tools: NamedShape[] = []
  try {
    const onBody = threadRidge(screw, opening.radius, height, opening.convex ? 0 : screw.gap)
    const placedThread = place(onBody, opening.frame) as Solid
    owned.push(placedThread)
    const threadTool = nameShape(
      oc,
      `${screw.id}:thread`,
      downcast(placedThread.wrapped) as unknown as OcShape,
    )
    tools.push(threadTool)
    let next: NamedShape
    try {
      next = (opening.convex ? fuse : cut)(oc, {
        featureId: screw.id,
        target: { shape: body.shape.wrapped, map: body.map },
        tools: [threadTool],
      })
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error(`Could not put the thread on ${stage.bodyName(screw.face.bodyId)}.`)
    }
    stage.set(screw.face.bodyId, next)
    const lid = opening.convex
      ? capSolid(screw, opening, height)
      : plugSolid(screw, opening, height)
    const placedLid = place(lid, opening.frame) as Solid
    owned.push(placedLid)
    stage.set(
      screw.capBodyId,
      nameShape(oc, `${screw.id}:cap`, downcast(placedLid.wrapped) as unknown as OcShape),
    )
    return true
  } finally {
    for (const tool of tools) {
      tool.map.dispose()
      tool.shape.delete()
    }
    for (const solid of owned) quietly(solid as never)
  }
}
