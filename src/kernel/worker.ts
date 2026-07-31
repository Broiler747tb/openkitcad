/**
 * The geometry kernel worker.
 *
 * OpenCascade is an ~11 MB WASM module and every boolean or fillet it performs
 * is synchronous and can take hundreds of milliseconds. Running it on the main
 * thread would stutter the viewport on every edit, so the whole kernel lives
 * here and the UI talks to it over Comlink.
 *
 * The worker owns all B-rep shapes. Nothing that crosses back to the main
 * thread is anything but plain numbers.
 */
import * as Comlink from 'comlink'
import initOpenCascade from 'replicad-opencascadejs/src/replicad_single.js'
import wasmUrl from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import {
  drawProjection,
  drawRectangle,
  exportSTEP,
  measureDistanceBetween,
  measureVolume,
  setOC,
  type ProjectionPlane,
} from 'replicad'
import type { OkcDocument } from '../doc/types'
import { CATEGORY_COLOUR, getPart } from '../catalogue'
import { buildPlacement, evaluateBody } from './build'
import { flattenSvgPaths } from '../export/svgpath'
import type {
  Clash,
  EdgeData,
  EvaluateResult,
  KernelError,
  MeshData,
  PrintWarning,
  ProjectionResult,
  ShapeResult,
} from './types'

let ocReady: Promise<void> | null = null

/** Boot OpenCascade exactly once, no matter how many calls race for it. */
function ensureOC(): Promise<void> {
  if (!ocReady) {
    ocReady = initOpenCascade({ locateFile: () => wasmUrl }).then((OC) => {
      setOC(OC as never)
    })
  }
  return ocReady
}

/** Fine enough that a 3 mm hole still looks round. */
const MESH_TOLERANCE = 0.02
const MESH_ANGULAR_TOLERANCE = 12

/**
 * Shapes from the last successful evaluation, kept alive so exporters and
 * measurement tools can work without rebuilding the whole document.
 */
const liveShapes = new Map<string, any>()

function tessellate(
  shape: any,
  id: string,
  kind: ShapeResult['kind'],
  name: string,
  colour: string,
): ShapeResult {
  const raw = shape.mesh({
    tolerance: MESH_TOLERANCE,
    angularTolerance: MESH_ANGULAR_TOLERANCE,
  })
  const rawEdges = shape.meshEdges({ keepMesh: true })

  const mesh: MeshData = {
    vertices: new Float32Array(raw.vertices),
    triangles: new Uint32Array(raw.triangles),
    normals: new Float32Array(raw.normals),
    faceGroups: (raw.faceGroups ?? []).map((g: any) => ({
      start: g.start,
      count: g.count,
      faceId: g.faceId,
    })),
  }
  const edges: EdgeData = {
    lines: new Float32Array(rawEdges.lines),
    edgeGroups: (rawEdges.edgeGroups ?? []).map((g: any) => ({
      start: g.start,
      count: g.count,
      edgeId: g.edgeId,
    })),
  }

  const [bmin, bmax] = shape.boundingBox.bounds
  let volume = 0
  try {
    volume = measureVolume(shape)
  } catch {
    volume = 0
  }

  return {
    id,
    kind,
    name,
    colour,
    mesh,
    edges,
    volume,
    bounds: [bmin[0], bmin[1], bmin[2], bmax[0], bmax[1], bmax[2]],
  }
}

const api = {
  /** Resolves once the kernel can accept work. The UI shows a splash until then. */
  async ready(): Promise<boolean> {
    await ensureOC()
    return true
  },

  /**
   * Rebuild the whole document. Simple and predictable: for models of the size
   * this app targets a full rebuild is a few tens of milliseconds, which is far
   * cheaper than the bugs a partial-invalidation cache would introduce.
   */
  async evaluate(doc: OkcDocument): Promise<EvaluateResult> {
    await ensureOC()
    const t0 = performance.now()
    const shapes: ShapeResult[] = []
    const errors: KernelError[] = []
    liveShapes.clear()

    // Placements first: bodies may reference their faces and hole patterns.
    for (const placement of doc.placements) {
      if (!placement.visible) continue
      const part = getPart(placement.partId)
      try {
        const solid = buildPlacement(placement)
        if (!solid) continue
        liveShapes.set(placement.id, solid)
        shapes.push(
          tessellate(
            solid,
            placement.id,
            'placement',
            placement.name,
            part ? CATEGORY_COLOUR[part.category] : '#7f878f',
          ),
        )
      } catch (e) {
        errors.push({
          featureId: placement.id,
          bodyId: placement.id,
          message: `Could not build "${placement.name}": ${(e as Error).message}`,
          hint: 'This is a problem with the catalogue part, not with your design.',
        })
      }
    }

    const built = new Map<string, any>()
    for (const body of doc.bodies) {
      const { shape, errors: bodyErrors } = evaluateBody(body, { doc, shapes: built })
      for (const e of bodyErrors) errors.push({ ...e, bodyId: body.id })
      if (!shape) continue
      built.set(body.id, shape)
      liveShapes.set(body.id, shape)
      if (!body.visible) continue
      try {
        shapes.push(tessellate(shape, body.id, 'body', body.name, body.colour))
      } catch (e) {
        errors.push({
          featureId: body.features.at(-1)?.id ?? body.id,
          bodyId: body.id,
          message: `Built, but could not be displayed: ${(e as Error).message}`,
        })
      }
    }

    return { shapes, errors, elapsedMs: Math.round(performance.now() - t0) }
  },

  /** STEP export of the named shapes, as raw bytes for the main thread to save. */
  async exportStep(ids: string[], name: string): Promise<ArrayBuffer> {
    await ensureOC()
    const configs = ids
      .filter((id) => liveShapes.has(id))
      .map((id) => ({ shape: liveShapes.get(id), name: `${name}-${id}` }))
    if (configs.length === 0) throw new Error('Nothing to export.')
    const blob = exportSTEP(configs as never)
    return blob.arrayBuffer()
  },

  /**
   * Flatten a shape to 2D for the laser-cutting and drill-template exporters.
   * Uses a true hidden-line projection so the result is the real outline, not
   * a silhouette of the triangle mesh.
   */
  async project(id: string, plane: ProjectionPlane = 'XY'): Promise<ProjectionResult> {
    await ensureOC()
    const shape = liveShapes.get(id)
    if (!shape) throw new Error('That shape is not built.')
    const { visible } = drawProjection(shape, plane)
    const paths = visible.toSVGPaths()
    const flat = flattenSvgPaths(Array.isArray(paths[0]) ? (paths as string[][]).flat() : (paths as string[]))
    return flat
  },

  /**
   * Find parts that physically overlap something they should not.
   *
   * Uses real boolean intersections rather than comparing bounding boxes: a
   * bounding-box check on an L-bracket reports clashes that are not there,
   * which trains people to ignore the warning entirely.
   */
  async clearance(doc: OkcDocument): Promise<Clash[]> {
    await ensureOC()
    const clashes: Clash[] = []

    // Keepout volumes declared by catalogue parts, in world space.
    const keepouts: Array<{ label: string; solid: any }> = []
    for (const placement of doc.placements) {
      if (!placement.visible) continue
      const part = getPart(placement.partId)
      for (const k of part?.keepouts ?? []) {
        try {
          let box: any = drawRectangle(k.w, k.h)
            .translate(k.x + k.w / 2, k.y + k.h / 2)
            .sketchOnPlane('XY', k.z)
            .extrude(k.height)
          if (placement.flipped) box = box.rotate(180, [0, 0, 0], [1, 0, 0])
          if (placement.rotation) box = box.rotate(placement.rotation, [0, 0, 0], [0, 0, 1])
          keepouts.push({
            label: `${placement.name} - ${k.label}`,
            solid: box.translate(placement.position),
          })
        } catch {
          // A malformed keepout must not take the whole check down.
        }
      }
    }

    const bodies = doc.bodies
      .filter((b) => liveShapes.has(b.id))
      .map((b) => ({ label: b.name, solid: liveShapes.get(b.id) }))

    const overlap = (a: any, b: any) => {
      try {
        const common = a.clone().intersect(b.clone())
        const volume = measureVolume(common)
        if (!(volume > 0.5)) return null
        const [min, max] = common.boundingBox.bounds
        return {
          volume,
          at: [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
          ] as [number, number, number],
        }
      } catch {
        return null
      }
    }

    for (const k of keepouts) {
      for (const body of bodies) {
        const hit = overlap(k.solid, body.solid)
        if (hit) {
          clashes.push({
            aLabel: k.label,
            bLabel: body.label,
            overlap: Math.cbrt(hit.volume),
            at: hit.at,
          })
        }
      }
    }

    // Placed parts colliding with each other.
    const solids = doc.placements
      .filter((p) => p.visible && liveShapes.has(p.id))
      .map((p) => ({ label: p.name, solid: liveShapes.get(p.id) }))
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const hit = overlap(solids[i].solid, solids[j].solid)
        if (hit) {
          clashes.push({
            aLabel: solids[i].label,
            bLabel: solids[j].label,
            overlap: Math.cbrt(hit.volume),
            at: hit.at,
          })
        }
      }
    }

    return clashes
  },

  /**
   * Checks worth running before sending a part to a printer.
   *
   * The wall-thickness figure is an estimate from the volume-to-area ratio, not
   * a true medial-axis measurement, and is labelled as such in the UI. An
   * honest estimate people can calibrate against beats a precise-looking number
   * that is wrong on anything but a flat slab.
   */
  async printPrep(
    ids: string[],
    options: { nozzle: number; bed: [number, number, number] },
  ): Promise<PrintWarning[]> {
    await ensureOC()
    const out: PrintWarning[] = []

    for (const id of ids) {
      const shape = liveShapes.get(id)
      if (!shape) continue
      const name = id
      const [min, max] = shape.boundingBox.bounds
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

      const fitsFlat = size[0] <= options.bed[0] && size[1] <= options.bed[1]
      const fitsTurned = size[1] <= options.bed[0] && size[0] <= options.bed[1]
      if (!fitsFlat && !fitsTurned) {
        out.push({
          shapeId: id,
          shapeName: name,
          severity: 'error',
          message: `Too big for the print bed: ${size[0].toFixed(0)} x ${size[1].toFixed(0)} mm against a ${options.bed[0]} x ${options.bed[1]} mm bed.`,
          hint: 'Split it into pieces, or set a larger bed size.',
        })
      } else if (!fitsFlat) {
        out.push({
          shapeId: id,
          shapeName: name,
          severity: 'info',
          message: 'Only fits if you rotate it 90 degrees on the bed.',
        })
      }
      if (size[2] > options.bed[2]) {
        out.push({
          shapeId: id,
          shapeName: name,
          severity: 'error',
          message: `Taller than the printer allows: ${size[2].toFixed(0)} mm against ${options.bed[2]} mm.`,
        })
      }

      // Overhangs, measured off the triangles rather than guessed.
      const raw = shape.mesh({ tolerance: 0.05, angularTolerance: 20 })
      let downwardArea = 0
      let totalArea = 0
      let flatBottomArea = 0
      const v = raw.vertices
      for (let t = 0; t < raw.triangles.length; t += 3) {
        const a = raw.triangles[t] * 3
        const b = raw.triangles[t + 1] * 3
        const c = raw.triangles[t + 2] * 3
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2]
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2]
        const nx = uy * wz - uz * wy
        const ny = uz * wx - ux * wz
        const nz = ux * wy - uy * wx
        const len = Math.hypot(nx, ny, nz)
        if (len < 1e-9) continue
        const area = len / 2
        totalArea += area
        const cosDown = -nz / len
        // Steeper than 45 degrees from vertical needs support.
        if (cosDown > 0.7071) {
          const lowest = Math.min(v[a + 2], v[b + 2], v[c + 2])
          if (lowest - min[2] < 0.05) flatBottomArea += area
          else downwardArea += area
        }
      }

      if (totalArea > 0 && downwardArea / totalArea > 0.06) {
        out.push({
          shapeId: id,
          shapeName: name,
          severity: 'warning',
          message: `About ${Math.round((downwardArea / totalArea) * 100)}% of the surface overhangs and would need supports.`,
          hint: 'Turning the part over, or adding a chamfer instead of an overhang, often removes the need entirely.',
        })
      }
      if (flatBottomArea < 1) {
        out.push({
          shapeId: id,
          shapeName: name,
          severity: 'warning',
          message: 'Nothing flat is touching the bed.',
          hint: 'Parts print far better with a flat face down. Try a different orientation.',
        })
      }

      const volume = measureVolume(shape)
      if (totalArea > 0 && volume > 0) {
        const estimated = (2 * volume) / totalArea
        if (estimated < options.nozzle * 2) {
          out.push({
            shapeId: id,
            shapeName: name,
            severity: 'warning',
            message: `Average wall works out around ${estimated.toFixed(1)} mm, which is thin for a ${options.nozzle} mm nozzle.`,
            hint: 'This is an estimate from volume against surface area, so check the thinnest wall yourself. Aim for at least two nozzle widths.',
          })
        }
      }
    }

    return out
  },

  /** Straight-line distance between two built shapes, in mm. */
  async distanceBetween(a: string, b: string): Promise<number | null> {
    await ensureOC()
    const shapeA = liveShapes.get(a)
    const shapeB = liveShapes.get(b)
    if (!shapeA || !shapeB) return null
    try {
      return measureDistanceBetween(shapeA, shapeB)
    } catch {
      return null
    }
  },

  /** Raw projected path strings. Used when triaging an export that looks wrong. */
  async debugProjectPaths(id: string, plane: ProjectionPlane = 'XY'): Promise<string[]> {
    await ensureOC()
    const shape = liveShapes.get(id)
    if (!shape) throw new Error('That shape is not built.')
    const paths = drawProjection(shape, plane).visible.toSVGPaths()
    return Array.isArray(paths[0]) ? (paths as string[][]).flat() : (paths as string[])
  },

  /** Triangles of one built shape, used by the STL and 3MF exporters. */
  async meshOf(id: string): Promise<MeshData> {
    await ensureOC()
    const shape = liveShapes.get(id)
    if (!shape) throw new Error('That shape is not built.')
    const raw = shape.mesh({
      tolerance: MESH_TOLERANCE / 2,
      angularTolerance: MESH_ANGULAR_TOLERANCE / 2,
    })
    return {
      vertices: new Float32Array(raw.vertices),
      triangles: new Uint32Array(raw.triangles),
      normals: new Float32Array(raw.normals),
      faceGroups: [],
    }
  },

  /** Smoke test, also handy when triaging a bug report from a strange browser. */
  async selfTest(): Promise<{ triangles: number; volume: number; faces: number }> {
    await ensureOC()
    const solid = drawRectangle(40, 30).sketchOnPlane('XY').extrude(10)
    const r = tessellate(solid, 'selftest', 'body', 'test', '#fff')
    return {
      triangles: r.mesh.triangles.length / 3,
      volume: r.volume,
      faces: r.mesh.faceGroups.length,
    }
  },
}

export type KernelApi = typeof api

Comlink.expose(api)
