import { getMeshData, putMeshData } from '../doc/meshData'
import { parseDesign, serialise } from '../doc/persist'
import { insertFeatures } from '../doc/store'
import { emptyDocument, type Feature, type OkcDocument } from '../doc/types'
import { boxMesh } from '../mesh/primitives'
import {
  insertTransform,
  meshInsertCommand,
  meshPlaneCutCommand,
  meshReduceCommand,
  meshSmoothCommand,
  setPendingMeshes,
} from '../ui/command/specs/mesh'
import { bodyPick } from '../ui/command/picks'
import { createCommandState, evaluateCommand } from '../ui/command/state'
import type { AnyCommandSpec, CommandContext, CommandInitialValues } from '../ui/command/types'
import type { TestResult } from './selftest'

let serial = 0

function contextFor(doc: OkcDocument, editing?: Feature): CommandContext {
  return {
    doc,
    unit: doc.units,
    componentId: doc.rootComponentId,
    id: (role) => `${role}-${++serial}`,
    editing,
    editingFeatureId: editing?.id,
  }
}

function built(spec: unknown, doc: OkcDocument, initial: CommandInitialValues) {
  const command = spec as AnyCommandSpec
  const context = contextFor(doc)
  const state = createCommandState(command, context, initial)
  return { context, result: evaluateCommand(command, state, context, { build: true }) }
}

export function runMeshCommandTest(): TestResult[] {
  const results: TestResult[] = []
  let current = ''
  const check = (pass: boolean, detail: string) =>
    results.push({ name: `Mesh commands: ${current}`, pass, detail })
  const test = (name: string, body: () => void) => {
    current = name
    try {
      body()
    } catch (error) {
      check(false, `threw: ${(error as Error).stack ?? String(error)}`)
    }
  }
  const apply = (m: number[], p: number[]) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
  const close = (a: number[], b: number[]) => a.every((value, i) => Math.abs(value - b[i]) < 1e-9)

  test('an inserted mesh is scaled from its unit, stood up, centred and grounded', () => {
    const bounds = {
      min: [10, 20, 30] as [number, number, number],
      max: [12, 26, 31] as [number, number, number],
    }
    const plain = insertTransform(bounds, { unit: 'mm', yUp: false, centre: false, ground: false })
    check(
      close(apply(plain, [10, 20, 30]), [10, 20, 30]),
      'millimetres with nothing ticked stay put',
    )
    const inches = insertTransform(bounds, { unit: 'in', yUp: false, centre: true, ground: true })
    check(
      close(apply(inches, [10, 20, 30]), [-25.4, -76.2, 0]),
      `inch corner lands at ${apply(inches, [10, 20, 30]).map((v) => v.toFixed(3))}`,
    )
    const standing = insertTransform(
      { min: [0, 0, 0], max: [2, 10, 4] },
      { unit: 'mm', yUp: true, centre: false, ground: true },
    )
    const top = apply(standing, [0, 10, 0])
    check(
      Math.abs(top[2] - 10) < 1e-9,
      `Y becomes up: the far end rises to z = ${top[2].toFixed(3)}`,
    )
  })

  test('Insert Mesh makes one body for each mesh in the file', () => {
    const doc = emptyDocument('Mesh')
    const box = boxMesh([4, 4, 4])
    setPendingMeshes([
      { name: 'Left', dataId: putMeshData(box), min: [0, 0, 0], max: [4, 4, 4], triangles: 12 },
      {
        name: 'Right',
        dataId: putMeshData(boxMesh([2, 2, 2])),
        min: [0, 0, 0],
        max: [2, 2, 2],
        triangles: 12,
      },
    ])
    const { result } = built(meshInsertCommand, doc, {})
    const features = result.features ?? []
    check(
      features.length === 2 &&
        features.every((feature) => feature.kind === 'meshInsert') &&
        new Set(features.map((feature) => (feature as { bodyId: string }).bodyId)).size === 2,
      JSON.stringify(features.map((feature) => feature.name)),
    )
    setPendingMeshes([])
    const empty = built(meshInsertCommand, doc, {}).result
    check(!empty.valid && !!empty.formError, empty.formError ?? 'valid with no file')
  })

  test('the reduce and smooth percentages are stored as fractions', () => {
    const doc = emptyDocument('Mesh')
    doc.components[0].bodies.push({ id: 'm', name: 'Mesh', visible: true, colour: '#cccccc' })
    const reduce = built(meshReduceCommand, doc, {
      body: [bodyPick(doc, 'm')!],
      method: 'proportion',
      proportion: 30,
    }).result.features?.[0]
    check(reduce?.kind === 'meshReduce' && reduce.proportion === 0.3, JSON.stringify(reduce))
    const smooth = built(meshSmoothCommand, doc, {
      body: [bodyPick(doc, 'm')!],
      strength: 40,
      iterations: 6,
    }).result.features?.[0]
    check(
      smooth?.kind === 'meshSmooth' && smooth.strength === 0.4 && smooth.iterations === 6,
      JSON.stringify(smooth),
    )
  })

  test('Plane Cut uses the chosen origin plane and offset', () => {
    const doc = emptyDocument('Mesh')
    doc.components[0].bodies.push({ id: 'm', name: 'Mesh', visible: true, colour: '#cccccc' })
    const cut = built(meshPlaneCutCommand, doc, {
      body: [bodyPick(doc, 'm')!],
      origin: 'YZ',
      offset: 7,
      keep: 'front',
    }).result.features?.[0]
    check(
      cut?.kind === 'meshPlaneCut' &&
        cut.plane.kind === 'named' &&
        cut.plane.name === 'YZ' &&
        cut.plane.offset === 7 &&
        cut.keep === 'front' &&
        cut.fill,
      JSON.stringify(cut),
    )
  })

  test('mesh data travels inside a saved design', () => {
    const doc = emptyDocument('Saved')
    const dataId = putMeshData(boxMesh([3, 3, 3]))
    insertFeatures(doc, [
      {
        id: 'mi',
        kind: 'meshInsert',
        name: 'Insert',
        componentId: 'root',
        bodyId: 'mesh',
        dataId,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        unit: 'mm',
        yUp: false,
        centre: false,
        ground: false,
      },
    ])
    const text = serialise(doc)
    const saved = JSON.parse(text) as OkcDocument
    check(!!saved.meshData?.[dataId], 'the file carries the mesh')
    const opened = parseDesign(text)
    check(!('meshData' in opened), 'the opened document keeps the mesh out of its history')
    check(
      getMeshData(dataId)?.positions === saved.meshData?.[dataId].positions,
      'and the mesh is available again',
    )
  })

  return results
}
