/**
 * Feature evaluation: turning a document into solids.
 *
 * Runs entirely inside the worker. Every function here may allocate OpenCascade
 * objects, so it must never be imported from the main thread.
 */
import {
  draw,
  drawCircle,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  makeBox,
  makeCylinder,
  makeSphere,
  Plane,
  sketchCircle,
  type Drawing,
} from 'replicad'
import {
  frameToLocal,
  frameToWorld,
  makeFrame,
  NAMED_FRAMES,
  v3,
  type Frame,
  type Vec2,
  type Vec3,
} from '../core/math'
import type {
  Body,
  BooleanOp,
  EdgeRef,
  FaceRef,
  Feature,
  HoleFeature,
  OkcDocument,
  Placement,
  PlaneRef,
  SketchFeature,
  StandoffFeature,
} from '../doc/types'
import { placementToWorld } from '../doc/placement'
import { frameFromPlaneRefLocal } from '../doc/planes'
import { getPart, type CataloguePart } from '../catalogue'
import { sketchToProfile } from './profile'

export interface BuildError {
  featureId: string
  message: string
  hint?: string
}

/** How far cutters overshoot the material, so nothing is left paper-thin. */
const CUT_MARGIN = 0.5
/** Length used for "through" cuts when the body size is unknown. */
const THROUGH_LENGTH = 1000

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

export function frameFromPlaneRef(
  ref: PlaneRef,
  shapes: Map<string, any>,
): Frame {
  // Named and tilted planes need no geometry, so they come from the shared
  // helper the viewport uses. Keeping one implementation is what stops a sketch
  // landing in a different place on screen than it does in the kernel.
  if (ref.kind !== 'face') return frameFromPlaneRefLocal(ref)

  const resolved = resolveFace(shapes.get(ref.face.bodyId), ref.face)
  const normal = resolved?.normal ?? ref.face.normal
  const anchor = resolved?.centre ?? ref.face.anchor
  return makeFrame(v3.add(anchor, v3.scale(normal, ref.offset)), normal)
}

export function toReplicadPlane(frame: Frame, offset = 0): Plane {
  const origin = offset ? v3.add(frame.origin, v3.scale(frame.normal, offset)) : frame.origin
  return new Plane(origin, frame.xDir, frame.normal)
}

/**
 * Place a drawing on a frame, optionally offset along its normal.
 *
 * replicad's `sketchOnPlane` only accepts an offset alongside a *named* plane,
 * so for an arbitrary frame the offset has to be baked into the plane's origin.
 * The return is deliberately `any`: the declared type is a union that does not
 * expose `extrude`, even though every value this can produce does.
 */
function sketchOn(drawing: Drawing, frame: Frame, offset = 0): any {
  return drawing.sketchOnPlane(toReplicadPlane(frame, offset)) as any
}

// ---------------------------------------------------------------------------
// Resolving picked faces and edges after a rebuild
// ---------------------------------------------------------------------------

function faceCentre(face: any): Vec3 {
  const c = face.center
  return [c.x, c.y, c.z]
}

function faceNormal(face: any): Vec3 {
  const n = face.normalAt()
  return v3.norm([n.x, n.y, n.z])
}

/**
 * Find the face that best matches a stored fingerprint: the closest one whose
 * normal still points roughly the same way.
 */
export function resolveFace(
  shape: any,
  ref: FaceRef,
): { face: any; centre: Vec3; normal: Vec3 } | null {
  if (!shape) return null
  let best: { face: any; centre: Vec3; normal: Vec3; score: number } | null = null
  for (const face of shape.faces) {
    let centre: Vec3
    let normal: Vec3
    try {
      centre = faceCentre(face)
      normal = faceNormal(face)
    } catch {
      continue
    }
    // Reject anything facing more than 60 degrees away from the original pick.
    if (v3.dot(normal, ref.normal) < 0.5) continue
    const score = v3.dist(centre, ref.anchor)
    if (!best || score < best.score) best = { face, centre, normal, score }
  }
  return best ? { face: best.face, centre: best.centre, normal: best.normal } : null
}

function edgeAnchor(edge: any): Vec3 | null {
  try {
    const [min, max] = edge.boundingBox.bounds
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  } catch {
    return null
  }
}

/** Predicate matching an edge against any of the stored fingerprints. */
function edgeMatcher(refs: EdgeRef[]): (edge: any) => boolean {
  if (refs.length === 0) return () => true
  return (edge: any) => {
    const anchor = edgeAnchor(edge)
    if (!anchor) return false
    return refs.some((r) => v3.dist(anchor, r.anchor) < 0.75)
  }
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

function combine(current: any | null, next: any, op: BooleanOp): any {
  if (!current || op === 'new') return next
  switch (op) {
    case 'add':
      return current.fuse(next)
    case 'cut':
      return current.cut(next)
    case 'intersect':
      return current.intersect(next)
  }
}

// ---------------------------------------------------------------------------
// Catalogue parts
// ---------------------------------------------------------------------------

function boardOutlineDrawing(part: CataloguePart): Drawing | null {
  const g = part.geometry
  if (g.kind !== 'board') return null
  if (g.outline.shape === 'rect') {
    const { w, h, cornerRadius } = g.outline
    const base = cornerRadius
      ? drawRoundedRectangle(w, h, cornerRadius)
      : drawRectangle(w, h)
    // Catalogue parts are dimensioned from their lower-left corner, replicad
    // draws rectangles about their centre.
    return base.translate(w / 2, h / 2)
  }
  const pts = g.outline.points
  const pen = draw(pts[0])
  for (let i = 1; i < pts.length; i++) pen.lineTo(pts[i])
  return pen.close()
}

/**
 * Build a catalogue part in its own local frame (origin at the lower-left of
 * its footprint, Z up).
 */
export function buildPartLocal(part: CataloguePart, overrides?: Record<string, number>): any {
  const g = part.geometry
  switch (g.kind) {
    case 'board': {
      const outline = boardOutlineDrawing(part)
      if (!outline) return null
      let solid: any = outline.sketchOnPlane('XY').extrude(g.thickness)
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(
          makeCylinder(hole.diameter / 2, g.thickness + 2, [hole.x, hole.y, -1], [0, 0, 1]),
        )
      }
      for (const bump of g.bumps ?? []) {
        const box = drawRectangle(bump.w, bump.h)
          .translate(bump.x + bump.w / 2, bump.y + bump.h / 2)
          .sketchOnPlane('XY', bump.z)
          .extrude(bump.height)
        solid = solid.fuse(box)
      }
      return solid
    }

    case 'extrusion': {
      const s = g.size
      const length = overrides?.length ?? g.length
      const slot = 6
      const inner = 11
      // Profile drawn in the YZ plane so the bar runs along X.
      let profile: Drawing = drawRectangle(s, s).translate(s / 2, s / 2)
      // Four T-slots, one per face.
      for (let i = 0; i < (g.slots ?? 4); i++) {
        const mouth = drawRectangle(slot, 6).translate(s / 2, s - 3)
        const throat = drawRectangle(inner, 5).translate(s / 2, s - 8.5)
        let cutter = mouth.fuse(throat)
        cutter = cutter.rotate(i * 90, [s / 2, s / 2])
        profile = profile.cut(cutter)
      }
      profile = profile.cut(drawCircle(2.1).translate(s / 2, s / 2))
      return profile.sketchOnPlane('YZ').extrude(length)
    }

    case 'screw': {
      const r = g.headDiameter / 2
      let solid: any = makeCylinder(g.diameter / 2, g.length, [r, r, 0], [0, 0, 1])
      if (g.head === 'countersunk') {
        const cone = sketchCircle(g.headDiameter / 2, { origin: [r, r, g.length] })
          .loftWith(sketchCircle(g.diameter / 2, { origin: [r, r, g.length - g.headHeight] }))
        solid = solid.fuse(cone)
      } else {
        solid = solid.fuse(
          makeCylinder(g.headDiameter / 2, g.headHeight, [r, r, g.length], [0, 0, 1]),
        )
      }
      return solid
    }

    case 'insert': {
      const r = g.outerDiameter / 2
      return makeCylinder(r, g.length, [r, r, 0], [0, 0, 1]).cut(
        makeCylinder(1.5, g.length + 2, [r, r, -1], [0, 0, 1]),
      )
    }

    case 'standoff': {
      const circumradius = g.acrossFlats / Math.sqrt(3)
      const r = g.acrossFlats / 2
      const body: any = drawPolysides(circumradius, 6)
        .translate(r, r)
        .sketchOnPlane('XY')
        .extrude(g.length)
      const boreRadius = Number(g.thread.replace(/[^0-9.]/g, '')) / 2 || 1.25
      return body.cut(makeCylinder(boreRadius, g.length + 2, [r, r, -1], [0, 0, 1]))
    }

    case 'motor': {
      const f = g.frame
      let solid: any = drawRoundedRectangle(f, f, 4)
        .translate(f / 2, f / 2)
        .sketchOnPlane('XY')
        .extrude(g.bodyLength)
      solid = solid.fuse(
        makeCylinder(g.bossDiameter / 2, g.bossHeight, [f / 2, f / 2, g.bodyLength], [0, 0, 1]),
      )
      solid = solid.fuse(
        makeCylinder(
          g.shaftDiameter / 2,
          g.shaftLength,
          [f / 2, f / 2, g.bodyLength + g.bossHeight],
          [0, 0, 1],
        ),
      )
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(
          makeCylinder(hole.diameter / 2, 6, [hole.x, hole.y, g.bodyLength - 5], [0, 0, 1]),
        )
      }
      return solid
    }

    case 'bearing': {
      const r = g.outerDiameter / 2
      return makeCylinder(r, g.width, [r, r, 0], [0, 0, 1]).cut(
        makeCylinder(g.innerDiameter / 2, g.width + 2, [r, r, -1], [0, 0, 1]),
      )
    }

    case 'connector': {
      // Body sits behind the panel, running back along +y; anything that pokes
      // out the front is drawn in the shape of the cutout so the part reads as
      // the socket it is.
      const { bodyWidth: w, bodyHeight: h, bodyDepth: d, protrusion } = g
      let solid: any = makeBox([0, 0, 0], [w, d, h])
      if (protrusion > 0) {
        if (g.cutout.shape === 'rect') {
          const halfW = g.cutout.w / 2
          const halfH = g.cutout.h / 2
          solid = solid.fuse(
            makeBox(
              [w / 2 - halfW, d, h / 2 - halfH],
              [w / 2 + halfW, d + protrusion, h / 2 + halfH],
            ),
          )
        } else {
          solid = solid.fuse(
            makeCylinder(g.cutout.d / 2, protrusion, [w / 2, d, h / 2], [0, 1, 0]),
          )
        }
      }
      for (const hole of part.mountingHoles ?? []) {
        solid = solid.cut(
          makeCylinder(hole.diameter / 2, d + 2, [hole.x, -1, hole.y], [0, 1, 0]),
        )
      }
      return solid
    }
  }
}

/** Build a placed catalogue part in world space. */
export function buildPlacement(placement: Placement): any | null {
  const part = getPart(placement.partId)
  if (!part) return null
  let solid = buildPartLocal(part, placement.overrides)
  if (!solid) return null
  if (placement.flipped) solid = solid.rotate(180, [0, 0, 0], [1, 0, 0])
  if (placement.rotation) solid = solid.rotate(placement.rotation, [0, 0, 0], [0, 0, 1])
  return solid.translate(placement.position)
}

// ---------------------------------------------------------------------------
// Hole and standoff positions
// ---------------------------------------------------------------------------

/**
 * Where a hole feature's holes actually are, in the coordinates of its own
 * plane. Placement-sourced holes are recomputed here on every rebuild, which
 * is what makes moving a board drag its mounting holes along with it.
 */
export function resolvePositions(
  source: HoleFeature['source'] | StandoffFeature['source'],
  frame: Frame,
  doc: OkcDocument,
): Vec2[] {
  if (source.kind === 'explicit') return source.positions
  const placement = doc.placements.find((p) => p.id === source.placementId)
  if (!placement) return []
  const part = getPart(placement.partId)
  if (!part?.mountingHoles) return []
  const wanted = source.holeIds?.length
    ? part.mountingHoles.filter((h) => source.holeIds!.includes(h.id))
    : part.mountingHoles
  return wanted.map((h) => {
    const world = placementToWorld(placement, [h.x, h.y, 0])
    return frameToLocal(frame, world)
  })
}

// ---------------------------------------------------------------------------
// Feature evaluation
// ---------------------------------------------------------------------------

interface EvalContext {
  doc: OkcDocument
  /** Bodies already built this pass, for face references. */
  shapes: Map<string, any>
  /**
   * The solid as it stood just before each hollowing, keyed by shell feature.
   * A lid needs the *outer* cross-section, and once a body has been hollowed
   * all that is left at the opening is a ring of wall.
   */
  preShell: Map<string, { shape: any; frame: Frame }>
}

function buildHoleCutter(
  feature: HoleFeature,
  frame: Frame,
  positions: Vec2[],
): any | null {
  const depth = feature.depth === 'through' ? THROUGH_LENGTH : feature.depth
  let cutter: any = null

  for (const [u, v] of positions) {
    // Drill into the material, i.e. against the plane normal.
    const shaft = sketchOn(
      drawCircle(feature.diameter / 2).translate(u, v),
      frame,
      CUT_MARGIN,
    ).extrude(-(depth + CUT_MARGIN))
    let piece: any = shaft

    if (feature.style === 'counterbore' && feature.counterboreDiameter) {
      const cb = sketchOn(
        drawCircle(feature.counterboreDiameter / 2).translate(u, v),
        frame,
        CUT_MARGIN,
      ).extrude(-((feature.counterboreDepth ?? 3) + CUT_MARGIN))
      piece = piece.fuse(cb)
    }

    if (feature.style === 'countersink') {
      const angle = ((feature.countersinkAngle ?? 90) * Math.PI) / 180
      const headRadius = (feature.counterboreDiameter ?? feature.diameter * 2) / 2
      // Depth a cone of this included angle needs to reach the head diameter.
      const coneDepth = (headRadius - feature.diameter / 2) / Math.tan(angle / 2)
      const top = sketchOn(drawCircle(headRadius).translate(u, v), frame, 0)
      const bottom = sketchOn(
        drawCircle(feature.diameter / 2).translate(u, v),
        frame,
        -coneDepth,
      )
      piece = piece.fuse(top.loftWith(bottom))
    }

    cutter = cutter ? cutter.fuse(piece) : piece
  }
  return cutter
}

function buildStandoffs(
  feature: StandoffFeature,
  frame: Frame,
  positions: Vec2[],
): { solid: any | null; bores: any | null } {
  let solid: any = null
  let bores: any = null

  for (const [u, v] of positions) {
    const pillar = sketchOn(
      drawCircle(feature.outerDiameter / 2).translate(u, v),
      frame,
    ).extrude(feature.height)
    solid = solid ? solid.fuse(pillar) : pillar

    const bore = sketchOn(
      drawCircle(feature.boreDiameter / 2).translate(u, v),
      frame,
      feature.height + CUT_MARGIN,
    ).extrude(-(feature.boreDepth + CUT_MARGIN))
    bores = bores ? bores.fuse(bore) : bore
  }
  return { solid, bores }
}

function buildPortCutters(
  placement: Placement,
  connectorIds: string[],
  tolerance: number,
): any | null {
  const part = getPart(placement.partId)
  if (!part?.connectors?.length) return null
  const wanted = connectorIds.length
    ? part.connectors.filter((c) => connectorIds.includes(c.id))
    : part.connectors

  let cutter: any = null
  const REACH = 60 // far enough to punch through any sane wall

  for (const c of wanted) {
    const along = c.protrusion + REACH
    // Which way the opening faces, in the part's own frame.
    const dir: Vec3 =
      c.side === '+x'
        ? [1, 0, 0]
        : c.side === '-x'
          ? [-1, 0, 0]
          : c.side === '+y'
            ? [0, 1, 0]
            : [0, -1, 0]

    let piece: any
    if (c.shape === 'circle') {
      // A round port cut as a rectangle is a ruined panel, and round ports -
      // barrel jacks, audio sockets, LED bezels - are exactly what a beginner
      // reaches for first. For these, `z` is the centre of the hole.
      const radius = (c.diameter ?? c.width) / 2 + tolerance
      const start: Vec3 = [c.x - dir[0] * 2, c.y - dir[1] * 2, c.z]
      piece = makeCylinder(radius, along + 2, start, dir)
    } else {
      const halfW = c.width / 2 + tolerance
      // For rectangular openings `z` is the base, matching how datasheets
      // dimension a socket sitting on a board.
      const zLo = c.z - tolerance
      const zHi = c.z + c.height + tolerance
      let lo: Vec3
      let hi: Vec3
      switch (c.side) {
        case '+x':
          lo = [c.x - 2, c.y - halfW, zLo]
          hi = [c.x + along, c.y + halfW, zHi]
          break
        case '-x':
          lo = [c.x - along, c.y - halfW, zLo]
          hi = [c.x + 2, c.y + halfW, zHi]
          break
        case '+y':
          lo = [c.x - halfW, c.y - 2, zLo]
          hi = [c.x + halfW, c.y + along, zHi]
          break
        case '-y':
          lo = [c.x - halfW, c.y - along, zLo]
          hi = [c.x + halfW, c.y + 2, zHi]
          break
      }
      piece = drawRectangle(hi[0] - lo[0], hi[1] - lo[1])
        .translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
        .sketchOnPlane('XY', lo[2])
        .extrude(hi[2] - lo[2])
    }

    if (placement.flipped) piece = piece.rotate(180, [0, 0, 0], [1, 0, 0])
    if (placement.rotation) piece = piece.rotate(placement.rotation, [0, 0, 0], [0, 0, 1])
    piece = piece.translate(placement.position)

    cutter = cutter ? cutter.fuse(piece) : piece
  }
  return cutter
}

/** How far a lid slice reaches sideways before being trimmed to the solid. */
const LID_REACH = 4000

/**
 * A grid of holes across a face, kept clear of its edges.
 *
 * Hexagons sit on the usual staggered grid: rows offset by half a pitch and
 * spaced pitch*sqrt(3)/2 apart, which is what makes the webs between them the
 * same width in every direction rather than pinching on the diagonal.
 */
function buildVentCutter(
  feature: Extract<Feature, { kind: 'vent' }>,
  frame: Frame,
  target: any,
): any | null {
  const [min, max] = target.boundingBox.bounds
  // How far the face runs in the plane's own axes, from the solid's corners.
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const [u, v] = frameToLocal(frame, [x, y, z])
        uMin = Math.min(uMin, u)
        uMax = Math.max(uMax, u)
        vMin = Math.min(vMin, v)
        vMax = Math.max(vMax, v)
      }
    }
  }

  const size = Math.max(feature.size, 0.2)
  const pitch = size + Math.max(feature.spacing, 0.2)
  const rowStep = feature.shape === 'hex' ? (pitch * Math.sqrt(3)) / 2 : pitch
  // Keep a whole hole plus the border clear of the edge.
  const inset = feature.margin + size / 2
  const u0 = uMin + inset
  const u1 = uMax - inset
  const v0 = vMin + inset
  const v1 = vMax - inset
  if (u1 < u0 || v1 < v0) return null

  const depth = feature.depth === 'through' ? THROUGH_LENGTH : feature.depth
  const centres: Vec2[] = []
  const midU = (u0 + u1) / 2
  const midV = (v0 + v1) / 2
  const addRow = (v: number, staggered: boolean) => {
    const shift = feature.shape === 'hex' && staggered ? pitch / 2 : 0
    for (let u = midU + shift; u <= u1 + 1e-9; u += pitch) centres.push([u, v])
    for (let u = midU + shift - pitch; u >= u0 - 1e-9; u -= pitch) centres.push([u, v])
  }
  let row = 0
  for (let v = midV; v <= v1 + 1e-9; v += rowStep) addRow(v, row++ % 2 === 1)
  row = 1
  for (let v = midV - rowStep; v >= v0 - 1e-9; v -= rowStep) addRow(v, row++ % 2 === 1)
  if (centres.length === 0) return null

  const outline = (row: number): Drawing => {
    switch (feature.shape) {
      case 'round':
        return drawCircle(size / 2)
      case 'square':
        return drawRectangle(size, size)
      case 'diamond':
        // A square stood on its corner. Measured point to point, so that the
        // number the user types is the span they can see.
        return drawPolysides(size / 2, 4).rotate(45)
      case 'triangle':
        // Alternate rows point the other way, which is what closes the gaps
        // that a grid of same-way triangles leaves between them.
        return drawPolysides(size / Math.sqrt(3), 3).rotate(row % 2 === 0 ? 0 : 180)
      case 'cross': {
        // Two overlapping bars. The arm is a third of the span, which keeps the
        // web between neighbouring crosses no thinner than the spacing asked
        // for even at the diagonal, where they come closest.
        const arm = size / 3
        return drawRectangle(size, arm).fuse(drawRectangle(arm, size))
      }
      case 'slot':
        // A louvre. Rounded ends because a square-ended slot concentrates
        // stress in exactly the corner a printed part splits at.
        return drawRoundedRectangle(size, Math.min(size, pitch) / 2, Math.min(size, pitch) / 4)
      default:
        // Measured across the flats, so the circumradius is size / sqrt(3).
        return drawPolysides(size / Math.sqrt(3), 6)
    }
  }

  let merged: Drawing | null = null
  if (feature.shape === 'gyroid') {
    merged = gyroidHoles(u0, u1, v0, v1, size, Math.max(feature.spacing, 0.2))
  } else {
    // Rows are numbered from the middle outwards so that alternating shapes
    // stay in step across the centre line.
    for (const [u, v] of centres) {
      const row = Math.round((v - midV) / rowStep)
      const piece = outline(((row % 2) + 2) % 2).translate(u, v)
      merged = merged ? merged.fuse(piece) : piece
    }
  }
  if (!merged) return null
  return sketchOn(merged, frame, CUT_MARGIN).extrude(-(depth + CUT_MARGIN))
}

/**
 * The gyroid, sliced.
 *
 * A gyroid is a three-dimensional surface, so what a flat panel can carry is a
 * slice through one: taking z = pi/4 leaves
 *
 *     f(u, v) = sin u cos v + (sin v + cos u) / sqrt 2
 *
 * and cutting away everything where f is above a threshold gives the woven
 * pattern people recognise. It is drawn by marching squares over that field
 * rather than by tiling a shape, because there is no repeating hole to tile -
 * the pattern is one continuous channel that wanders across the whole panel.
 *
 * The web comes out close to the spacing asked for rather than exactly at it:
 * the threshold that produces a given web width depends on how steeply the
 * field is changing, which varies over the pattern. The mean slope along the
 * contour is used, so it is right on average and a little uneven in places.
 */
function gyroidHoles(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  cell: number,
  web: number,
): Drawing | null {
  const k = (2 * Math.PI) / Math.max(cell, 1)
  const s = Math.SQRT1_2
  const f = (u: number, v: number) =>
    Math.sin(k * u) * Math.cos(k * v) + s * (Math.sin(k * v) + Math.cos(k * u))

  // The mean gradient of f along its zero contour, used to turn a web width in
  // millimetres into a threshold on f. Sampled rather than derived because the
  // closed form is not worth the trouble for a number this approximate.
  let gradSum = 0
  let gradN = 0
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const u = u0 + ((u1 - u0) * i) / 23
      const v = v0 + ((v1 - v0) * j) / 23
      if (Math.abs(f(u, v)) > 0.15) continue
      const h = 1e-4
      gradSum += Math.hypot(
        (f(u + h, v) - f(u - h, v)) / (2 * h),
        (f(u, v + h) - f(u, v - h)) / (2 * h),
      )
      gradN++
    }
  }
  const grad = gradN > 0 ? gradSum / gradN : k
  const threshold = (web / 2) * grad

  // Fine enough that the curve reads as a curve. Capped so a big panel with a
  // small cell does not take a minute to contour.
  const step = Math.max(Math.min(cell / 10, 1.2), 0.25)
  const nu = Math.min(Math.ceil((u1 - u0) / step) + 1, 400)
  const nv = Math.min(Math.ceil((v1 - v0) / step) + 1, 400)
  const du = (u1 - u0) / (nu - 1)
  const dv = (v1 - v0) / (nv - 1)

  // Sampled with the border forced negative, so every contour closes inside the
  // panel instead of running off the edge as an open curve.
  const grid: number[][] = []
  for (let i = 0; i < nu; i++) {
    grid[i] = []
    for (let j = 0; j < nv; j++) {
      const edge = i === 0 || j === 0 || i === nu - 1 || j === nv - 1
      grid[i][j] = edge ? -1 : f(u0 + i * du, v0 + j * dv) - threshold
    }
  }

  const loops = marchingSquares(grid, u0, v0, du, dv)
  let merged: Drawing | null = null
  for (const loop of loops) {
    if (loop.length < 4) continue
    let pen = draw(loop[0])
    for (let i = 1; i < loop.length; i++) pen = pen.lineTo(loop[i])
    let piece: Drawing
    try {
      piece = pen.close()
    } catch {
      // A degenerate loop - a contour that grazes a grid corner - is skipped
      // rather than aborting the whole pattern.
      continue
    }
    merged = merged ? merged.fuse(piece) : piece
  }
  return merged
}

/**
 * Trace the zero contours of a scalar grid as closed loops.
 *
 * Standard marching squares, with the four-way ambiguous cases resolved by the
 * value at the cell centre. Segments are then chained end to end by matching
 * their endpoints, which works here because every contour closes: the grid
 * border is forced negative by the caller.
 */
function marchingSquares(
  grid: number[][],
  u0: number,
  v0: number,
  du: number,
  dv: number,
): Vec2[][] {
  const nu = grid.length
  const nv = grid[0].length
  const segments: Array<[Vec2, Vec2]> = []
  /** Where along an edge the field crosses zero. */
  const lerp = (a: number, b: number): number => {
    const d = a - b
    return Math.abs(d) < 1e-12 ? 0.5 : a / d
  }

  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = grid[i][j]
      const b = grid[i + 1][j]
      const c = grid[i + 1][j + 1]
      const d = grid[i][j + 1]
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (code === 0 || code === 15) continue
      const x = u0 + i * du
      const y = v0 + j * dv
      const bottom: Vec2 = [x + du * lerp(a, b), y]
      const right: Vec2 = [x + du, y + dv * lerp(b, c)]
      const top: Vec2 = [x + du * lerp(d, c), y + dv]
      const left: Vec2 = [x, y + dv * lerp(a, d)]
      const push = (p: Vec2, q: Vec2) => segments.push([p, q])
      switch (code) {
        case 1:
        case 14:
          push(left, bottom)
          break
        case 2:
        case 13:
          push(bottom, right)
          break
        case 3:
        case 12:
          push(left, right)
          break
        case 4:
        case 11:
          push(right, top)
          break
        case 6:
        case 9:
          push(bottom, top)
          break
        case 7:
        case 8:
          push(left, top)
          break
        // The two saddles, where the corners alternate in sign and the contour
        // could join either pair. The centre value says which.
        case 5: {
          if ((a + b + c + d) / 4 > 0) {
            push(left, top)
            push(bottom, right)
          } else {
            push(left, bottom)
            push(right, top)
          }
          break
        }
        case 10: {
          if ((a + b + c + d) / 4 > 0) {
            push(left, bottom)
            push(right, top)
          } else {
            push(left, top)
            push(bottom, right)
          }
          break
        }
      }
    }
  }
  if (segments.length === 0) return []

  // Chain the segments into loops. Endpoints are matched on a grid rounded far
  // finer than the sampling, so two segments that meet at a shared crossing
  // agree exactly.
  const key = (p: Vec2) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`
  const bins = new Map<string, Array<[Vec2, Vec2]>>()
  for (const seg of segments) {
    for (const end of [key(seg[0]), key(seg[1])]) {
      const list = bins.get(end)
      if (list) list.push(seg)
      else bins.set(end, [seg])
    }
  }

  const used = new Set<Array<Vec2>>()
  const loops: Vec2[][] = []
  for (const start of segments) {
    if (used.has(start as unknown as Array<Vec2>)) continue
    used.add(start as unknown as Array<Vec2>)
    const loop: Vec2[] = [start[0], start[1]]
    let head = start[1]
    // Bounded so a malformed chain cannot spin forever.
    for (let guard = 0; guard < segments.length + 4; guard++) {
      const options = bins.get(key(head)) ?? []
      const next = options.find((seg) => !used.has(seg as unknown as Array<Vec2>))
      if (!next) break
      used.add(next as unknown as Array<Vec2>)
      const onward = key(next[0]) === key(head) ? next[1] : next[0]
      if (key(onward) === key(loop[0])) break
      loop.push(onward)
      head = onward
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

/** Evaluate one body's feature history into a single solid. */
export function evaluateBody(
  body: Body,
  ctx: EvalContext,
): { shape: any | null; errors: BuildError[] } {
  const errors: BuildError[] = []
  const sketches = new Map<string, SketchFeature>()
  let shape: any = null

  for (const feature of body.features) {
    if (feature.suppressed) continue
    try {
      switch (feature.kind) {
        case 'sketch': {
          sketches.set(feature.id, feature)
          break
        }

        case 'extrude':
        case 'revolve': {
          const sketchFeature = sketches.get(feature.sketchId)
          if (!sketchFeature) {
            errors.push({
              featureId: feature.id,
              message: 'The sketch this was built from is missing.',
              hint: 'It may have been deleted. Delete this step or point it at another sketch.',
            })
            break
          }
          const profile = sketchToProfile(sketchFeature.sketch)
          if (!profile.drawing) {
            errors.push({
              featureId: feature.id,
              message: 'That sketch does not enclose an area yet.',
              hint:
                profile.openChains > 0
                  ? `${profile.openChains} line(s) do not join up into a closed shape. Zoom in on the corners and drag the loose ends together.`
                  : 'Draw a closed shape - a rectangle or circle - before extruding.',
            })
            break
          }
          const frame = frameFromPlaneRef(sketchFeature.plane, ctx.shapes)

          if (feature.kind === 'extrude') {
            const distance = feature.reverse ? -feature.distance : feature.distance
            const offset = feature.symmetric ? -Math.abs(distance) / 2 : 0
            const length = feature.symmetric ? Math.abs(distance) : distance
            const solid = sketchOn(profile.drawing, frame, offset).extrude(length)
            shape = combine(shape, solid, feature.operation)
          } else {
            const axis: Vec3 = feature.axis === 'x' ? frame.xDir : frame.yDir
            const solid = sketchOn(profile.drawing, frame).revolve(axis, {
              origin: frame.origin,
            })
            shape = combine(shape, solid, feature.operation)
          }
          break
        }

        case 'move': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing here to move yet.',
              hint: 'Make a shape first, then move it.',
            })
            break
          }
          // Turn about the body's own centre, not the world origin, because
          // that is what the ring under your cursor looks like it will do.
          // Measured before any of the turns so the three axes stay
          // independent - otherwise turning about X would shift the centre
          // that the following turn about Y uses.
          const [bmin, bmax] = shape.boundingBox.bounds
          const centre: Vec3 = [
            (bmin[0] + bmax[0]) / 2,
            (bmin[1] + bmax[1]) / 2,
            (bmin[2] + bmax[2]) / 2,
          ]
          const [rx, ry, rz] = feature.rotation
          if (rx) shape = shape.rotate(rx, centre, [1, 0, 0])
          if (ry) shape = shape.rotate(ry, centre, [0, 1, 0])
          if (rz) shape = shape.rotate(rz, centre, [0, 0, 1])
          const [dx, dy, dz] = feature.offset
          if (dx || dy || dz) shape = shape.translate([dx, dy, dz])
          break
        }

        case 'box': {
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const base = feature.cornerRadius
            ? drawRoundedRectangle(feature.width, feature.depth, feature.cornerRadius)
            : drawRectangle(feature.width, feature.depth)
          const solid = sketchOn(
            base.translate(
              feature.origin[0] + feature.width / 2,
              feature.origin[1] + feature.depth / 2,
            ),
            frame,
          ).extrude(feature.height)
          shape = combine(shape, solid, feature.operation)
          break
        }

        case 'cylinder': {
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const solid = sketchOn(
            drawCircle(feature.radius).translate(feature.centre[0], feature.centre[1]),
            frame,
          ).extrude(feature.height)
          shape = combine(shape, solid, feature.operation)
          break
        }

        case 'fillet':
        case 'chamfer': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing to round or bevel yet.',
              hint: 'Add a solid shape before this step.',
            })
            break
          }
          const size = feature.kind === 'fillet' ? feature.radius : feature.distance
          const match = edgeMatcher(feature.edges)
          const config = (edge: any) => (match(edge) ? size : null)
          shape =
            feature.kind === 'fillet' ? shape.fillet(config) : shape.chamfer(config)
          break
        }

        case 'shell': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing to hollow out yet.',
              hint: 'Make a solid shape first.',
            })
            break
          }
          const open = feature.openFaces[0]
          if (!open) {
            errors.push({
              featureId: feature.id,
              message: 'No face was chosen to leave open.',
              hint: 'Right-click the face you want the opening on and hollow it out from there.',
            })
            break
          }
          // The finder chain ANDs its filters, so more than one opening would
          // ask for a face lying in two planes at once. One is the common case
          // - the underside of an enclosure - and is what this supports.
          const solid = shape
          const resolved = resolveFace(solid, open)
          const normal = resolved?.normal ?? open.normal
          const centre = resolved?.centre ?? open.anchor
          ctx.preShell.set(feature.id, {
            shape: solid.clone(),
            frame: makeFrame(centre, normal),
          })
          // Positive thickness hollows inward, leaving the outside size alone.
          // The opposite sign grows the part outward instead, which turns a
          // 60 mm box into a 65 mm one and is never what "hollow it out" means.
          shape = solid.shell(Math.abs(feature.thickness), (f: any) =>
            f.inPlane(new Plane(centre, null, normal)),
          )
          break
        }

        case 'hole': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing to drill into yet.',
              hint: 'Make a plate or a box first, then add holes.',
            })
            break
          }
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const positions = resolvePositions(feature.source, frame, ctx.doc)
          if (positions.length === 0) break
          const cutter = buildHoleCutter(feature, frame, positions)
          if (cutter) shape = shape.cut(cutter)
          break
        }

        case 'standoff': {
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const positions = resolvePositions(feature.source, frame, ctx.doc)
          if (positions.length === 0) break
          const { solid, bores } = buildStandoffs(feature, frame, positions)
          if (solid) shape = shape ? shape.fuse(solid) : solid
          if (bores && shape) shape = shape.cut(bores)
          break
        }

        case 'sphere': {
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const world = frameToWorld(frame, feature.centre)
          let ball: any = makeSphere(feature.radius).translate(world)
          if (feature.half) {
            // Slice off everything below the plane, leaving it flat side down.
            // The cutter has to be centred on the ball, not on the plane's
            // origin: a rectangle drawn at the origin misses a ball placed
            // anywhere else entirely, and the "dome" comes out a full sphere.
            const r = feature.radius
            const cutter = sketchOn(
              drawRectangle(r * 4, r * 4).translate(feature.centre[0], feature.centre[1]),
              frame,
              -r * 2,
            ).extrude(r * 2)
            ball = ball.cut(cutter)
          }
          shape = combine(shape, ball, feature.operation)
          break
        }

        case 'vent': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing to put vent holes in yet.',
              hint: 'Make a panel or a lid first.',
            })
            break
          }
          const frame = frameFromPlaneRef(feature.plane, ctx.shapes)
          const cutter = buildVentCutter(feature, frame, shape)
          if (!cutter) {
            errors.push({
              featureId: feature.id,
              message: 'No holes fitted inside the border you asked for.',
              hint: 'Try a smaller hole, tighter spacing, or a thinner edge border.',
            })
            break
          }
          shape = shape.cut(cutter)
          break
        }

        case 'lid': {
          const source = ctx.preShell.get(feature.shellFeatureId)
          if (!source) {
            errors.push({
              featureId: feature.id,
              message: 'The hollowing this lid belongs to is gone.',
              hint: 'It may have been deleted or turned off. Delete this lid, or hollow the part out again.',
            })
            break
          }
          // Take a slice of the *un-hollowed* solid at the opening: the material
          // that hollowing just removed, with the full outer profile rather
          // than a ring of wall.
          const slab = sketchOn(
            drawRectangle(LID_REACH, LID_REACH),
            source.frame,
            -feature.thickness,
          ).extrude(feature.thickness)
          let cap = source.shape.clone().intersect(slab)

          // Then take the rim back off. What is left is the hole itself, so the
          // lid drops into the opening flush with the outside rather than
          // sitting on top of it like a shoebox lid. Cutting the built shell
          // rather than insetting the profile means this follows whatever the
          // wall actually is - rounded corners, ribs, anything.
          const walls = ctx.shapes.get(feature.sourceBodyId)
          if (walls) cap = cap.cut(walls.clone())

          // And then the gap. There is no offset for a solid in replicad, so
          // the inset is got by hollowing the original again with walls that
          // much thicker and cutting *that* rim away as well: a wall of
          // thickness + clearance leaves an opening exactly clearance smaller
          // all round. It costs a second hollowing, which is why it is skipped
          // when no gap was asked for.
          const clearance = feature.clearance ?? 0
          if (clearance > 0) {
            try {
              const fat = source.shape
                .clone()
                .shell(Math.abs(feature.thickness) + clearance, (f: any) =>
                  f.inPlane(new Plane(source.frame.origin, null, source.frame.normal)),
                )
              cap = cap.cut(fat)
            } catch (e) {
              errors.push({
                featureId: feature.id,
                message: `Could not leave a gap round the lid: ${(e as Error).message}`,
                hint: 'Try a smaller gap, or set it to zero for a lid that is exactly the size of the opening.',
              })
            }
          }

          shape = combine(shape, cap, 'add')
          break
        }

        case 'combine': {
          if (!shape) {
            errors.push({
              featureId: feature.id,
              message: 'There is nothing here yet to combine with.',
              hint: 'Add a shape to this part first.',
            })
            break
          }
          const other = ctx.shapes.get(feature.otherBodyId)
          if (!other) {
            errors.push({
              featureId: feature.id,
              message: 'That other part has not been built yet.',
              hint: 'Parts are built top to bottom, so the one you are combining with has to sit above this one in the list.',
            })
            break
          }
          // Clone: the tool body may still be drawn, and may be combined into
          // more than one thing.
          shape = combine(shape, other.clone(), feature.operation)
          break
        }

        case 'portCutout': {
          if (!shape) break
          const placement = ctx.doc.placements.find((p) => p.id === feature.placementId)
          if (!placement) {
            errors.push({
              featureId: feature.id,
              message: 'The part these openings were made for is gone.',
              hint: 'Delete this step, or place the part again.',
            })
            break
          }
          const cutter = buildPortCutters(
            placement,
            feature.connectorIds,
            feature.tolerance,
          )
          if (cutter) shape = shape.cut(cutter)
          break
        }
      }
    } catch (e) {
      errors.push({
        featureId: feature.id,
        message: (e as Error)?.message || 'This step could not be built.',
        hint: hintForFailure(feature, (e as Error)?.message ?? ''),
      })
    }
  }

  return { shape, errors }
}

/** Translate kernel failures into something a beginner can act on. */
function hintForFailure(feature: Feature, message: string): string | undefined {
  const m = message.toLowerCase()
  if (feature.kind === 'fillet' || feature.kind === 'chamfer') {
    return 'The radius is probably too big for the edge it is being applied to. Try a smaller number.'
  }
  if (feature.kind === 'shell') {
    return 'Hollowing fails when the wall is thicker than the smallest detail on the shape. Try a thinner wall.'
  }
  if (m.includes('null') || m.includes('undefined')) {
    return 'Something this step depends on is missing. Check the steps above it.'
  }
  return undefined
}
