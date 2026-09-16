import { useStore } from '../doc/store'
import { emptyDocument } from '../doc/types'
import { allBodies, findBody } from '../doc/model'
import { objectActions } from '../ui/ObjectMenu'
import { createSketchAction, resolveCommand, toggleVisibility } from '../ui/fusionCommands'
import { startCommand } from '../ui/command/commands'
import { useCommand } from '../ui/command/session'
import { evaluateCommand } from '../ui/command/state'

function evaluateSession() {
  const session = useCommand.getState().session
  return session
    ? evaluateCommand(session.spec, session.state, session.context, { build: true })
    : null
}

function typeInto(values: Record<string, string>) {
  for (const [id, text] of Object.entries(values)) {
    useCommand.getState().dispatch({ type: 'text', id, text })
  }
}

function commitSession(): boolean {
  const evaluation = evaluateSession()
  if (!evaluation?.valid || !evaluation.features) return false
  useCommand.getState().commit(evaluation.features)
  return true
}

export function runWorkflowTest() {
  const saved = useStore.getState()
  const results: Array<{ name: string; pass: boolean; detail: string }> = []
  const check = (name: string, pass: boolean) =>
    results.push({
      name: 'Fusion workflow: ' + name,
      pass,
      detail: pass ? 'passed' : 'unexpected state',
    })
  try {
    const doc = emptyDocument()
    useStore.setState({
      rebuild: () => {},
      doc,
      past: [],
      future: [],
      selection: { kind: 'none' },
      activeSketch: null,
      activeComponentId: doc.rootComponentId,
      subSelection: [],
      sketchSelection: [],
      meshes: new Map(),
      instances: [],
    })
    startCommand('fillet')
    check(
      'Fillet opens and waits for edges without touching history',
      useCommand.getState().session?.state.active === 'edges' &&
        evaluateSession()?.missing.includes('edges') === true &&
        useStore.getState().past.length === 0,
    )
    useCommand.getState().cancel()

    objectActions({ kind: 'none' })
      .find((a) => a.id === 'add-box')!
      .run(0)
    check('Add a box opens the Box command', useCommand.getState().session?.spec.id === 'box')
    typeInto({ length: '40', width: '30', height: '20' })
    const committed = commitSession()
    const s = useStore.getState()
    const body = allBodies(s.doc)[0]?.body
    check(
      'primitive is one undo step',
      committed && s.past.length === 1 && s.doc.timeline.length === 1 && !!body,
    )
    check('the command closes once it is committed', useCommand.getState().session === null)
    if (!body) return results

    useStore.getState().select({ kind: 'body', id: body.id })
    startCommand('move')
    const moving = useCommand.getState().session
    const picked = moving?.state.fields.bodies
    check(
      'opening Move picks the selected body and does not touch history',
      useStore.getState().past.length === 1 &&
        picked?.kind === 'selection' &&
        picked.picks[0]?.id === body.id,
    )
    check(
      'a zero move cannot be committed',
      !commitSession() && useStore.getState().past.length === 1,
    )
    typeInto({ dx: '5', dy: '10', dz: '15' })
    commitSession()
    const feature = useStore.getState().doc.timeline[1]
    check(
      'Move stores all three distances',
      feature?.kind === 'move' && feature.offset.join(',') === '5,10,15',
    )
    useStore.getState().undo()
    check(
      'Undo removes Move and clears selection',
      useStore.getState().doc.timeline.length === 1 &&
        useStore.getState().selection.kind === 'none',
    )
    useStore.getState().select({ kind: 'body', id: body.id })
    toggleVisibility()
    check(
      'V changes selected body visibility',
      findBody(useStore.getState().doc, body.id)?.body.visible === false,
    )
    createSketchAction().run(0, undefined, undefined, 'XZ')
    const active = useStore.getState().activeSketch
    check('new sketch starts in Select', !!active && useStore.getState().tool === 'select')
    const trim = resolveCommand('trim')
    check('Trim starts without preselection', !!trim)
    trim?.run(0)
    check('Trim enters click-to-trim mode', useStore.getState().tool === 'trim')
    useStore.getState().closeSketch()
    check(
      'Finish Sketch preserves profile selection',
      useStore.getState().activeSketch === null &&
        useStore.getState().selection.id === active?.featureId,
    )
    startCommand('extrude')
    check(
      'empty sketch cannot be extruded',
      evaluateSession()?.fieldErrors.profile !== undefined && !commitSession(),
    )
  } finally {
    useCommand.getState().cancel()
    useStore.setState(saved, true)
  }
  return results
}
