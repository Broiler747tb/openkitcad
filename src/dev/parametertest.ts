import { emptyDocument, type OkcDocument } from '../doc/types'
import { parameterValues, resolveParameters } from '../doc/parameters'
import { useStore } from '../doc/store'
import { kernel } from '../kernel/api'
import { serialise, deserialise } from '../doc/persist'
import type { EvaluateResult } from '../kernel/types'

export async function runParameterTest() {
  const results: Array<{ name: string; pass: boolean; detail: string }> = []
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({
      name: 'Parameters: ' + name,
      pass,
      detail: detail ?? (pass ? 'passed' : 'unexpected result'),
    })
  const throws = (fn: () => unknown) => {
    try {
      fn()
      return false
    } catch {
      return true
    }
  }
  const p = (name: string, expression: string) => ({ id: name, name, value: 0, expression })
  check(
    'dependency ordering',
    parameterValues([p('depth', 'width/2'), p('width', '80')]).get('depth') === 40,
  )
  check('metric expressions', parameterValues([p('size', '2in+1cm')]).get('size') === 60.8)
  check(
    'reject cycles',
    throws(() => parameterValues([p('a', 'b'), p('b', 'a')])),
  )
  check(
    'reject unknown references',
    throws(() => parameterValues([p('a', 'missing')])),
  )
  check(
    'reject duplicate names',
    throws(() => parameterValues([p('a', '1'), p('a', '2')])),
  )
  check(
    'reject reserved names',
    throws(() => parameterValues([p('pi', '1')])),
  )

  const doc = emptyDocument('Parametric plate')
  doc.parameters = [p('width', '80'), p('depth', 'width/2'), p('wall', '3')]
  doc.components[0].bodies = [{ id: 'plate', name: 'Plate', visible: true, colour: '#6688aa' }]
  doc.timeline = [
    {
      id: 'box',
      name: 'Base',
      componentId: 'root',
      kind: 'box',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [0, 0],
      width: 1,
      depth: 1,
      height: 1,
      result: { kind: 'newBody', bodyId: 'plate' },
    },
  ]
  doc.bindings = ['width', 'depth', 'height'].map((field, i) => ({
    featureId: 'box',
    field,
    expression: ['width', 'depth', 'wall'][i],
  }))
  resolveParameters(doc)
  const box = doc.timeline[0]
  check(
    'all feature links resolve',
    box.kind === 'box' && box.width === 80 && box.depth === 40 && box.height === 3,
  )
  check(
    'reject a link to a missing feature',
    throws(() =>
      resolveParameters({
        ...structuredClone(doc),
        bindings: [{ featureId: 'gone', field: 'width', expression: '10' }],
      }),
    ),
  )
  const pruned: OkcDocument = {
    ...structuredClone(doc),
    bindings: [...doc.bindings, { featureId: 'gone', field: 'width', expression: '10' }],
  }
  resolveParameters(pruned, true)
  check('dropping missing links keeps the rest', pruned.bindings.length === 3)
  check(
    'reject unsupported fields',
    throws(() =>
      resolveParameters({
        ...structuredClone(doc),
        bindings: [{ featureId: 'box', field: 'origin', expression: '10' }],
      }),
    ),
  )
  check(
    'reject duplicate links',
    throws(() =>
      resolveParameters({
        ...structuredClone(doc),
        bindings: [
          { featureId: 'box', field: 'width', expression: '10' },
          { featureId: 'box', field: 'width', expression: '20' },
        ],
      }),
    ),
  )

  try {
    const loaded = deserialise(serialise(doc))
    resolveParameters(loaded)
    check(
      'file roundtrip keeps expressions',
      loaded.parameters[1].expression === 'width/2' && loaded.bindings?.length === 3,
    )
  } catch (e) {
    check('file roundtrip keeps expressions', false, String(e))
  }

  const bad = structuredClone(doc)
  bad.bindings[0].expression = '-5'
  check(
    'reject negative dimensions atomically',
    throws(() => resolveParameters(bad)) &&
      JSON.stringify(bad.timeline) === JSON.stringify(doc.timeline),
  )

  const saved = useStore.getState()
  try {
    useStore.setState({
      doc: structuredClone(doc),
      past: [],
      future: [],
      rebuild: () => {},
      activeSketch: null,
    })
    useStore.getState().commit((d) => {
      d.parameters[0].expression = '100'
    })
    const current = useStore.getState().doc.timeline[0]
    check(
      'commit propagates dependencies',
      current.kind === 'box' && current.width === 100 && current.depth === 50,
    )
    useStore.getState().undo()
    check(
      'Undo restores parameter expression',
      useStore.getState().doc.parameters[0].expression === '80',
    )
    useStore.getState().redo()
    check('Redo restores linked dimensions', useStore.getState().doc.parameters[1].value === 50)
    const editor = useStore.getState() as unknown as {
      updateFeature: (featureId: string, patch: Record<string, unknown>) => void
    }
    editor.updateFeature('box', { height: 5 })
    check('manual override detaches just one link', useStore.getState().doc.bindings.length === 2)
    useStore.getState().undo()
    check('Undo restores detached link', useStore.getState().doc.bindings.length === 3)
    const before = JSON.stringify(useStore.getState().doc)
    check(
      'invalid commit rejected',
      throws(() =>
        useStore.getState().commit((d) => {
          d.parameters[0].expression = 'depth*2'
        }),
      ),
    )
    check('invalid commit leaves design intact', JSON.stringify(useStore.getState().doc) === before)
    useStore.getState().commit((d) => {
      d.timeline = []
      d.components[0].bodies = []
    })
    check('delete body removes its links', useStore.getState().doc.bindings.length === 0)
  } catch (e) {
    check('store scenario ran', false, String(e))
  } finally {
    useStore.setState(saved, true)
  }

  const volumeOf = (result: EvaluateResult) => {
    const instance = result.instances.find((candidate) => candidate.id === 'root|plate')
    return result.meshes.find((mesh) => mesh.key === instance?.meshKey)?.volume ?? 0
  }
  const first = await kernel().evaluate(doc, [])
  check(
    'kernel builds parameterized volume',
    first.errors.length === 0 && Math.abs(volumeOf(first) - 9600) < 0.01,
    `${volumeOf(first).toFixed(2)} mm3, expected 9600`,
  )
  doc.parameters[0].expression = '100'
  const second = await kernel().evaluate(doc, [])
  check(
    'kernel independently recomputes formulas',
    second.errors.length === 0 && Math.abs(volumeOf(second) - 15000) < 0.01,
    `${volumeOf(second).toFixed(2)} mm3, expected 15000`,
  )
  return results
}
