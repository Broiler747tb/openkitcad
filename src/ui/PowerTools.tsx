import { useState } from 'react'
import { activeSketchFeature, newId, useStore } from '../doc/store'
import type { Sketch2D } from '../sketch/types'
import {
  addExactShape,
  copyTransformed,
  setFixed,
  deleteGeometry,
  cleanUnusedPoints,
  geometryLength,
} from '../sketch/power'
import { quantity } from '../core/quantity'
import type { Vec2 } from '../core/math'
import type { ObjectAction } from './ObjectMenu'
import { chooseAction } from './ActionDialog'

const numberField = (label: string, initial: number, unit = 'mm', min?: number, max?: number) => ({
  label,
  initial,
  unit,
  min,
  max,
})

export function powerActions(centre: Vec2 = [0, 0]): ObjectAction[] {
  const state = useStore.getState(),
    feature = activeSketchFeature(state)
  if (!feature) return []
  const selected = state.sketchSelection.filter((t) => t.kind === 'entity').map((t) => t.id)
  const edit = (fn: (sketch: Sketch2D) => string[] | void) => {
    const current = useStore.getState()
    if (current.activeSketch?.featureId !== feature.id)
      throw new Error('The active sketch changed. Reopen this command.')
    let added: string[] | void
    current.editSketch((s) => {
      added = fn(s)
    })
    current.solveActiveSketch()
    current.setSketchSelection((added! ?? []).map((id) => ({ kind: 'entity', id })))
  }
  const exactHint = `At X=${centre[0]}, Y=${centre[1]} mm. New geometry is fixed at its exact size; use Unfix to edit it freely.`
  const actions: ObjectAction[] = [
    {
      id: 'exact-line',
      label: 'Exact line: length & angle',
      group: 'Precision shapes',
      hint: exactHint,
      prompt: numberField('Length', 20, 'mm', 0.000001),
      prompt2: numberField('Angle from +X', 0, '°'),
      run: (a, b = 0) => edit((s) => addExactShape(s, 'line', centre, a, 0, b, newId)),
    },
    {
      id: 'exact-rectangle',
      label: 'Centred rotated rectangle',
      group: 'Precision shapes',
      hint: exactHint,
      prompt: numberField('Width', 30, 'mm', 0.000001),
      prompt2: numberField('Height', 20, 'mm', 0.000001),
      prompt3: numberField('Rotation', 0, '°'),
      run: (a, b = 20, c = 0) => edit((s) => addExactShape(s, 'rectangle', centre, a, b, c, newId)),
    },
    {
      id: 'exact-circle',
      label: 'Circle by diameter',
      group: 'Precision shapes',
      hint: exactHint,
      prompt: numberField('Diameter', 10, 'mm', 0.000001),
      run: (a) => edit((s) => addExactShape(s, 'circle', centre, a, 0, 0, newId)),
    },
    {
      id: 'exact-ring',
      label: 'Concentric ring / washer',
      group: 'Precision shapes',
      hint: exactHint,
      prompt: numberField('Outer diameter', 20, 'mm', 0.000001),
      prompt2: numberField('Inner diameter', 10, 'mm', 0.000001),
      run: (a, b = 10) => edit((s) => addExactShape(s, 'ring', centre, a, b, 0, newId)),
    },
    {
      id: 'clean-sketch',
      label: 'Remove unused points',
      group: 'Sketch utilities',
      run: () => edit((s) => cleanUnusedPoints(s)),
    },
  ]
  if (!selected.length) return actions
  const copyHint =
    'Creates independent, unconstrained copies; originals and their constraints are unchanged. Copies retain shared vertices. Count excludes originals.'
  const copy = (dx: number, dy: number, angle: number, scale: number, count: number) =>
    edit((s) => copyTransformed(s, selected, { dx, dy, angle, scale, centre, count }, newId))
  actions.push(
    {
      id: 'copy-translate',
      label: 'Translate copies / linear array',
      group: 'Copy geometry',
      hint: copyHint,
      prompt: numberField('X step', 10),
      prompt2: numberField('Y step', 0),
      prompt3: numberField('Copies', 1, '', 1, 100),
      run: (x, y = 0, n = 1) => copy(x, y, 0, 1, n),
    },
    {
      id: 'copy-rotate',
      label: 'Rotate copies / angular array',
      group: 'Copy geometry',
      hint: `${copyHint} Pivot: ${centre.join(', ')} mm.`,
      prompt: numberField('Angle step', 45, '°'),
      prompt2: numberField('Copies', 1, '', 1, 100),
      run: (a, n = 1) => copy(0, 0, a, 1, n),
    },
    {
      id: 'copy-scale',
      label: 'Scaled copy',
      group: 'Copy geometry',
      hint: `${copyHint} Scale centre: ${centre.join(', ')} mm.`,
      prompt: numberField('Scale factor', 2, '', 0.000001, 1000),
      run: (a) => copy(0, 0, 0, a, 1),
    },
    {
      id: 'fix-selected',
      label: 'Fix selected geometry',
      group: 'Selection utilities',
      hint: 'Locks selected points and circle radii at their current values. Shared points also affect adjacent edges.',
      run: () => edit((s) => setFixed(s, selected, true, newId)),
    },
    {
      id: 'unfix-selected',
      label: 'Unfix selected geometry',
      group: 'Selection utilities',
      hint: 'Removes Fix and Radius constraints on the selection, except the sketch origin. Other dimensions remain.',
      run: () => edit((s) => setFixed(s, selected, false, newId)),
    },
    {
      id: 'guides-selected',
      label: 'Make selection construction',
      group: 'Selection utilities',
      run: () =>
        edit((s) => {
          s.entities.forEach((e) => {
            if (selected.includes(e.id)) e.construction = true
          })
          return selected
        }),
    },
    {
      id: 'solid-selected',
      label: 'Make selection profile edges',
      group: 'Selection utilities',
      run: () =>
        edit((s) => {
          s.entities.forEach((e) => {
            if (selected.includes(e.id)) e.construction = false
          })
          return selected
        }),
    },
    {
      id: 'delete-selected-geometry',
      label: 'Delete selected geometry',
      group: 'Selection utilities',
      danger: true,
      run: () => edit((s) => deleteGeometry(s, selected)),
    },
  )
  return actions
}

export function SketchPowerTools() {
  const state = useStore(),
    feature = activeSketchFeature(state)
  const [x, setX] = useState('0'),
    [y, setY] = useState('0')
  if (!feature) return null
  let centre: Vec2 = [0, 0],
    error = ''
  try {
    centre = [quantity(x, 'mm'), quantity(y, 'mm')]
  } catch (e) {
    error = (e as Error).message
  }
  const entities = feature.sketch.entities,
    selected = new Set(state.sketchSelection.filter((t) => t.kind === 'entity').map((t) => t.id))
  const select = (filter: (e: (typeof entities)[number]) => boolean) =>
    state.setSketchSelection(entities.filter(filter).map((e) => ({ kind: 'entity', id: e.id })))
  const actions = powerActions(centre),
    groups = [...new Set(actions.map((a) => a.group))]
  return (
    <section className="section power-tools">
      <h3>Sketch workshop</h3>
      <p className="hint">
        {entities.length} edges · {selected.size} selected · selected length{' '}
        {geometryLength(feature.sketch, [...selected]).toFixed(3)} mm
      </p>
      <details open>
        <summary>Select geometry</summary>
        <div className="power-buttons">
          <button onClick={() => select(() => true)}>All</button>
          <button onClick={() => state.setSketchSelection([])}>None</button>
          <button onClick={() => select((e) => !selected.has(e.id))}>Invert</button>
          {(['line', 'circle', 'arc'] as const).map((kind) => (
            <button key={kind} onClick={() => select((e) => e.kind === kind)}>
              {kind}s
            </button>
          ))}
          <button onClick={() => select((e) => e.construction)}>Guides</button>
          <button onClick={() => select((e) => !e.construction)}>Profile edges</button>
        </div>
      </details>
      <details open>
        <summary>Creation centre / copy pivot</summary>
        <div className="coordinate-row">
          <label>
            X (mm)
            <input
              aria-label="Workshop centre X"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </label>
          <label>
            Y (mm)
            <input
              aria-label="Workshop centre Y"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </label>
        </div>
        <button
          onClick={() => {
            setX('0')
            setY('0')
          }}
        >
          Use origin
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
      {groups.map((group) => (
        <details key={group} open={group === 'Precision shapes'}>
          <summary>{group}</summary>
          <div className="power-buttons">
            {actions
              .filter((a) => a.group === group)
              .map((a) => (
                <button
                  key={a.id}
                  disabled={!!error}
                  title={a.hint}
                  onClick={() => chooseAction(a)}
                >
                  {a.label}
                </button>
              ))}
          </div>
        </details>
      ))}
      <p className="hint">
        All changes support Undo. Search S also includes these commands, using the sketch origin.
      </p>
    </section>
  )
}

export function SceneTools() {
  const state = useStore(),
    items = [...state.doc.bodies, ...state.doc.placements],
    selected = state.selection.bodyId ?? state.selection.id
  const visibility = (mode: 'all' | 'none' | 'invert' | 'isolate') =>
    state.commit((d) => {
      for (const item of [...d.bodies, ...d.placements])
        item.visible =
          mode === 'all'
            ? true
            : mode === 'none'
              ? false
              : mode === 'invert'
                ? !item.visible
                : item.id === selected
    })
  return (
    <section className="section power-tools">
      <h3>Scene visibility</h3>
      <p className="hint">
        {state.doc.bodies.length} bodies · {state.doc.placements.length} hardware parts ·{' '}
        {items.filter((i) => i.visible).length} visible
      </p>
      <div className="power-buttons">
        <button disabled={!items.length} onClick={() => visibility('all')}>
          Show all
        </button>
        <button disabled={!items.length} onClick={() => visibility('none')}>
          Hide all
        </button>
        <button disabled={!items.length} onClick={() => visibility('invert')}>
          Invert visibility
        </button>
        <button
          disabled={!items.some((i) => i.id === selected)}
          onClick={() => visibility('isolate')}
        >
          Isolate selected
        </button>
      </div>
      <p className="hint">
        Undo restores previous visibility. Hidden objects remain in the Browser.
      </p>
    </section>
  )
}
