import { buildElementMap, type Seed } from './rules'
import {
  disposeTopology,
  exploreTopology,
  occGeometry,
  occHistory,
  occShapeOps,
  Scratch,
  type OC,
  type OcShape,
} from './occ'
import type { NamedShape } from './operations'

export function nameShape(
  oc: OC,
  featureId: string,
  shape: OcShape,
  seeds?: readonly Seed<OcShape>[],
): NamedShape {
  const result = exploreTopology(oc, shape)
  try {
    const map = buildElementMap({
      featureId,
      ops: occShapeOps,
      result,
      geometry: occGeometry(oc),
      seeds,
    })
    return { shape, map }
  } catch (error) {
    disposeTopology(result)
    throw error
  }
}

export function transformNamed(
  oc: OC,
  featureId: string,
  named: NamedShape,
  matrix: readonly number[],
): NamedShape {
  const scratch = new Scratch()
  try {
    const trsf = scratch.track(new oc.gp_Trsf_1())
    trsf.SetValues(
      matrix[0],
      matrix[4],
      matrix[8],
      matrix[12],
      matrix[1],
      matrix[5],
      matrix[9],
      matrix[13],
      matrix[2],
      matrix[6],
      matrix[10],
      matrix[14],
    )
    const builder = scratch.track(new oc.BRepBuilderAPI_Transform_2(named.shape, trsf, true))
    const shape = builder.Shape()
    const result = exploreTopology(oc, shape)
    try {
      const map = buildElementMap({
        featureId,
        ops: occShapeOps,
        result,
        geometry: occGeometry(oc),
        inputs: [named.map],
        history: occHistory(oc, { modified: (source) => builder.Modified(source) }, scratch),
      })
      return { shape, map }
    } catch (error) {
      disposeTopology(result)
      shape.delete()
      throw error
    }
  } finally {
    scratch.release()
  }
}
