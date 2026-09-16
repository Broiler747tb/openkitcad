import { useEffect, useRef, useState } from 'react'
import { activeSketchFeature, useStore, type ToolId } from '../doc/store'
import { emptyDocument } from '../doc/types'
import { openDocument, saveDocument } from '../doc/persist'
import { objectActions, type ObjectAction } from './ObjectMenu'
import { selectedObjectActions } from './workflow'
import { chooseAction } from './ActionDialog'
import { FlyoutMenu } from './FlyoutMenu'
import { sketchActions } from '../sketch/actions'
import { createSketchAction, resolveCommand, SHORTCUTS, toggleVisibility } from './fusionCommands'
import { powerActions } from './PowerTools'
import { ParametersDialog } from './ParametersDialog'
import { startCommand } from './command/commands'
import { SKETCH_TOOL_MENUS, SKETCH_TOOLS } from '../sketch/tools/specs'

const SKETCH_MENU_ICONS: Record<string, string> = {
  Line: '╱',
  Rectangle: '▭',
  Circle: '○',
  Arc: '◠',
  Polygon: '⬡',
  Ellipse: '⬭',
  Slot: '⊂⊃',
  Spline: '∿',
  Point: '·',
}
const RIBBON_MENUS = ['Line', 'Rectangle', 'Circle', 'Arc', 'Polygon', 'Slot', 'Spline']
const labels: Record<string, string> = {
  extrude: 'Extrude',
  revolve: 'Revolve',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  move: 'Move',
  hole: 'Hole',
  appearance: 'Appearance',
  hollow: 'Shell',
  shell: 'Shell',
  combine: 'Combine',
  vent: 'Vent',
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  offset: 'Offset',
  construction: 'Construction',
  trim: 'Trim',
}
export function Toolbar({
  onExport,
  onTutorial,
  onCatalogue,
  onInspect,
}: {
  onExport: () => void
  onTutorial: () => void
  onCatalogue: () => void
  onInspect: () => void
}) {
  const state = useStore()
  const [palette, setPalette] = useState(false),
    [help, setHelp] = useState(false)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null),
    [menu, setMenu] = useState<string | null>(null)
  const [variants, setVariants] = useState<Record<string, ToolId>>({})
  const root = useRef<HTMLElement>(null)
  const sketch = activeSketchFeature(state)
  const creations = objectActions({ kind: 'none' }),
    selected = selectedObjectActions()
  const sketchCommands: ObjectAction[] = sketch
    ? [
        ...sketchActions(sketch.sketch, state.sketchSelection).map((a) => ({
          ...a,
          run: (v: number, b?: number, c?: number, choice?: string) =>
            state.applySketchAction(a.build(v, b, c, choice)),
        })),
        ...powerActions(),
      ]
    : []
  const cmd = (id: string): ObjectAction => ({
    id: 'command-' + id,
    label: labels[id] ?? id,
    group: 'Design',
    run: () => invoke(id),
  })
  const pickTool = (id: ToolId) => {
    setPending(null)
    setMenu(null)
    state.setTool(id)
  }
  const toolActions: ObjectAction[] = SKETCH_TOOLS.map((tool) => ({
    id: 'tool-' + tool.id,
    label: tool.label,
    hint: tool.hint,
    group: tool.menu,
    run: () => pickTool(tool.id),
  }))
  const commands = state.activeSketch
    ? [
        ...toolActions,
        {
          id: 'dimension',
          label: 'Sketch Dimension',
          group: 'Sketch',
          run: () => pickTool('dimension'),
        },
        ...sketchCommands,
        cmd('trim'),
        cmd('extrude'),
        cmd('revolve'),
      ]
    : [
        createSketchAction(),
        ...creations,
        ...(state.selection.kind === 'none' ? [] : selected),
        ...['extrude', 'revolve', 'fillet', 'move', 'hole', 'appearance'].map(cmd),
      ]
  function invoke(id: string) {
    setMenu(null)
    if (startCommand(id)) {
      setPending(null)
      return
    }
    const a = resolveCommand(id)
    if (a) {
      setPending(null)
      chooseAction(a)
    } else {
      setPending(id)
      state.setTool('select')
    }
  }
  commands.push({
    id: 'parameters',
    label: 'User parameters · linked dimensions',
    group: 'Modify',
    run: () => setParametersOpen(true),
  })
  function newDesign() {
    const s = useStore.getState()
    if (
      (s.doc.timeline.length || s.doc.occurrences.length) &&
      !confirm('Start a new design? Save the current design first to keep it.')
    )
      return
    setPending(null)
    s.setDoc(emptyDocument())
  }
  async function open() {
    try {
      const d = await openDocument()
      if (d) {
        setPending(null)
        useStore.getState().setDoc(d)
      }
    } catch (e) {
      state.setStatus(String(e))
    }
  }
  useEffect(() => {
    if (!pending) return
    const a = resolveCommand(pending)
    if (a) {
      setPending(null)
      chooseAction(a)
    }
  }, [pending, state.selection, state.subSelection, state.sketchSelection, state.activeSketch])
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.repeat ||
        (e.target instanceof Element &&
          e.target.closest('input,textarea,select,[contenteditable="true"],dialog'))
      )
        return
      const k = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase(),
        mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        setPending(null)
        setMenu(null)
        return
      }
      if (mod && e.altKey && k === 'b') {
        e.preventDefault()
        document.documentElement.classList.toggle('browser-hidden')
        return
      }
      if (mod && !e.altKey && k === 'a' && sketch) {
        e.preventDefault()
        state.setSketchSelection(sketch.sketch.entities.map((e) => ({ kind: 'entity', id: e.id })))
        return
      }
      if (mod && e.shiftKey && !e.altKey && k === 'i' && sketch) {
        e.preventDefault()
        const ids = new Set(
          state.sketchSelection.filter((t) => t.kind === 'entity').map((t) => t.id),
        )
        state.setSketchSelection(
          sketch.sketch.entities
            .filter((e) => !ids.has(e.id))
            .map((e) => ({ kind: 'entity', id: e.id })),
        )
        return
      }
      if (mod && !e.altKey && !e.shiftKey) {
        if (k === 'k') {
          e.preventDefault()
          setPalette(true)
        } else if (k === 'n') {
          e.preventDefault()
          newDesign()
        } else if (k === 'o') {
          e.preventDefault()
          void open()
        } else if (k === 'b') {
          e.preventDefault()
          state.rebuild()
        }
        return
      }
      if (mod || e.altKey || e.shiftKey) return
      const s = useStore.getState()
      if (k === 's') {
        e.preventDefault()
        setPending(null)
        setPalette(true)
        return
      }
      if (k === 'i') {
        e.preventDefault()
        s.clearMeasure()
        s.setTool(s.tool === 'measure' ? 'select' : 'measure')
        return
      }
      if (k === 'v' && !s.activeSketch) {
        e.preventDefault()
        toggleVisibility()
        return
      }
      const sketchMap: Record<string, ToolId> = {
        l: 'line',
        r: 'rectangle',
        c: 'circle',
        d: 'dimension',
      }
      if (s.activeSketch && sketchMap[k]) {
        e.preventDefault()
        setPending(null)
        s.setTool(sketchMap[k])
        return
      }
      const map: Record<string, string> = s.activeSketch
        ? { e: 'extrude', o: 'offset', x: 'construction', t: 'trim' }
        : { e: 'extrude', f: 'fillet', m: 'move', h: 'hole', a: 'appearance' }
      if (map[k]) {
        e.preventDefault()
        invoke(map[k])
        return
      }
      if (['q', 'j', 'p'].includes(k)) {
        e.preventDefault()
        s.setStatus(
          'This Fusion operation is not implemented in the current CAD kernel. Use S for available commands.',
        )
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const tool = (label: string, icon: string, run: () => void, key?: string) => (
    <button className="ribbon-tool" title={label + (key ? ' (' + key + ')' : '')} onClick={run}>
      <span className="tool-symbol" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
  const group = (label: string, items: ObjectAction[], children: React.ReactNode) => (
    <div className="fusion-group">
      <div className="fusion-group-tools">{children}</div>
      <button
        className="group-trigger"
        aria-expanded={menu === label}
        onClick={() => setMenu(menu === label ? null : label)}
      >
        {label} ▾
      </button>
      {menu === label && (
        <div className="fusion-dropdown" role="region" aria-label={label + ' commands'}>
          {items.length ? (
            <FlyoutMenu
              actions={items}
              onPick={(a) => {
                setMenu(null)
                chooseAction(a)
              }}
            />
          ) : (
            <p className="hint">Select applicable geometry to see commands.</p>
          )}
        </div>
      )}
    </div>
  )
  return (
    <header className="workspace-header" ref={root}>
      <div className="app-header">
        <span className="brand">
          <span className="brand-mark">K</span>OpenKitCAD
        </span>
        <button className="tb" onClick={() => setParametersOpen(true)}>
          fx Parameters
        </button>
        <details className="file-menu">
          <summary>File ▾</summary>
          <div onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            <button onClick={newDesign}>
              New Design <kbd>Ctrl N</kbd>
            </button>
            <button onClick={() => void open()}>
              Open… <kbd>Ctrl O</kbd>
            </button>
            <button onClick={() => saveDocument(state.doc)}>
              Save <kbd>Ctrl S</kbd>
            </button>
            <button disabled={!state.instances.length} onClick={onExport}>
              Export…
            </button>
          </div>
        </details>
        <button
          className="quick-icon"
          title="Save (Ctrl S)"
          aria-label="Save"
          onClick={() => saveDocument(state.doc)}
        >
          ▣
        </button>
        <button
          className="quick-icon"
          title="Undo (Ctrl Z)"
          aria-label="Undo"
          disabled={!state.past.length}
          onClick={state.undo}
        >
          ↶
        </button>
        <button
          className="quick-icon"
          title="Redo (Ctrl Y)"
          aria-label="Redo"
          disabled={!state.future.length}
          onClick={state.redo}
        >
          ↷
        </button>
        <span className="document-tab">
          {state.doc.name || 'Untitled'} <small>LOCAL</small>
        </span>
        <span className="spacer" />
        <button className="command-trigger" onClick={() => setPalette(true)}>
          Search commands <kbd>S</kbd>
        </button>
        <button className="tb" onClick={() => setHelp(true)}>
          Shortcuts
        </button>
        <button className="tb" onClick={onTutorial}>
          Help
        </button>
      </div>
      <div className="workspace-tabs">
        <span className="design-workspace">DESIGN</span>
        <span className={'workspace-tab ' + (!state.activeSketch ? 'active' : '')}>SOLID</span>
        {state.activeSketch && <span className="workspace-tab sketch-tab active">SKETCH</span>}
        <span className="spacer" />
        <span className="offline-indicator">● Offline document</span>
      </div>
      <div className="ribbon">
        {state.activeSketch ? (
          <>
            {group(
              'CREATE',
              [...toolActions, ...sketchCommands],
              RIBBON_MENUS.map((name) => {
                const tools = SKETCH_TOOL_MENUS.find((entry) => entry.menu === name)?.tools ?? []
                const chosen = tools.find((tool) => tool.id === variants[name]) ?? tools[0]
                if (!chosen) return null
                const active = tools.some((tool) => tool.id === state.tool)
                const flyout = 'tool:' + name
                return (
                  <div key={name} className={'ribbon-split' + (active ? ' active' : '')}>
                    <button
                      className={'ribbon-tool ' + (active ? 'active' : '')}
                      title={
                        chosen.label +
                        (chosen.shortcut ? ' (' + chosen.shortcut + ')' : '') +
                        ' - ' +
                        chosen.hint
                      }
                      aria-pressed={active}
                      onClick={() => pickTool(chosen.id)}
                    >
                      <span className="tool-symbol">{SKETCH_MENU_ICONS[name]}</span>
                      <span>{name}</span>
                    </button>
                    {tools.length > 1 && (
                      <button
                        className="ribbon-split-arrow"
                        aria-label={name + ' options'}
                        aria-expanded={menu === flyout}
                        onClick={() => setMenu(menu === flyout ? null : flyout)}
                      >
                        ▾
                      </button>
                    )}
                    {menu === flyout && (
                      <div className="fusion-dropdown ribbon-split-menu" role="menu">
                        {tools.map((tool) => (
                          <button
                            key={tool.id}
                            role="menuitem"
                            className={state.tool === tool.id ? 'active' : ''}
                            title={tool.hint}
                            onClick={() => {
                              setVariants({ ...variants, [name]: tool.id })
                              pickTool(tool.id)
                            }}
                          >
                            {tool.label}
                            {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }),
            )}
            {group(
              'MODIFY',
              sketchCommands,
              <>
                {tool('Trim', '✂', () => invoke('trim'), 'T')}
                {tool('Offset', '⊚', () => invoke('offset'), 'O')}
                {tool('Construction', '┄', () => invoke('construction'), 'X')}
              </>,
            )}
            {group(
              'CONSTRAINTS',
              sketchCommands.filter((a) =>
                ['Hold it in place', 'Set a size'].includes(a.group ?? ''),
              ),
              tool('Dimension', '↔', () => state.setTool('dimension'), 'D'),
            )}
            <span className="spacer" />
            <button
              className="finish-sketch"
              onClick={() => {
                setPending(null)
                state.closeSketch()
              }}
            >
              ✓<span>Finish Sketch</span>
            </button>
          </>
        ) : (
          <>
            <div className="fusion-group standalone">
              {tool('Create Sketch', '▧', () => chooseAction(createSketchAction()))}
            </div>
            {group(
              'CREATE',
              [
                cmd('extrude'),
                cmd('revolve'),
                cmd('hole'),
                cmd('box'),
                cmd('cylinder'),
                cmd('sphere'),
              ],
              <>
                {tool('Extrude', '⇧', () => invoke('extrude'), 'E')}
                {tool('Revolve', '⟳', () => invoke('revolve'))}
                {tool('Hole', '⊙', () => invoke('hole'), 'H')}
              </>,
            )}
            {group(
              'MODIFY',
              [
                ...['fillet', 'chamfer', 'hollow', 'combine', 'vent', 'move', 'appearance'].map(
                  cmd,
                ),
                ...selected,
              ],
              <>
                {tool('Fillet', '◜', () => invoke('fillet'), 'F')}
                {tool('Move', '✥', () => invoke('move'), 'M')}
                {tool('Shell', '▣', () => invoke('hollow'))}
              </>,
            )}
            {group(
              'ASSEMBLE',
              selected.filter((a) => ['holes', 'standoffs', 'ports', 'negative'].includes(a.id)),
              tool('Hardware', '▦', onCatalogue),
            )}
            {group(
              'CONSTRUCT',
              creations.filter((a) => a.id.startsWith('sketch-')),
              tool('Plane', '▱', () => chooseAction(createSketchAction())),
            )}
            {group(
              'INSPECT',
              [
                { id: 'checks', label: 'Design checks', run: onInspect },
                {
                  id: 'section',
                  label: 'Section analysis',
                  run: () => state.setSection({ enabled: !state.section.enabled }),
                },
              ],
              tool(
                'Measure',
                '↔',
                () => {
                  state.clearMeasure()
                  state.setTool(state.tool === 'measure' ? 'select' : 'measure')
                },
                'I',
              ),
            )}
            {group(
              'INSERT',
              [{ id: 'hardware', label: 'Insert hardware', run: onCatalogue }],
              tool('Insert', '⊞', onCatalogue),
            )}
            <div className="fusion-group standalone">
              {tool('Select', '↖', () => {
                setPending(null)
                state.setTool('select')
                state.select({ kind: 'none' })
              })}
            </div>
          </>
        )}
      </div>
      {pending && (
        <div className="pending-command" role="status">
          <strong>{labels[pending] ?? pending}</strong>
          <span>
            {['extrude', 'revolve'].includes(pending)
              ? 'Select a closed sketch in the Browser or timeline.'
              : state.activeSketch
                ? 'Select applicable sketch geometry.'
                : 'Select a body, edge or component.'}
          </span>
          <button onClick={() => setPending(null)}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      )}
      {parametersOpen && <ParametersDialog onClose={() => setParametersOpen(false)} />}
      {palette && <CommandPalette actions={commands} onClose={() => setPalette(false)} />}
      {help && <ShortcutDialog onClose={() => setHelp(false)} />}
    </header>
  )
}
function CommandPalette({ actions, onClose }: { actions: ObjectAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector('input')?.focus()
  }, [])
  return (
    <dialog
      ref={ref}
      className="action-dialog command-dialog"
      aria-label="Command toolbox"
      onCancel={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="dialog-heading">
        <h2>Design Shortcuts</h2>
        <button onClick={onClose}>×</button>
      </div>
      <FlyoutMenu
        actions={actions.filter((a, i) => actions.findIndex((b) => b.id === a.id) === i)}
        onPick={(a) => {
          onClose()
          chooseAction(a)
        }}
      />
    </dialog>
  )
}
function ShortcutDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="action-dialog command-dialog"
      aria-label="Keyboard shortcuts"
      onCancel={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="dialog-heading">
        <h2>Keyboard & navigation</h2>
        <button onClick={onClose}>×</button>
      </div>
      <p className="hint">
        Fusion-style mappings for supported commands. Shortcuts do not run while typing.
      </p>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        Press Pull (Q), joints (J), projection (P), CAM and surface modelling are not implemented.
        Hole uses world XY coordinates. Arc is in the Sketch toolbar.
      </p>
    </dialog>
  )
}
