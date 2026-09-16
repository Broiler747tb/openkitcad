import {
  cast,
  downcast,
  drawCircle,
  drawPolysides,
  drawRectangle,
  genericSweep,
  getOC,
  makeHelix,
  measureVolume,
  type Drawing,
  type Plane,
} from 'replicad'
import { frameToWorld, makeFrame, v3, type Frame, type Vec3 } from '../core/math'
import type { BodyOperation, Feature, PlaneRef, SketchFeature } from '../doc/types'
import { chainTangent, sketchChains } from '../sketch/chains'
import {
  common,
  cut,
  draft as namedDraft,
  loft as namedLoft,
  moveFaces,
  nameShape,
  offsetFaces,
  sweep as namedSweep,
  transformNamedWith,
  type ElementMap,
  type NamedShape,
  type OC,
  type OcShape,
  type ProfileInput,
} from './naming'
import { chainBlueprint, sketchToProfile } from './profile'

export interface SolidBody {
  shape: any
  map: ElementMap<OcShape>
}

export interface SolidStage {
  bodies: Map<string, SolidBody & { key: string; featureId: string }>
  report: (severity: 'error' | 'warning', message: string, hint?: string, bodyId?: string) => void
  bodyName: (id: string) => string
  need: (id: string) => SolidBody | null
  set: (id: string, named: NamedShape) => void
  apply: (result: BodyOperation, named: NamedShape) => void
  planeOf: (ref: PlaneRef) => Frame
  sketch: (id: string) => { feature: SketchFeature; frame: Frame } | null
  toPlane: (frame: Frame) => Plane
  profileFace: (drawing: Drawing, frame: Frame) => any
}

type Section = ProfileInput & { release: () => void }

function quietly(shape: { delete(): void } | null | undefined) {
  try {
    shape?.delete()
  } catch {
    return
  }
}

function frameMatrix(frame: Frame): number[] {
  const { xDir: x, yDir: y, normal: z, origin: o } = frame
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]
}

function named(oc: OC, featureId: string, shape: any): NamedShape {
  const wrapped = shape.wrapped ?? shape
  return nameShape(oc, featureId, downcast(wrapped) as unknown as OcShape)
}

function hasSolid(oc: any, shape: any): boolean {
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  )
  const found = explorer.More()
  explorer.delete()
  return found
}

function newBodyOf(stage: SolidStage, result: BodyOperation, what: string): string | null {
  if (result.kind === 'newBody') return result.bodyId
  stage.report('error', `A ${what} surface is always a new body.`, 'Set the operation to New Body.')
  return null
}

function profileSection(
  stage: SolidStage,
  sketchId: string,
  profiles: readonly string[] | undefined,
): Section | null {
  const found = stage.sketch(sketchId)
  if (!found) {
    stage.report(
      'error',
      'A sketch this step uses is missing.',
      'It may have been deleted, suppressed or rolled back.',
    )
    return null
  }
  const profile = sketchToProfile(found.feature.sketch, profiles ? [...profiles] : undefined)
  if (!profile.ok) {
    stage.report('error', profile.message, profile.hint)
    return null
  }
  if (profile.loops !== 1) {
    stage.report(
      'error',
      `${found.feature.name} gives ${profile.loops} separate shapes; each section needs exactly one.`,
      'Pick a single closed area of the sketch.',
    )
    return null
  }
  const face = stage.profileFace(profile.drawing, found.frame)
  const wire = face.outerWire()
  return {
    profile: wire.wrapped,
    sketch: found.feature.sketch,
    frame: found.frame,
    pieces: profile.pieces,
    release: () => {
      quietly(wire)
      quietly(face)
    },
  }
}

function pathOf(stage: SolidStage, sketchId: string) {
  const found = stage.sketch(sketchId)
  if (!found) {
    stage.report('error', 'The path sketch is missing.', 'Pick another sketch for the path.')
    return null
  }
  const chains = sketchChains(found.feature.sketch)
  if (chains.length !== 1) {
    stage.report(
      'error',
      chains.length
        ? `The path sketch has ${chains.length} separate runs of curves. A path has to be one connected run.`
        : 'The path sketch has no curves in it.',
      'Delete the extra curves, or join their ends together.',
    )
    return null
  }
  const chain = chains[0]
  const wire = chainBlueprint(found.feature.sketch, chain).sketchOnPlane(
    stage.toPlane(found.frame),
  ).wire
  const tangent = chainTangent(found.feature.sketch, chain)
  const frame = found.frame
  const start = frameToWorld(frame, tangent.at)
  const direction = v3.norm(
    v3.add(v3.scale(frame.xDir, tangent.direction[0]), v3.scale(frame.yDir, tangent.direction[1])),
  )
  return { wire, start, direction, sketchNormal: frame.normal }
}

function sectionDrawing(kind: string, size: number): Drawing {
  if (kind === 'square') return drawRectangle(size, size)
  if (kind === 'triangular' || kind.startsWith('triangle')) {
    return drawPolysides(size / Math.sqrt(3), 3)
  }
  return drawCircle(size / 2)
}

function halfSpace(oc: any, frame: Frame, reach: number): any {
  const box = new oc.BRepPrimAPI_MakeBox_2(reach * 2, reach * 2, reach)
  const local = cast(box.Shape())
  box.delete()
  const placed = local.translate([-reach, -reach, 0])
  const trsf = new oc.gp_Trsf_1()
  const m = frameMatrix(frame)
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14])
  const builder = new oc.BRepBuilderAPI_Transform_2(placed.wrapped, trsf, true)
  const result = cast(builder.ModifiedShape(placed.wrapped))
  builder.delete()
  trsf.delete()
  return result
}

function boundsOf(bodies: readonly SolidBody[]): { centre: Vec3; reach: number } {
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const body of bodies) {
    const [min, max] = body.shape.boundingBox.bounds
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min[i])
      hi[i] = Math.max(hi[i], max[i])
    }
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  return { centre, reach: Math.max(10, v3.len(v3.sub(hi, lo)) * 2) }
}

export function runSolidStep(feature: Feature, stage: SolidStage): boolean {
  const oc = getOC() as unknown as OC
  const occ = oc as any
  switch (feature.kind) {
    case 'loft': {
      if (feature.sections.length < 2) {
        stage.report('error', 'Loft needs at least two profiles.', 'Pick another profile.')
        return true
      }
      const sections: Section[] = []
      try {
        for (const section of feature.sections) {
          const made = profileSection(stage, section.sketchId, section.profiles)
          if (!made) return true
          sections.push(made)
        }
        const result = namedLoft(oc, {
          featureId: feature.id,
          sections,
          solid: !feature.surface,
          ruled: feature.ruled,
        })
        if (feature.surface) {
          const bodyId = newBodyOf(stage, feature.result, 'loft')
          if (bodyId) stage.set(bodyId, result)
        } else {
          stage.apply(feature.result, result)
        }
      } finally {
        for (const section of sections) section.release()
      }
      return true
    }

    case 'sweep': {
      const profile = profileSection(stage, feature.sketchId, feature.profiles)
      if (!profile) return true
      try {
        const path = pathOf(stage, feature.pathSketchId)
        if (!path) return true
        const result = namedSweep(oc, {
          featureId: feature.id,
          ...profile,
          spine: path.wire.wrapped,
          frenet: false,
          corners: 'right',
          solid: !feature.surface,
        })
        if (feature.surface) {
          const bodyId = newBodyOf(stage, feature.result, 'sweep')
          if (bodyId) stage.set(bodyId, result)
        } else {
          stage.apply(feature.result, result)
        }
      } finally {
        profile.release()
      }
      return true
    }

    case 'coil': {
      const radius = feature.diameter / 2
      if (!(radius > 0) || !(feature.revolutions > 0) || !(feature.height > 0)) {
        stage.report('error', 'Diameter, revolutions and height all have to be above zero.')
        return true
      }
      if (feature.sectionSize >= feature.diameter) {
        stage.report(
          'error',
          'The section is as wide as the coil, so the turns would cut through the middle.',
          'Use a smaller section or a larger diameter.',
        )
        return true
      }
      const pitch = feature.height / feature.revolutions
      if (feature.sectionSize >= pitch) {
        stage.report(
          'warning',
          'The section is taller than the gap between turns, so the turns touch each other.',
        )
      }
      const helix = makeHelix(
        pitch,
        feature.height,
        radius,
        [0, 0, 0],
        [0, 0, 1],
        feature.clockwise,
      )
      const sectionFrame: Frame = {
        origin: [radius, 0, 0],
        xDir: [1, 0, 0],
        yDir: [0, 0, 1],
        normal: [0, -1, 0],
      }
      const drawing =
        feature.section === 'triangleInside'
          ? sectionDrawing('triangle', feature.sectionSize).rotate(180)
          : sectionDrawing(feature.section, feature.sectionSize)
      const section = (drawing.sketchOnPlane(stage.toPlane(sectionFrame)) as any).wire
      const local = genericSweep(section, helix, { frenet: true }, false)
      const frame = stage.planeOf(feature.plane)
      const origin = frameToWorld(frame, feature.centre)
      const placed = transformNamedWith(
        oc,
        feature.id,
        named(oc, `${feature.id}:local`, local),
        (trsf) => {
          const m = frameMatrix({ ...frame, origin })
          trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14])
        },
      )
      stage.apply(feature.result, placed)
      return true
    }

    case 'pipe': {
      const path = pathOf(stage, feature.pathSketchId)
      if (!path) return true
      if (!(feature.size > 0)) {
        stage.report('error', 'The section size has to be above zero.')
        return true
      }
      const frame = makeFrame(path.start, path.direction, path.sketchNormal)
      const sweepOf = (size: number) => {
        const section = () =>
          (sectionDrawing(feature.section, size).sketchOnPlane(stage.toPlane(frame)) as any).wire
        try {
          return genericSweep(section(), path.wire, { transitionMode: 'right' }, false)
        } catch {
          return genericSweep(section(), path.wire, { transitionMode: 'transformed' }, false)
        }
      }
      let solid: any = sweepOf(feature.size)
      if (feature.hollow) {
        const inner = feature.size - 2 * feature.thickness
        if (!(inner > 0)) {
          stage.report('error', 'The wall is as thick as the pipe, so there is no hole left.')
          return true
        }
        solid = solid.cut(sweepOf(inner))
      }
      stage.apply(feature.result, named(oc, feature.id, solid))
      return true
    }

    case 'thicken': {
      const source = stage.need(feature.sourceBodyId)
      if (!source) return true
      if (hasSolid(occ, source.shape.wrapped)) {
        stage.report(
          'error',
          `${stage.bodyName(feature.sourceBodyId)} is already a solid.`,
          'Thicken works on surface bodies.',
          feature.sourceBodyId,
        )
        return true
      }
      let base = source.shape.wrapped
      let shifted: any = null
      if (feature.symmetric) {
        const offset = offsetFaces(oc, {
          featureId: `${feature.id}:half`,
          bodyId: feature.sourceBodyId,
          body: { shape: base, map: source.map },
          faces: 'all',
          distance: -feature.thickness / 2,
        })
        offset.map.dispose()
        shifted = offset.shape
        base = shifted
      }
      const builder = new occ.BRepOffsetAPI_MakeThickSolid()
      try {
        builder.MakeThickSolidBySimple(base, feature.thickness)
        if (!builder.IsDone()) throw new Error('The surface could not be thickened.')
        const thick = builder.Shape()
        const inverted = measureVolume(cast(thick) as any) < 0
        stage.apply(feature.result, named(oc, feature.id, inverted ? thick.Reversed() : thick))
      } finally {
        builder.delete()
        shifted?.delete()
      }
      return true
    }

    case 'patch': {
      const found = stage.sketch(feature.sketchId)
      if (!found) {
        stage.report('error', 'The sketch this patch fills is missing.')
        return true
      }
      const profile = sketchToProfile(found.feature.sketch, feature.profiles)
      if (!profile.ok) {
        stage.report('error', profile.message, profile.hint)
        return true
      }
      stage.set(
        feature.bodyId,
        named(oc, feature.id, stage.profileFace(profile.drawing, found.frame)),
      )
      return true
    }

    case 'bodyPattern': {
      const bodies = feature.bodyIds.map((id) => stage.need(id))
      if (bodies.some((body) => !body)) return true
      const transforms: Array<(trsf: any, scratch: any) => void> = []
      if (feature.pattern === 'rectangular') {
        const axis = (name: 'x' | 'y' | 'z'): Vec3 =>
          name === 'x' ? [1, 0, 0] : name === 'y' ? [0, 1, 0] : [0, 0, 1]
        for (let i = 0; i < Math.max(1, feature.countOne); i++) {
          for (let j = 0; j < Math.max(1, feature.countTwo); j++) {
            if (!i && !j) continue
            const shift = v3.add(
              v3.scale(axis(feature.axisOne), i * feature.spacingOne),
              v3.scale(axis(feature.axisTwo), j * feature.spacingTwo),
            )
            transforms.push((trsf, scratch) =>
              trsf.SetTranslation_1(scratch.track(new occ.gp_Vec_4(shift[0], shift[1], shift[2]))),
            )
          }
        }
      } else {
        const count = Math.max(1, feature.count)
        const full = Math.abs(feature.angle) >= 360 - 1e-9
        const step = count > 1 ? feature.angle / (full ? count : count - 1) : 0
        for (let k = 1; k < count; k++) {
          transforms.push((trsf, scratch) => {
            const direction =
              feature.axis === 'x' ? [1, 0, 0] : feature.axis === 'y' ? [0, 1, 0] : [0, 0, 1]
            const ax = scratch.track(
              new occ.gp_Ax1_2(
                scratch.track(new occ.gp_Pnt_3(0, 0, 0)),
                scratch.track(new occ.gp_Dir_4(direction[0], direction[1], direction[2])),
              ),
            )
            trsf.SetRotation_1(ax, (step * k * Math.PI) / 180)
          })
        }
      }
      const needed = transforms.length * feature.bodyIds.length
      if (feature.newBodyIds.length < needed) {
        stage.report(
          'error',
          'The pattern has more copies than when it was made.',
          'Edit the pattern and OK it again.',
        )
        return true
      }
      transforms.forEach((configure, copy) => {
        feature.bodyIds.forEach((id, index) => {
          const body = bodies[index]!
          stage.set(
            feature.newBodyIds[copy * feature.bodyIds.length + index],
            transformNamedWith(
              oc,
              `${feature.id}:${copy}`,
              { shape: body.shape.wrapped, map: body.map },
              configure,
            ),
          )
        })
      })
      return true
    }

    case 'mirror': {
      const bodies = feature.bodyIds.map((id) => stage.need(id))
      if (bodies.some((body) => !body)) return true
      if (feature.newBodyIds.length < feature.bodyIds.length) {
        stage.report('error', 'Edit the mirror and OK it again.')
        return true
      }
      const frame = stage.planeOf(feature.plane)
      feature.bodyIds.forEach((id, index) => {
        const body = bodies[index]!
        stage.set(
          feature.newBodyIds[index],
          transformNamedWith(
            oc,
            feature.id,
            { shape: body.shape.wrapped, map: body.map },
            (trsf, scratch) => {
              const axes = scratch.track(
                new occ.gp_Ax2_3(
                  scratch.track(new occ.gp_Pnt_3(...frame.origin)),
                  scratch.track(new occ.gp_Dir_4(...frame.normal)),
                ),
              )
              trsf.SetMirror_3(axes)
            },
          ),
        )
      })
      return true
    }

    case 'splitBody': {
      const body = stage.need(feature.bodyId)
      if (!body) return true
      const frame = stage.planeOf(feature.plane)
      const { centre, reach } = boundsOf([body])
      const along = v3.dot(v3.sub(centre, frame.origin), frame.normal)
      const origin = v3.sub(centre, v3.scale(frame.normal, along))
      const tool = halfSpace(occ, { ...frame, origin }, reach)
      const target = { shape: body.shape.wrapped, map: body.map }
      const tools = () => [named(oc, `${feature.id}:half`, tool)]
      const front = common(oc, { featureId: feature.id, target, tools: tools() })
      const back = cut(oc, { featureId: feature.id, target, tools: tools() })
      tool.delete()
      const emptyFront = measureVolume(cast(front.shape) as any) < 1e-9
      const emptyBack = measureVolume(cast(back.shape) as any) < 1e-9
      if (emptyFront || emptyBack) {
        front.map.dispose()
        back.map.dispose()
        stage.report(
          'error',
          `The plane does not cut through ${stage.bodyName(feature.bodyId)}.`,
          'Move the plane so it passes through the body.',
          feature.bodyId,
        )
        return true
      }
      stage.set(feature.bodyId, front)
      stage.set(feature.newBodyId, back)
      return true
    }

    case 'scale': {
      const bodies = feature.bodyIds.map((id) => stage.need(id))
      if (bodies.some((body) => !body)) return true
      if (!(feature.factor > 0)) {
        stage.report('error', 'The scale has to be above zero.')
        return true
      }
      const { centre } = boundsOf(bodies as SolidBody[])
      feature.bodyIds.forEach((id, index) => {
        const body = bodies[index]!
        stage.set(
          id,
          transformNamedWith(
            oc,
            feature.id,
            { shape: body.shape.wrapped, map: body.map },
            (trsf, scratch) =>
              trsf.SetScale(scratch.track(new occ.gp_Pnt_3(...centre)), feature.factor),
          ),
        )
      })
      return true
    }

    case 'stitch': {
      const bodies = feature.bodyIds.map((id) => stage.need(id))
      if (bodies.some((body) => !body)) return true
      const sewing = new occ.BRepBuilderAPI_Sewing(
        Math.max(1e-6, feature.tolerance),
        true,
        true,
        true,
        false,
      )
      const progress = new occ.Message_ProgressRange_1()
      try {
        for (const body of bodies) sewing.Add(body!.shape.wrapped)
        sewing.Perform(progress)
        let result = sewing.SewedShape()
        const explorer = new occ.TopExp_Explorer_2(
          result,
          occ.TopAbs_ShapeEnum.TopAbs_SHELL,
          occ.TopAbs_ShapeEnum.TopAbs_SHAPE,
        )
        const shells: any[] = []
        for (; explorer.More(); explorer.Next()) shells.push(occ.TopoDS.Shell_1(explorer.Current()))
        explorer.delete()
        if (shells.length === 1 && occ.BRep_Tool.IsClosed_1(shells[0])) {
          const fix = new occ.ShapeFix_Solid_1()
          const solid = fix.SolidFromShell(shells[0])
          fix.delete()
          result.delete()
          result = solid
        } else {
          stage.report(
            'warning',
            'The surfaces joined, but they do not close all the way round, so the result is still a surface.',
          )
        }
        stage.set(feature.bodyIds[0], named(oc, feature.id, result))
        for (const id of feature.bodyIds.slice(1)) stage.bodies.delete(id)
      } finally {
        progress.delete()
        sewing.delete()
      }
      return true
    }

    case 'unstitch': {
      const body = stage.need(feature.bodyId)
      if (!body) return true
      const faces: any[] = cast(body.shape.wrapped).faces
      const slots = [feature.bodyId, ...feature.newBodyIds]
      if (faces.length > slots.length) {
        stage.report(
          'warning',
          `The body now has ${faces.length} faces; the last ${faces.length - slots.length + 1} stay together.`,
          'Edit this step to give every face its own body.',
          feature.bodyId,
        )
      }
      slots.forEach((id, index) => {
        if (index >= faces.length) return
        if (index === slots.length - 1 && faces.length > slots.length) {
          const builder = new occ.TopoDS_Builder()
          const compound = new occ.TopoDS_Compound()
          builder.MakeCompound(compound)
          for (const face of faces.slice(index)) builder.Add(compound, face.wrapped)
          stage.set(id, named(oc, `${feature.id}:${index}`, compound))
          builder.delete()
          return
        }
        stage.set(id, named(oc, `${feature.id}:${index}`, faces[index]))
      })
      return true
    }

    case 'surfaceOffset': {
      const source = stage.need(feature.sourceBodyId)
      if (!source) return true
      stage.set(
        feature.bodyId,
        offsetFaces(oc, {
          featureId: feature.id,
          bodyId: feature.sourceBodyId,
          body: { shape: source.shape.wrapped, map: source.map },
          faces: 'all',
          distance: feature.distance,
        }),
      )
      return true
    }

    case 'offsetFace':
    case 'draft': {
      const body = stage.need(feature.bodyId)
      if (!body) return true
      if (!feature.faces.length) {
        stage.report('error', 'No faces were picked.', 'Edit this step and pick faces to move.')
        return true
      }
      if (feature.faces.some((ref) => ref.bodyId !== feature.bodyId || ref.kind !== 'face')) {
        stage.report(
          'error',
          'A face picked for this step belongs to a different body.',
          'Edit this step and pick faces on the body it changes.',
        )
        return true
      }
      const names = feature.faces.map((ref) => ref.name)
      const target = { shape: body.shape.wrapped, map: body.map }
      if (feature.kind === 'offsetFace') {
        stage.set(
          feature.bodyId,
          moveFaces(oc, {
            featureId: feature.id,
            bodyId: feature.bodyId,
            body: target,
            faces: names,
            distance: feature.distance,
          }),
        )
        return true
      }
      const frame = stage.planeOf(feature.plane)
      stage.set(
        feature.bodyId,
        namedDraft(oc, {
          featureId: feature.id,
          bodyId: feature.bodyId,
          body: target,
          faces: names,
          pullDirection: feature.flip ? v3.scale(frame.normal, -1) : frame.normal,
          angle: feature.angle,
          neutralPlane: { origin: frame.origin, normal: frame.normal },
        }),
      )
      return true
    }

    case 'reverseNormal': {
      for (const id of feature.bodyIds) {
        const body = stage.need(id)
        if (!body) return true
        stage.set(id, named(oc, feature.id, body.shape.wrapped.Reversed()))
      }
      return true
    }
  }
  return false
}
