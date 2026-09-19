import { activeSketchFeature, selectedBodyId, useStore } from '../doc/store'
import { sketchActions } from '../sketch/actions'
import { selectedObjectActions } from './workflow'
import type { ObjectAction } from './ObjectMenu'
import { findBody, findOccurrence } from '../doc/model'

export const SHORTCUTS = [
  ['S', 'Command toolbox'],
  ['E', 'Extrude'],
  ['Q', 'Press Pull'],
  ['F', 'Fillet'],
  ['H', 'Hole'],
  ['M', 'Move'],
  ['J / Shift+J', 'Joint / As-built Joint'],
  ['I', 'Measure'],
  ['V', 'Visibility'],
  ['A', 'Body appearance'],
  ['L / R / C', 'Line / Rectangle / Circle (sketch)'],
  ['D', 'Sketch dimension'],
  ['O / X', 'Offset / Construction (selected sketch geometry)'],
  ['T', 'Trim (sketch)'],
  ['Ctrl+A', 'Select all sketch edges'],
  ['Ctrl+Shift+I', 'Invert sketch selection'],
  ['Ctrl+B', 'Compute all'],
  ['Ctrl+N / O / S', 'New / Open / Save'],
  ['Ctrl+Z / Y', 'Undo / Redo'],
  ['Ctrl+C / X / V', 'Copy / Cut / Paste'],
  ['Ctrl+Alt+B', 'Show / hide Browser'],
  ['Esc', 'Select tool: stop the current tool or command'],
  ['Home', 'Fit view (OpenKitCAD extension)'],
] as const

export function createSketchAction(): ObjectAction {
  const face = selectedObjectActions().find((a) => a.id === 'sketch-on-face')
  if (face) return { ...face, label: 'Create Sketch on selected face' }
  return {
    id: 'create-sketch',
    label: 'Create Sketch',
    hint: 'Click an origin plane or a flat face to sketch on.',
    run: (_a, _b, _c, plane) => {
      const store = useStore.getState()
      if (plane) {
        store.startSketch({ kind: 'named', name: plane as 'XY' | 'XZ' | 'YZ', offset: 0 })
        return
      }
      if (store.activeSketch) store.closeSketch()
      store.setPickingSketchPlane(true)
      store.setStatus('Create Sketch: click an origin plane or a flat face. Esc cancels.')
    },
  }
}

export function createComponentAction(): ObjectAction {
  return {
    id: 'create-component',
    label: 'New Component',
    hint: 'An empty component inside the active one. It becomes the active component.',
    run: () => useStore.getState().createComponent(),
  }
}

export function resolveCommand(id: string): ObjectAction | null {
  const state = useStore.getState()
  const actions = selectedObjectActions()
  if (id === 'create-sketch') return createSketchAction()
  if (id === 'create-component') return createComponentAction()
  const sketch = activeSketchFeature(state)
  if (sketch && id === 'trim')
    return {
      id,
      label: 'Trim',
      hint: 'Click the portion to remove. Escape finishes Trim.',
      run: () => {
        state.setTool('trim')
        state.setStatus('Trim: click the portion to remove. Escape finishes Trim.')
      },
    }
  if (sketch && ['offset', 'construction', 'trim'].includes(id)) {
    const a = sketchActions(sketch.sketch, state.sketchSelection).find((a) => a.id === id)
    return a
      ? { ...a, run: (v, b, c, choice) => state.applySketchAction(a.build(v, b, c, choice)) }
      : null
  }
  const bodyId = selectedBodyId(state)
  const found = bodyId ? findBody(state.doc, bodyId) : undefined
  const occurrence =
    state.selection.kind === 'occurrence' && state.selection.id
      ? findOccurrence(state.doc, state.selection.id)
      : undefined
  if (id === 'linked-copy' && occurrence)
    return {
      id,
      label: 'Linked Copy',
      hint: 'Another occurrence of the same component. Changing one changes both.',
      run: () => state.linkedCopy(occurrence.id),
    }
  if (id === 'appearance' && found)
    return {
      id,
      label: 'Appearance',
      hint: 'Body display colour. Physical material properties are not changed.',
      choice: {
        label: 'Colour',
        initial: found.body.colour,
        options: [
          { value: found.body.colour, label: 'Current' },
          ...[
            ['#b9c0c7', 'Aluminium'],
            ['#355c8a', 'Blue'],
            ['#c9642d', 'Orange'],
            ['#31363c', 'Graphite'],
            ['#eeeeea', 'White'],
          ]
            .filter(([v]) => v !== found.body.colour)
            .map(([value, label]) => ({ value, label })),
        ],
      },
      run: (_a, _b, _c, colour) => state.updateBody(found.body.id, { colour: colour! }),
    }
  return actions.find((action) => action.id === id) ?? null
}

export function toggleVisibility() {
  const s = useStore.getState()
  const bodyId = selectedBodyId(s)
  const found = bodyId ? findBody(s.doc, bodyId) : undefined
  const occurrence =
    s.selection.kind === 'occurrence' && s.selection.id
      ? findOccurrence(s.doc, s.selection.id)
      : undefined
  if (found) s.updateBody(found.body.id, { visible: !found.body.visible })
  else if (occurrence) s.updateOccurrence(occurrence.id, { visible: !occurrence.visible })
  else s.setStatus('Select a body or component to toggle visibility.')
}
