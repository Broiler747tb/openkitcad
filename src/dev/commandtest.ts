import { replaceFeatureInDocument } from '../doc/store'
import { emptyDocument, type ExtrudeFeature, type Feature, type OkcDocument } from '../doc/types'
import { emptySketch } from '../sketch/types'
import { extrudeCommand } from '../ui/command/commands'
import { createCommandState, evaluateCommand, reduceCommand } from '../ui/command/state'
import type { AnyCommandSpec, CommandContext } from '../ui/command/types'
import { formatLength, parseAngle, parseLength } from '../ui/command/units'
import type { TestResult } from './selftest'

function squareSketchDoc(): OkcDocument {
  const doc = emptyDocument('Commands')
  const sketch = emptySketch()
  const corners: Array<[string, number, number]> = [
    ['a', 0, 0],
    ['b', 20, 0],
    ['c', 20, 10],
    ['d', 0, 10],
  ]
  for (const [id, x, y] of corners) sketch.points.push({ id, x, y })
  sketch.entities.push(
    { id: 'l1', kind: 'line', p1: 'a', p2: 'b', construction: false },
    { id: 'l2', kind: 'line', p1: 'b', p2: 'c', construction: false },
    { id: 'l3', kind: 'line', p1: 'c', p2: 'd', construction: false },
    { id: 'l4', kind: 'line', p1: 'd', p2: 'a', construction: false },
  )
  doc.timeline.push({
    id: 's1',
    kind: 'sketch',
    name: 'Sketch1',
    componentId: 'root',
    plane: { kind: 'named', name: 'XY', offset: 0 },
    sketch,
    visible: true,
  })
  doc.components[0].bodies.push({ id: 'b1', name: 'Plate', visible: true, colour: '#cccccc' })
  return doc
}

function contextFor(doc: OkcDocument, editing?: Feature): CommandContext {
  const ids: Record<string, string> = { body: 'b-new' }
  return {
    doc,
    unit: doc.units,
    componentId: 'root',
    id: (role) => (ids[role] ??= `${role}-1`),
    editing,
    editingFeatureId: editing?.id,
  }
}

export function runCommandTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Commands: ${name}`, pass, detail })

  check('inches typed into a millimetre field', parseLength('1 in', 'mm') === 25.4, '1 in')
  check('plain numbers use the document unit', parseLength('10', 'in') === 254, '10 in document')
  check(
    'parameters and arithmetic work in length fields',
    parseLength('width/2 + 1', 'mm', (name) => (name === 'width' ? 30 : NaN)) === 16,
    'width/2 + 1 with width = 30',
  )
  check('angles accept radians', Math.abs(parseAngle('pi rad') - 180) < 1e-9, 'pi rad')
  check('lengths are shown in the document unit', formatLength(25.4, 'in') === '1 in', '25.4 mm')

  const doc = squareSketchDoc()
  const spec = extrudeCommand as unknown as AnyCommandSpec
  const context = contextFor(doc)
  let state = createCommandState(spec, context, {
    profile: [{ kind: 'sketch', id: 's1', label: 'Sketch1' }],
  })
  check('a command opens on its first selection', state.active === 'profile', String(state.active))
  state = reduceCommand(spec, state, { type: 'choice', id: 'operation', value: 'cut' }, context)
  check(
    'choosing Cut moves selection to the bodies it cuts',
    state.active === 'bodies',
    String(state.active),
  )
  check(
    'a cut with nothing to cut is not valid yet',
    !evaluateCommand(spec, state, context).valid,
    evaluateCommand(spec, state, context).missing.join(','),
  )
  state = reduceCommand(
    spec,
    state,
    { type: 'pick', pick: { kind: 'body', id: 'b1', bodyId: 'b1', label: 'Plate' } },
    context,
  )
  state = reduceCommand(spec, state, { type: 'text', id: 'distance', text: '0.5 in' }, context)
  const built = evaluateCommand(spec, state, context, { build: true })
  const extrude = built.features?.[0] as ExtrudeFeature | undefined
  check(
    'extrude builds a cut from the typed values',
    built.valid &&
      extrude?.kind === 'extrude' &&
      extrude.sketchId === 's1' &&
      extrude.distance === 12.7 &&
      extrude.result.kind === 'cut' &&
      extrude.result.bodyIds.join() === 'b1',
    JSON.stringify(extrude ?? built.fieldErrors),
  )
  const flat = { ...doc, timeline: [{ ...doc.timeline[0], sketch: emptySketch() } as Feature] }
  const open = createCommandState(spec, contextFor(flat), {
    profile: [{ kind: 'sketch', id: 's1', label: 'Sketch1' }],
  })
  check(
    'an empty sketch cannot be extruded',
    evaluateCommand(spec, open, contextFor(flat)).fieldErrors.profile !== undefined,
    JSON.stringify(evaluateCommand(spec, open, contextFor(flat)).fieldErrors),
  )

  const existing: ExtrudeFeature = {
    id: 'e1',
    kind: 'extrude',
    name: 'Extrude7',
    componentId: 'root',
    sketchId: 's1',
    distance: 4,
    symmetric: true,
    reverse: false,
    result: { kind: 'newBody', bodyId: 'b1' },
  }
  const editContext = { ...contextFor(doc, existing), id: (role: string) => `${role}-edit` }
  const editState = createCommandState(spec, editContext, {
    profile: [{ kind: 'sketch', id: 's1', label: 'Sketch1' }],
    direction: 'symmetric',
    distance: 4,
    flip: true,
    operation: 'newBody',
  })
  const edited = evaluateCommand(
    spec,
    editState,
    { ...editContext, id: () => 'b1' },
    { build: true },
  )
  const replacement = edited.features?.[0] as ExtrudeFeature | undefined
  check(
    'editing keeps the step id, its name and its body',
    replacement?.id === 'e1' &&
      replacement.name === 'Extrude7' &&
      replacement.result.kind === 'newBody' &&
      replacement.result.bodyId === 'b1' &&
      !replacement.reverse,
    JSON.stringify(replacement),
  )

  const history = squareSketchDoc()
  history.timeline.push(existing, {
    id: 'f1',
    kind: 'fillet',
    name: 'Fillet1',
    componentId: 'root',
    bodyId: 'b1',
    radius: 1,
    edges: [],
  })
  history.marker = 2
  history.bindings = [
    { featureId: 'e1', field: 'distance', expression: 'depth' },
    { featureId: 'e1', field: 'width', expression: 'depth' },
  ]
  replaceFeatureInDocument(history, 'e1', [
    { ...existing, result: { kind: 'newBody', bodyId: 'b2' } },
  ])
  check(
    'replacing a step swaps it in place and keeps the marker',
    history.timeline.map((feature) => feature.id).join() === 's1,e1,f1' && history.marker === 2,
    `${history.timeline.map((feature) => feature.id).join()} marker ${history.marker}`,
  )
  check(
    'a replaced step brings its new body and drops the old one',
    history.components[0].bodies.map((body) => body.id).join() === 'b2',
    history.components[0].bodies.map((body) => body.id).join(),
  )
  check(
    'a replaced step keeps links only for fields it still has',
    history.bindings.map((link) => link.field).join() === 'distance',
    history.bindings.map((link) => link.field).join(),
  )

  return results
}
