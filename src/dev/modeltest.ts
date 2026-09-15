import {
  canMoveFeature,
  expandInstances,
  featureDependencies,
  identityMatrix,
  instanceId,
  invertRigidMatrix,
  multiplyMatrices,
  parseInstanceId,
  pathMatrix,
  placementMatrix,
  rotationMatrix,
  transformPoint,
  translationMatrix,
  wouldCreateCycle,
} from '../doc/model'
import { emptyDocument, type Feature, type Matrix4, type Occurrence } from '../doc/types'
import { emptySketch } from '../sketch/types'
import type { TestResult } from './selftest'

export function runModelTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Model: ${name}`, pass, detail })
  const near = (a: number[], b: number[]) =>
    a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) < 1e-9)
  const show = (values: number[]) => `[${values.map((n) => Number(n.toFixed(6))).join(', ')}]`

  const placed = transformPoint(placementMatrix([10, 20, 5], 90, true), [1, 2, 3])
  check('placement matrix flips, turns, then moves', near(placed, [12, 21, 2]), show(placed))

  const rigid = multiplyMatrices(translationMatrix([3, -4, 7]), rotationMatrix('y', 37))
  const undone = multiplyMatrices(invertRigidMatrix(rigid), rigid)
  check('rigid inverse undoes the transform', near(undone, identityMatrix()), show(undone))

  const ordered = transformPoint(
    multiplyMatrices(translationMatrix([1, 0, 0]), rotationMatrix('z', 90)),
    [1, 0, 0],
  )
  check('matrices apply right to left', near(ordered, [1, 1, 0]), show(ordered))

  const doc = emptyDocument('Model test')
  doc.components.push(
    { id: 'a', name: 'A', source: { kind: 'design' }, bodies: [] },
    { id: 'b', name: 'B', source: { kind: 'design' }, bodies: [] },
  )
  doc.occurrences.push(
    occurrence('a1', 'root', 'a', translationMatrix([0, 0, 0])),
    occurrence('a2', 'root', 'a', translationMatrix([100, 0, 0])),
    occurrence('b1', 'a', 'b', translationMatrix([0, 10, 0])),
  )
  const instances = expandInstances(doc)
  const keys = instances.map((instance) => instance.path.join('/') || 'root').join(' ')
  check('instances expand through linked copies', keys === 'root a1 a1/b1 a2 a2/b1', keys)
  const nested = instances.find((instance) => instance.path.join('/') === 'a2/b1')
  const nestedOrigin = nested ? transformPoint(nested.matrix, [0, 0, 0]) : []
  check(
    'nested matrices compose parent first',
    near(nestedOrigin, [100, 10, 0]),
    show(nestedOrigin),
  )
  const walked = pathMatrix(doc, ['a2', 'b1'])
  const walkedOrigin = walked ? transformPoint(walked, [0, 0, 0]) : []
  check('path matrix agrees with expansion', near(walkedOrigin, [100, 10, 0]), show(walkedOrigin))
  check('a broken path has no matrix', pathMatrix(doc, ['b1']) === null, 'b1 is not under root')

  check('a component cannot contain itself', wouldCreateCycle(doc, 'a', 'a'), 'a inside a')
  check('a component cannot contain its parent', wouldCreateCycle(doc, 'b', 'a'), 'a inside b')
  check('unrelated nesting is allowed', !wouldCreateCycle(doc, 'root', 'b'), 'b inside root')

  const nestedId = instanceId(['a2', 'b1'], 'body-1')
  const parsed = parseInstanceId(nestedId)
  check(
    'instance ids round trip',
    nestedId === 'a2/b1|body-1' && parsed.path.join('/') === 'a2/b1' && parsed.bodyId === 'body-1',
    nestedId,
  )
  const rootId = instanceId([], 'body-2')
  check(
    'root instance ids round trip',
    rootId === 'root|body-2' && parseInstanceId(rootId).path.length === 0,
    rootId,
  )

  const timeline: Feature[] = [
    sketch('s1'),
    extrude('e1', 's1', 'b1'),
    fillet('f1', 'b1'),
    sketch('s2'),
  ]
  const timelineDoc = { ...emptyDocument('Timeline test'), timeline }
  const extrudeDeps = featureDependencies(timelineDoc, timeline[1])
  check('an extrude depends on its sketch', extrudeDeps.includes('s1'), extrudeDeps.join(','))
  const filletDeps = featureDependencies(timelineDoc, timeline[2])
  check('a fillet depends on its body creator', filletDeps.includes('e1'), filletDeps.join(','))
  check('a fillet cannot move before its body', !canMoveFeature(timelineDoc, 'f1', 0), 'f1 to 0')
  check('a sketch cannot move after its user', !canMoveFeature(timelineDoc, 's1', 2), 's1 to 2')
  check('an independent sketch can move first', canMoveFeature(timelineDoc, 's2', 0), 's2 to 0')

  return results
}

function occurrence(
  id: string,
  parentComponentId: string,
  componentId: string,
  transform: Matrix4,
): Occurrence {
  return { id, parentComponentId, componentId, name: id, transform, visible: true, grounded: false }
}

function sketch(id: string): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'sketch',
    plane: { kind: 'named', name: 'XY', offset: 0 },
    sketch: emptySketch(),
    visible: true,
  }
}

function extrude(id: string, sketchId: string, bodyId: string): Feature {
  return {
    id,
    name: id,
    componentId: 'root',
    kind: 'extrude',
    sketchId,
    distance: 5,
    symmetric: false,
    reverse: false,
    result: { kind: 'newBody', bodyId },
  }
}

function fillet(id: string, bodyId: string): Feature {
  return { id, name: id, componentId: 'root', kind: 'fillet', bodyId, radius: 1, edges: [] }
}
