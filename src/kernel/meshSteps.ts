import { getOC } from 'replicad'
import type { Frame } from '../core/math'
import type { Feature, MeshRefinement, PlaneRef } from '../doc/types'
import { analyzeMesh } from '../mesh/analysis'
import { planeCut } from '../mesh/cut'
import { reverseNormals, separateComponents } from '../mesh/operations'
import { reduceMesh } from '../mesh/reduce'
import { remeshMesh } from '../mesh/remesh'
import { repairMesh } from '../mesh/repair'
import { smoothMesh } from '../mesh/smooth'
import {
  boundsDiagonal,
  createMesh,
  meshBounds,
  mergeMeshes,
  transformMesh,
  triangleCount,
  type TriMesh,
} from '../mesh/types'
import { weldVertices } from '../mesh/weld'

export interface MeshBodyState {
  mesh: TriMesh
  key: string
  featureId: string
}

export interface MeshStage {
  meshBodies: Map<string, MeshBodyState>
  report: (severity: 'error' | 'warning', message: string, hint?: string, bodyId?: string) => void
  bodyName: (id: string) => string
  planeFrame: (ref: PlaneRef) => Frame
  meshData: (id: string) => TriMesh | undefined
}

export const TRIANGLE_LIMIT = 2_000_000
export const CONVERT_LIMIT = 30_000

const REFINEMENT: Record<MeshRefinement, { tolerance: number; angle: number }> = {
  coarse: { tolerance: 0.2, angle: 30 },
  medium: { tolerance: 0.05, angle: 15 },
  high: { tolerance: 0.01, angle: 6 },
}

export function tessellateShape(shape: any, refinement: MeshRefinement): TriMesh {
  const { tolerance, angle } = REFINEMENT[refinement]
  const raw = shape.mesh({ tolerance, angularTolerance: angle })
  const soup = createMesh(raw.vertices, raw.triangles)
  return weldVertices(soup, Math.max(1e-7, tolerance * 1e-4)).mesh
}

export function meshToShape(mesh: TriMesh, method: 'faceted' | 'prismatic'): any {
  const oc = getOC() as any
  const owned: Array<{ delete(): void }> = []
  const own = <T extends { delete(): void }>(value: T): T => {
    owned.push(value)
    return value
  }
  try {
    const diagonal = boundsDiagonal(meshBounds(mesh))
    const sewing = own(
      new oc.BRepBuilderAPI_Sewing(Math.max(1e-6, diagonal * 1e-6), true, true, true, false),
    )
    const p = mesh.positions
    const t = mesh.triangles
    const point = (v: number) => own(new oc.gp_Pnt_3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]))
    let faces = 0
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [point(t[i]), point(t[i + 1]), point(t[i + 2])]
      if (a.Distance(b) < 1e-9 || b.Distance(c) < 1e-9 || c.Distance(a) < 1e-9) continue
      const ab = own(new oc.BRepBuilderAPI_MakeEdge_3(a, b))
      const bc = own(new oc.BRepBuilderAPI_MakeEdge_3(b, c))
      const ca = own(new oc.BRepBuilderAPI_MakeEdge_3(c, a))
      if (!ab.IsDone() || !bc.IsDone() || !ca.IsDone()) continue
      const wire = own(new oc.BRepBuilderAPI_MakeWire_4(ab.Edge(), bc.Edge(), ca.Edge()))
      if (!wire.IsDone()) continue
      const face = own(new oc.BRepBuilderAPI_MakeFace_15(wire.Wire(), true))
      if (!face.IsDone()) continue
      sewing.Add(face.Face())
      faces++
    }
    if (!faces) throw new Error('The mesh has no usable triangles to convert.')
    sewing.Perform(own(new oc.Message_ProgressRange_1()))
    let result = sewing.SewedShape()
    const replace = (next: any) => {
      result.delete()
      result = next
    }
    const explorer = own(
      new oc.TopExp_Explorer_2(
        result,
        oc.TopAbs_ShapeEnum.TopAbs_SHELL,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    )
    const shells: any[] = []
    for (; explorer.More(); explorer.Next()) {
      shells.push(oc.TopoDS.Shell_1(explorer.Current()))
    }
    if (shells.length === 1 && oc.BRep_Tool.IsClosed_1(shells[0])) {
      const fix = own(new oc.ShapeFix_Solid_1())
      replace(fix.SolidFromShell(shells[0]))
    }
    if (method === 'prismatic') {
      const unify = own(new oc.ShapeUpgrade_UnifySameDomain_2(result, true, true, false))
      unify.SetLinearTolerance(Math.max(1e-5, diagonal * 1e-5))
      unify.SetAngularTolerance(1e-3)
      unify.Build()
      replace(unify.Shape())
    }
    return result
  } finally {
    for (const value of owned.reverse()) value.delete()
  }
}

export function runMeshStep(feature: Feature, key: string, stage: MeshStage): boolean {
  const set = (id: string, mesh: TriMesh) =>
    stage.meshBodies.set(id, { mesh, key, featureId: feature.id })
  const need = (id: string) => {
    const state = stage.meshBodies.get(id)
    if (!state) {
      stage.report(
        'error',
        `${stage.bodyName(id)} is not a mesh body at this point in the timeline.`,
        'Pick a mesh body, or make one from a solid with Tessellate.',
        id,
      )
    }
    return state ?? null
  }
  const limit = (mesh: TriMesh, id: string) => {
    if (triangleCount(mesh) <= TRIANGLE_LIMIT) return true
    stage.report(
      'error',
      `That would make ${(triangleCount(mesh) / 1e6).toFixed(1)} million triangles, more than OpenKitCAD keeps in one body.`,
      'Use a longer edge length or a smaller proportion.',
      id,
    )
    return false
  }

  switch (feature.kind) {
    case 'meshInsert': {
      const data = stage.meshData(feature.dataId)
      if (!data) {
        stage.report(
          'error',
          'The file this mesh was read from is not in the design any more.',
          'Insert the mesh file again and delete this step.',
          feature.bodyId,
        )
        return true
      }
      set(feature.bodyId, transformMesh(data, feature.transform))
      return true
    }

    case 'meshRepair': {
      const state = need(feature.bodyId)
      if (!state) return true
      const { mesh, report } = repairMesh(state.mesh, { fillHoles: feature.closeHoles })
      if (!triangleCount(mesh)) {
        stage.report(
          'error',
          'Nothing was left after removing the broken triangles.',
          undefined,
          feature.bodyId,
        )
        return true
      }
      if (feature.closeHoles && report.unfilledHoles) {
        stage.report(
          'warning',
          `${report.unfilledHoles} hole${report.unfilledHoles === 1 ? ' was' : 's were'} too large to close.`,
          'Plane Cut with Fill closes a large opening cleanly.',
          feature.bodyId,
        )
      }
      set(feature.bodyId, mesh)
      return true
    }

    case 'meshReduce': {
      const state = need(feature.bodyId)
      if (!state) return true
      const result =
        feature.method === 'proportion'
          ? reduceMesh(state.mesh, { proportion: feature.proportion })
          : feature.method === 'count'
            ? reduceMesh(state.mesh, { targetTriangles: feature.count })
            : reduceMesh(state.mesh, { targetTriangles: 4, maxError: feature.tolerance })
      set(feature.bodyId, result.mesh)
      return true
    }

    case 'meshRemesh': {
      const state = need(feature.bodyId)
      if (!state) return true
      const area = analyzeMesh(state.mesh).area
      const length = feature.edgeLength > 0 ? feature.edgeLength : undefined
      if (length && area / (0.433 * length * length) > TRIANGLE_LIMIT) {
        stage.report(
          'error',
          'That edge length would make far too many triangles for this body.',
          'Use a longer edge length.',
          feature.bodyId,
        )
        return true
      }
      const mesh = remeshMesh(state.mesh, {
        edgeLength: length,
        sharpAngle: feature.preserveSharp ? 30 : 180,
      })
      if (limit(mesh, feature.bodyId)) set(feature.bodyId, mesh)
      return true
    }

    case 'meshSmooth': {
      const state = need(feature.bodyId)
      if (!state) return true
      set(
        feature.bodyId,
        smoothMesh(state.mesh, { strength: feature.strength, iterations: feature.iterations }),
      )
      return true
    }

    case 'meshReverse': {
      const states = feature.bodyIds.map((id) => [id, need(id)] as const)
      for (const [id, state] of states) if (state) set(id, reverseNormals(state.mesh))
      return true
    }

    case 'meshPlaneCut': {
      const state = need(feature.bodyId)
      if (!state) return true
      const frame = stage.planeFrame(feature.plane)
      const normal = feature.flip
        ? ([-frame.normal[0], -frame.normal[1], -frame.normal[2]] as const)
        : frame.normal
      const { above, below } = planeCut(
        state.mesh,
        { origin: [...frame.origin], normal: [normal[0], normal[1], normal[2]] },
        { cap: feature.fill },
      )
      const front = triangleCount(above) > 0
      const back = triangleCount(below) > 0
      if (!front || !back) {
        stage.report(
          'error',
          `The plane does not cross ${stage.bodyName(feature.bodyId)}.`,
          'Move the plane so it passes through the mesh.',
          feature.bodyId,
        )
        return true
      }
      if (feature.keep === 'back') set(feature.bodyId, below)
      else set(feature.bodyId, above)
      if (feature.keep === 'both') set(feature.newBodyId, below)
      return true
    }

    case 'meshSeparate': {
      const state = need(feature.bodyId)
      if (!state) return true
      const pieces = separateComponents(state.mesh)
      if (pieces.length < 2) {
        stage.report(
          'warning',
          `${stage.bodyName(feature.bodyId)} is already one piece.`,
          undefined,
          feature.bodyId,
        )
      }
      const slots = [feature.bodyId, ...feature.newBodyIds]
      const extra = pieces.slice(slots.length - 1)
      pieces.slice(0, slots.length).forEach((piece, index) => {
        set(
          slots[index],
          index === slots.length - 1 && extra.length > 1 ? mergeMeshes(extra) : piece,
        )
      })
      if (pieces.length > slots.length) {
        stage.report(
          'warning',
          `The mesh now has ${pieces.length} pieces; the last ${pieces.length - slots.length + 1} stay together.`,
          'Edit this step to give every piece its own body.',
          feature.bodyId,
        )
      }
      return true
    }

    case 'meshCombine': {
      const target = need(feature.bodyId)
      if (!target) return true
      const tools = feature.toolBodyIds
        .filter((id) => id !== feature.bodyId)
        .map((id) => [id, need(id)] as const)
      if (tools.some(([, state]) => !state)) return true
      set(feature.bodyId, mergeMeshes([target.mesh, ...tools.map(([, state]) => state!.mesh)]))
      for (const [id] of tools) stage.meshBodies.delete(id)
      return true
    }
  }
  return false
}
