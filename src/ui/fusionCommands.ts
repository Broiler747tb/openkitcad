import { activeSketchFeature, newId, useStore } from '../doc/store'
import { sketchActions } from '../sketch/actions'
import { extrusionAction, selectedObjectActions } from './workflow'
import type { ObjectAction } from './ObjectMenu'

export const SHORTCUTS = [
  ['S', 'Command toolbox'],
  ['E', 'Extrude'],
  ['F', 'Fillet'],
  ['H', 'Hole'],
  ['M', 'Move'],
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
  ['Esc', 'Cancel tool / clear selection'],
  ['Home', 'Fit view (OpenKitCAD extension)'],
  ['Middle drag', 'Pan'],
  ['Shift+Middle drag', 'Orbit'],
] as const

export function createSketchAction(): ObjectAction {
  const face = selectedObjectActions().find((a) => a.id === 'sketch-on-face')
  if (face) return { ...face, label: 'Create Sketch on selected face' }
  return {
    id: 'create-sketch',
    label: 'Create Sketch',
    hint: 'Select an origin plane. To use a face, cancel and select a planar face first.',
    choice: {
      label: 'Sketch plane',
      initial: 'XY',
      options: [
        { value: 'XY', label: 'XY · Top' },
        { value: 'XZ', label: 'XZ · Front' },
        { value: 'YZ', label: 'YZ · Right' },
      ],
    },
    run: (_a, _b, _c, plane) =>
      useStore
        .getState()
        .startSketch({ kind: 'named', name: plane as 'XY' | 'XZ' | 'YZ', offset: 0 }),
  }
}

/** Shared resolver for toolbar, command-first selection and keyboard shortcuts. */
export function resolveCommand(id: string): ObjectAction | null {
  const state = useStore.getState()
  const actions = selectedObjectActions()
  if (id === 'extrude' || id === 'revolve') return extrusionAction(id === 'revolve')
  if (id === 'create-sketch') return createSketchAction()
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
  const body = state.doc.bodies.find((b) => b.id === (state.selection.bodyId ?? state.selection.id))
  const part = state.doc.placements.find((p) => p.id === state.selection.id)
  if (id === 'move' && (body || part))
    return {
      id,
      label: 'Move',
      hint: 'Translate the selected object by an exact distance. Cancel leaves the model unchanged.',
      prompt: { label: 'X distance', initial: 0, unit: 'mm' },
      prompt2: { label: 'Y distance', initial: 0, unit: 'mm' },
      prompt3: { label: 'Z distance', initial: 0, unit: 'mm' },
      run: (x, y = 0, z = 0) => {
        if (!x && !y && !z) return
        if (body)
          state.addFeature(body.id, {
            id: newId('move'),
            kind: 'move',
            name: 'Move',
            offset: [x, y, z],
            rotation: [0, 0, 0],
          })
        else if (part)
          state.updatePlacement(part.id, {
            position: [part.position[0] + x, part.position[1] + y, part.position[2] + z],
          })
      },
    }
  if (id === 'appearance' && body)
    return {
      id,
      label: 'Appearance',
      hint: 'Body display colour. Physical material properties are not changed.',
      choice: {
        label: 'Colour',
        initial: body.colour,
        options: [
          { value: body.colour, label: 'Current' },
          ...[
            ['#b9c0c7', 'Aluminium'],
            ['#355c8a', 'Blue'],
            ['#c9642d', 'Orange'],
            ['#31363c', 'Graphite'],
            ['#eeeeea', 'White'],
          ]
            .filter(([v]) => v !== body.colour)
            .map(([value, label]) => ({ value, label })),
        ],
      },
      run: (_a, _b, _c, colour) =>
        state.commit((d) => {
          d.bodies.find((b) => b.id === body.id)!.colour = colour!
        }),
    }
  if (id === 'hole' && body)
    return {
      id,
      label: 'Hole',
      hint: 'Through hole normal to the XY plane. X and Y are world coordinates in millimetres.',
      prompt: { label: 'Diameter', initial: 3.4, unit: 'mm', min: 0.01 },
      prompt2: { label: 'X', initial: 0, unit: 'mm' },
      prompt3: { label: 'Y', initial: 0, unit: 'mm' },
      run: (diameter, x, y) =>
        state.addFeature(body.id, {
          id: newId('hole'),
          name: 'Hole',
          kind: 'hole',
          plane: { kind: 'named', name: 'XY', offset: 0 },
          source: { kind: 'explicit', positions: [[x ?? 0, y ?? 0]] },
          style: 'simple',
          diameter,
          depth: 'through',
        }),
    }
  const ids =
    id === 'fillet'
      ? ['round-picked', 'round']
      : id === 'chamfer'
        ? ['bevel-picked', 'bevel']
        : id === 'hole'
          ? ['holes']
          : [id]
  for (const candidate of ids) {
    const found = actions.find((a) => a.id === candidate)
    if (found) return found
  }
  return null
}

export function toggleVisibility() {
  const s = useStore.getState()
  const id = s.selection.bodyId ?? s.selection.id
  const body = s.doc.bodies.find((b) => b.id === id)
  const part = s.doc.placements.find((p) => p.id === id)
  if (body)
    s.commit((d) => {
      d.bodies.find((b) => b.id === id)!.visible = !body.visible
    })
  else if (part) s.updatePlacement(part.id, { visible: !part.visible })
  else s.setStatus('Select a body or component to toggle visibility.')
}
