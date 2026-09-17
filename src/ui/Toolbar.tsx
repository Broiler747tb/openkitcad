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
import { useCommand } from './command/session'
import { SKETCH_TOOL_MENUS, SKETCH_TOOLS } from '../sketch/tools/specs'
import { CONSTRAINT_TOOLS } from '../sketch/constraintTools'
import { startConstraintTool } from './sketchConstraints'
import { moveCopyAction, rectangularPatternAction, scaleAction } from './sketchModify'
import { THEME_LABEL, THEME_PREFERENCES, useTheme } from '../theme/theme'
import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark'
import { openMotionStudy } from './MotionStudy'
import { insertMeshFile } from './meshImport'
import {
  ConvertMeshIcon,
  InsertMeshIcon,
  MeshPlaneCutIcon,
  MeshReduceIcon,
  MeshRepairIcon,
  MeshReverseIcon,
  MeshSmoothIcon,
  RemeshIcon,
  TessellateIcon,
} from './icons/mesh'
import { rememberCommand } from './MarkingMenu'
import { ExtrudeIcon, HoleIcon, LoftIcon, RevolveIcon, SweepIcon, ThickenIcon } from './icons/solid'
import {
  OffsetSurfaceIcon,
  PatchIcon,
  StitchIcon,
  SurfaceExtrudeIcon,
  SurfaceReverseNormalIcon,
  SurfaceRevolveIcon,
  UnstitchIcon,
} from './icons/surface'
import { AsBuiltJointIcon, JointIcon, JointOriginIcon } from './icons/assemble'
import { SnapFitIcon } from './icons/fit'
import { FilletIcon, MoveCopyIcon as SolidMoveIcon, PressPullIcon, ShellIcon } from './icons/modify'
import {
  BreakIcon,
  CONSTRAINT_ICONS,
  CreateSketchIcon,
  ExtendIcon,
  FinishSketchIcon,
  HardwareIcon,
  MeasureIcon,
  MoveCopyIcon,
  OffsetIcon,
  PlaneIcon,
  SelectIcon,
  SKETCH_MENU_ICONS,
  SketchDimensionIcon,
  SketchFilletIcon,
  TrimIcon,
} from './icons/sketch'

const RIBBON_MENUS = ['Line', 'Rectangle', 'Circle', 'Arc', 'Polygon', 'Slot', 'Spline']
const WORKSPACES = ['solid', 'surface', 'mesh'] as const
const DESIGN_COMMANDS = [
  'offsetPlane',
  'planeAtAngle',
  'midplane',
  'pressPull',
  'offsetFace',
  'draft',
  'extrude',
  'revolve',
  'sweep',
  'loft',
  'coil',
  'pipe',
  'thicken',
  'bodyPattern',
  'mirror',
  'fillet',
  'move',
  'splitBody',
  'scale',
  'hole',
  'appearance',
  'extrudeSurface',
  'revolveSurface',
  'sweepSurface',
  'loftSurface',
  'patch',
  'surfaceOffset',
  'stitch',
  'unstitch',
  'reverseNormal',
  'joint',
  'asBuiltJoint',
  'jointOrigin',
  'rigidGroup',
  'driveJoints',
  'motionLink',
  'tessellate',
  'meshRepair',
  'meshRemesh',
  'meshReduce',
  'meshConvert',
  'meshPlaneCut',
  'meshSmooth',
  'meshReverse',
  'meshSeparate',
  'meshCombine',
]
const labels: Record<string, string> = {
  snapFit: 'Snap Fit',
  fitPins: 'Alignment Pins',
  lipGroove: 'Lip and Groove',
  dovetail: 'Dovetail',
  snapRing: 'Snap Ring',
  bayonet: 'Bayonet',
  hinge: 'Print-in-place Hinge',
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
  joint: 'Joint',
  asBuiltJoint: 'As-built Joint',
  jointOrigin: 'Joint Origin',
  rigidGroup: 'Rigid Group',
  motionLink: 'Motion Link',
  driveJoints: 'Drive Joints',
  meshInsert: 'Insert Mesh',
  tessellate: 'Tessellate',
  meshRepair: 'Repair',
  meshReduce: 'Reduce',
  meshRemesh: 'Remesh',
  meshSmooth: 'Smooth',
  meshReverse: 'Reverse Normal',
  meshPlaneCut: 'Plane Cut',
  meshSeparate: 'Separate',
  meshCombine: 'Combine Meshes',
  meshConvert: 'Convert Mesh',
  torus: 'Torus',
  offsetPlane: 'Offset Plane',
  planeAtAngle: 'Plane at Angle',
  midplane: 'Midplane',
  pressPull: 'Press Pull',
  offsetFace: 'Offset Face',
  draft: 'Draft',
  sweep: 'Sweep',
  loft: 'Loft',
  coil: 'Coil',
  pipe: 'Pipe',
  thicken: 'Thicken',
  bodyPattern: 'Pattern',
  mirror: 'Mirror',
  splitBody: 'Split Body',
  scale: 'Scale',
  extrudeSurface: 'Extrude Surface',
  revolveSurface: 'Revolve Surface',
  sweepSurface: 'Sweep Surface',
  loftSurface: 'Loft Surface',
  patch: 'Patch',
  surfaceOffset: 'Offset Surface',
  stitch: 'Stitch',
  unstitch: 'Unstitch',
  reverseNormal: 'Reverse Normal',
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
  const [workspace, setWorkspace] = useState<(typeof WORKSPACES)[number]>('solid')
  const commanding = useCommand((s) => !!s.session)
  const themeState = useTheme()
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
    const label = SKETCH_TOOLS.find((tool) => tool.id === id)?.label ?? id
    rememberCommand(id, label, () => useStore.getState().setTool(id))
    state.setTool(id)
  }
  const toolActions: ObjectAction[] = SKETCH_TOOLS.map((tool) => ({
    id: 'tool-' + tool.id,
    label: tool.label,
    hint: tool.hint,
    group: tool.menu,
    run: () => pickTool(tool.id),
  }))
  const modifyTool = (id: ToolId, label: string, hint: string, status: string): ObjectAction => ({
    id: 'tool-' + id,
    label,
    hint,
    group: 'Modify',
    run: () => {
      pickTool(id)
      state.setStatus(status)
    },
  })
  const sketchCreateExtras: ObjectAction[] = [
    modifyTool(
      'project',
      'Project',
      'Brings the edges of a body into the sketch as fixed geometry.',
      'Project: click an edge or face of a body.',
    ),
    modifyTool(
      'mirror',
      'Mirror',
      'Copies the selected geometry across a line, tied with symmetry.',
      'Mirror: with the geometry selected, click the line to mirror about.',
    ),
    modifyTool(
      'circularPattern',
      'Circular Pattern',
      'Repeats the selected geometry around a centre point.',
      'Circular Pattern: with the geometry selected, click the centre point.',
    ),
    { ...rectangularPatternAction(), run: rectangularPatternAction().run },
  ]
  const sketchModifyActions: ObjectAction[] = [
    modifyTool(
      'sketchFillet',
      'Fillet',
      'Rounds a corner of the sketch.',
      'Fillet: pick a corner, or two curves.',
    ),
    modifyTool(
      'trim',
      'Trim',
      'Removes the piece of a curve up to where it crosses something.',
      'Trim: click the piece to remove.',
    ),
    modifyTool(
      'extend',
      'Extend',
      'Lengthens a line or arc to the next curve.',
      'Extend: click near the end to lengthen.',
    ),
    modifyTool(
      'break',
      'Break',
      'Splits a curve where it crosses something.',
      'Break: click the piece to split off.',
    ),
    moveCopyAction(),
    scaleAction(),
  ]
  const commands = state.activeSketch
    ? [
        ...toolActions,
        ...sketchCreateExtras,
        ...sketchModifyActions,
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
        ...DESIGN_COMMANDS.map(cmd),
      ]
  function invoke(id: string) {
    setMenu(null)
    rememberCommand(id, labels[id] ?? id, () => invoke(id))
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
      if (e.shiftKey && !mod && !e.altKey && k === 'j' && !useStore.getState().activeSketch) {
        e.preventDefault()
        invoke('asBuiltJoint')
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
      if (s.activeSketch && k === 'p') {
        e.preventDefault()
        setPending(null)
        s.setTool('project')
        s.setStatus('Project: click an edge or face of a body.')
        return
      }
      if (s.activeSketch && k === 'm') {
        e.preventDefault()
        chooseAction(moveCopyAction())
        return
      }
      const map: Record<string, string> = s.activeSketch
        ? { e: 'extrude', o: 'offset', x: 'construction', t: 'trim' }
        : {
            e: 'extrude',
            f: 'fillet',
            m: 'move',
            h: 'hole',
            a: 'appearance',
            j: 'joint',
            q: 'pressPull',
          }
      if (map[k]) {
        e.preventDefault()
        invoke(map[k])
        return
      }
      if (k === 'p') {
        e.preventDefault()
        s.setStatus('Project works inside a sketch. Create or edit a sketch first.')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const tool = (label: string, icon: ReactNode, run: () => void, key?: string) => (
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
  const inspectGroup = group(
    'INSPECT',
    [],
    tool(
      'Measure',
      <MeasureIcon className="okc-icon" />,
      () => {
        state.clearMeasure()
        state.setTool(state.tool === 'measure' ? 'select' : 'measure')
      },
      'I',
    ),
  )
  const selecting = state.tool === 'select' && !commanding && !state.pickingSketchPlane && !pending
  const selectMode = () => {
    setPending(null)
    setMenu(null)
    useCommand.getState().cancel()
    const store = useStore.getState()
    store.setPickingSketchPlane(false)
    window.dispatchEvent(new Event('okc:cancel'))
    store.setStatus('')
  }
  const selectActions: ObjectAction[] = [
    {
      id: 'select-tool',
      label: 'Select',
      hint: 'Stops the current tool or command and goes back to picking. Esc does the same.',
      group: 'Select',
      run: selectMode,
    },
    ...(sketch
      ? [
          {
            id: 'select-all',
            label: 'Select All',
            hint: 'Every curve and point in the sketch. Ctrl A.',
            group: 'Select',
            run: () =>
              state.setSketchSelection(
                sketch.sketch.entities.map((entity) => ({
                  kind: 'entity' as const,
                  id: entity.id,
                })),
              ),
          },
          {
            id: 'select-invert',
            label: 'Invert Selection',
            hint: 'Selects what is not selected, and the other way round. Ctrl Shift I.',
            group: 'Select',
            run: () => {
              const ids = new Set(
                state.sketchSelection
                  .filter((target) => target.kind === 'entity')
                  .map((target) => target.id),
              )
              state.setSketchSelection(
                sketch.sketch.entities
                  .filter((entity) => !ids.has(entity.id))
                  .map((entity) => ({ kind: 'entity' as const, id: entity.id })),
              )
            },
          },
          {
            id: 'select-none',
            label: 'Clear Selection',
            hint: 'Nothing in the sketch stays selected.',
            group: 'Select',
            run: () => state.setSketchSelection([]),
          },
        ]
      : [
          {
            id: 'select-none',
            label: 'Clear Selection',
            hint: 'Nothing in the design stays selected.',
            group: 'Select',
            run: () => {
              state.select({ kind: 'none' })
              state.setSubSelection([])
            },
          },
        ]),
  ]
  const selectGroup = group(
    'SELECT',
    selectActions,
    <button
      className={'ribbon-tool ' + (selecting ? 'active' : '')}
      title="Select (Esc)"
      aria-pressed={selecting}
      onClick={selectMode}
    >
      <span className="tool-symbol" aria-hidden="true">
        <SelectIcon className="okc-icon okc-icon-2d" />
      </span>
      <span>Select</span>
    </button>,
  )
  return (
    <header className="workspace-header" ref={root}>
      <div className="app-header">
        <span className="brand">
          <BrandMark size={26} />
          OpenKitCAD
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
        <label className="theme-picker" title="Colour theme">
          <span aria-hidden="true">{themeState.theme === 'dark' ? '☾' : '☀'}</span>
          <select
            aria-label="Colour theme"
            value={themeState.preference}
            onChange={(e) => themeState.setTheme(e.target.value as typeof themeState.preference)}
          >
            {THEME_PREFERENCES.map((preference) => (
              <option key={preference} value={preference}>
                {THEME_LABEL[preference]}
              </option>
            ))}
          </select>
        </label>
        <button className="tb" onClick={() => setHelp(true)}>
          Shortcuts
        </button>
        <button className="tb" onClick={onTutorial}>
          Help
        </button>
      </div>
      <div className="workspace-tabs">
        <span className="design-workspace">DESIGN</span>
        {WORKSPACES.map((tab) => (
          <button
            key={tab}
            className={
              'workspace-tab ' + (!state.activeSketch && workspace === tab ? 'active' : '')
            }
            aria-pressed={!state.activeSketch && workspace === tab}
            onClick={() => {
              if (state.activeSketch) state.closeSketch()
              setMenu(null)
              setWorkspace(tab)
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
        {state.activeSketch && <span className="workspace-tab sketch-tab active">SKETCH</span>}
        <span className="spacer" />
        <span className="offline-indicator">● Offline document</span>
      </div>
      <div className="ribbon">
        {state.activeSketch ? (
          <>
            {group(
              'CREATE',
              [...toolActions, ...sketchCreateExtras, ...sketchCommands],
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
                      <span className="tool-symbol">
                        {(() => {
                          const Icon = SKETCH_MENU_ICONS[name]
                          return Icon ? <Icon className="okc-icon okc-icon-2d" /> : null
                        })()}
                      </span>
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
              [
                ...sketchModifyActions,
                ...sketchCommands.filter((a) => a.group === 'Modify' || a.group === 'Pattern'),
              ],
              <>
                {tool('Fillet', <SketchFilletIcon className="okc-icon okc-icon-2d" />, () =>
                  chooseAction(sketchModifyActions[0]),
                )}
                {tool(
                  'Trim',
                  <TrimIcon className="okc-icon okc-icon-2d" />,
                  () => chooseAction(sketchModifyActions[1]),
                  'T',
                )}
                {tool('Extend', <ExtendIcon className="okc-icon okc-icon-2d" />, () =>
                  chooseAction(sketchModifyActions[2]),
                )}
                {tool('Break', <BreakIcon className="okc-icon okc-icon-2d" />, () =>
                  chooseAction(sketchModifyActions[3]),
                )}
                {tool(
                  'Offset',
                  <OffsetIcon className="okc-icon okc-icon-2d" />,
                  () => invoke('offset'),
                  'O',
                )}
                {tool(
                  'Move/Copy',
                  <MoveCopyIcon className="okc-icon okc-icon-2d" />,
                  () => chooseAction(sketchModifyActions[4]),
                  'M',
                )}
              </>,
            )}
            {group(
              'CONSTRAINTS',
              [
                ...CONSTRAINT_TOOLS.map((constraint) => ({
                  id: 'constraint-' + constraint.id,
                  label: constraint.label,
                  hint: constraint.hint,
                  group: 'Constraints',
                  run: () => startConstraintTool(constraint.id),
                })),
                ...sketchCommands.filter((a) => a.group === 'Dimensions'),
              ],
              <>
                {tool(
                  'Sketch Dimension',
                  <SketchDimensionIcon className="okc-icon okc-icon-2d" />,
                  () => pickTool('dimension'),
                  'D',
                )}
                <div className="constraint-grid" role="group" aria-label="Constraints">
                  {CONSTRAINT_TOOLS.map((constraint) => (
                    <button
                      key={constraint.id}
                      className={
                        'constraint-tool' +
                        (state.tool === 'constrain:' + constraint.id ? ' active' : '')
                      }
                      title={constraint.label + ' - ' + constraint.hint}
                      aria-label={constraint.label}
                      aria-pressed={state.tool === 'constrain:' + constraint.id}
                      onClick={() => {
                        setPending(null)
                        setMenu(null)
                        startConstraintTool(constraint.id)
                      }}
                    >
                      {(() => {
                        const Icon = CONSTRAINT_ICONS[constraint.id]
                        return Icon ? (
                          <Icon className="okc-icon okc-icon-2d" width={18} height={18} />
                        ) : (
                          constraint.icon
                        )
                      })()}
                    </button>
                  ))}
                </div>
              </>,
            )}
            {selectGroup}
            <span className="spacer" />
            <button
              className="finish-sketch"
              onClick={() => {
                setPending(null)
                state.closeSketch()
              }}
            >
              <FinishSketchIcon className="okc-icon" width={30} height={30} />
              <span>Finish Sketch</span>
            </button>
          </>
        ) : workspace === 'surface' ? (
          <>
            <div className="fusion-group standalone">
              {tool('Create Sketch', <CreateSketchIcon className="okc-icon" />, () =>
                chooseAction(createSketchAction()),
              )}
            </div>
            {group(
              'CREATE',
              [
                'extrudeSurface',
                'revolveSurface',
                'sweepSurface',
                'loftSurface',
                'patch',
                'surfaceOffset',
                'thicken',
              ].map((id) => ({ ...cmd(id), group: 'Create' })),
              <>
                {tool('Extrude', <SurfaceExtrudeIcon className="okc-icon" />, () =>
                  invoke('extrudeSurface'),
                )}
                {tool('Revolve', <SurfaceRevolveIcon className="okc-icon" />, () =>
                  invoke('revolveSurface'),
                )}
                {tool('Loft', <LoftIcon className="okc-icon" />, () => invoke('loftSurface'))}
                {tool('Patch', <PatchIcon className="okc-icon" />, () => invoke('patch'))}
                {tool('Offset', <OffsetSurfaceIcon className="okc-icon" />, () =>
                  invoke('surfaceOffset'),
                )}
                {tool('Thicken', <ThickenIcon className="okc-icon" />, () => invoke('thicken'))}
              </>,
            )}
            {group(
              'MODIFY',
              ['stitch', 'unstitch', 'reverseNormal', 'splitBody', 'scale', 'move'].map((id) => ({
                ...cmd(id),
                group: 'Modify',
              })),
              <>
                {tool('Stitch', <StitchIcon className="okc-icon" />, () => invoke('stitch'))}
                {tool('Unstitch', <UnstitchIcon className="okc-icon" />, () => invoke('unstitch'))}
                {tool('Reverse Normal', <SurfaceReverseNormalIcon className="okc-icon" />, () =>
                  invoke('reverseNormal'),
                )}
              </>,
            )}
            {inspectGroup}
            {selectGroup}
          </>
        ) : workspace === 'mesh' ? (
          <>
            {group(
              'CREATE',
              [
                {
                  id: 'mesh-insert',
                  label: 'Insert Mesh',
                  hint: 'Places an STL, OBJ or 3MF mesh in the design as a mesh body.',
                  group: 'Create',
                  run: () => void insertMeshFile(),
                },
                { ...cmd('tessellate'), group: 'Create' },
              ],
              <>
                {tool(
                  'Insert Mesh',
                  <InsertMeshIcon className="okc-icon" />,
                  () => void insertMeshFile(),
                )}
                {tool('Tessellate', <TessellateIcon className="okc-icon" />, () =>
                  invoke('tessellate'),
                )}
              </>,
            )}
            {group(
              'PREPARE',
              ['meshRepair', 'meshRemesh', 'meshReduce', 'meshConvert'].map((id) => ({
                ...cmd(id),
                group: 'Prepare',
              })),
              <>
                {tool('Repair', <MeshRepairIcon className="okc-icon" />, () =>
                  invoke('meshRepair'),
                )}
                {tool('Remesh', <RemeshIcon className="okc-icon" />, () => invoke('meshRemesh'))}
                {tool('Reduce', <MeshReduceIcon className="okc-icon" />, () =>
                  invoke('meshReduce'),
                )}
                {tool('Convert Mesh', <ConvertMeshIcon className="okc-icon" />, () =>
                  invoke('meshConvert'),
                )}
              </>,
            )}
            {group(
              'MODIFY',
              [
                ...[
                  'meshPlaneCut',
                  'meshSmooth',
                  'meshReverse',
                  'meshSeparate',
                  'meshCombine',
                  'move',
                ].map((id) => ({ ...cmd(id), group: 'Modify' })),
              ],
              <>
                {tool('Plane Cut', <MeshPlaneCutIcon className="okc-icon" />, () =>
                  invoke('meshPlaneCut'),
                )}
                {tool('Smooth', <MeshSmoothIcon className="okc-icon" />, () =>
                  invoke('meshSmooth'),
                )}
                {tool('Reverse Normal', <MeshReverseIcon className="okc-icon" />, () =>
                  invoke('meshReverse'),
                )}
              </>,
            )}
            {inspectGroup}
            {selectGroup}
          </>
        ) : (
          <>
            <div className="fusion-group standalone">
              {tool('Create Sketch', <CreateSketchIcon className="okc-icon" />, () =>
                chooseAction(createSketchAction()),
              )}
            </div>
            {group(
              'CREATE',
              [
                'extrude',
                'revolve',
                'sweep',
                'loft',
                'hole',
                'box',
                'cylinder',
                'sphere',
                'torus',
                'coil',
                'pipe',
                'bodyPattern',
                'mirror',
                'thicken',
              ].map((id) => ({ ...cmd(id), group: 'Create' })),
              <>
                {tool(
                  'Extrude',
                  <ExtrudeIcon className="okc-icon" />,
                  () => invoke('extrude'),
                  'E',
                )}
                {tool('Revolve', <RevolveIcon className="okc-icon" />, () => invoke('revolve'))}
                {tool('Sweep', <SweepIcon className="okc-icon" />, () => invoke('sweep'))}
                {tool('Loft', <LoftIcon className="okc-icon" />, () => invoke('loft'))}
                {tool('Hole', <HoleIcon className="okc-icon" />, () => invoke('hole'), 'H')}
              </>,
            )}
            {group(
              'MODIFY',
              [
                ...[
                  'pressPull',
                  'fillet',
                  'chamfer',
                  'hollow',
                  'draft',
                  'offsetFace',
                  'combine',
                  'splitBody',
                  'scale',
                  'vent',
                  'move',
                  'appearance',
                ].map((id) => ({ ...cmd(id), group: 'Modify' })),
                ...selected,
              ],
              <>
                {tool(
                  'Press Pull',
                  <PressPullIcon className="okc-icon" />,
                  () => invoke('pressPull'),
                  'Q',
                )}
                {tool('Fillet', <FilletIcon className="okc-icon" />, () => invoke('fillet'), 'F')}
                {tool('Shell', <ShellIcon className="okc-icon" />, () => invoke('hollow'))}
                {tool('Move', <SolidMoveIcon className="okc-icon" />, () => invoke('move'), 'M')}
              </>,
            )}
            {group(
              'FIT',
              ['snapFit', 'lipGroove', 'fitPins', 'dovetail', 'snapRing', 'bayonet', 'hinge'].map(
                (id) => ({ ...cmd(id), group: 'Fit' }),
              ),
              tool('Snap Fit', <SnapFitIcon className="okc-icon" />, () => invoke('snapFit')),
            )}
            {group(
              'ASSEMBLE',
              [
                ...creations.filter((a) => a.id === 'create-component'),
                ...[
                  'joint',
                  'asBuiltJoint',
                  'jointOrigin',
                  'rigidGroup',
                  'driveJoints',
                  'motionLink',
                ].map((id) => ({ ...cmd(id), group: 'Assemble' })),
                {
                  id: 'motion-study',
                  label: 'Motion Study',
                  hint: 'Moves joints over time so the mechanism can be played back.',
                  group: 'Assemble',
                  run: () => openMotionStudy(),
                },
                {
                  id: 'hardware',
                  label: 'Insert hardware',
                  group: 'Assemble',
                  run: onCatalogue,
                },
                ...selected.filter((a) =>
                  ['holes', 'standoffs', 'ports', 'negative'].includes(a.id),
                ),
              ],
              <>
                {tool('Joint', <JointIcon className="okc-icon" />, () => invoke('joint'), 'J')}
                {tool(
                  'As-built Joint',
                  <AsBuiltJointIcon className="okc-icon" />,
                  () => invoke('asBuiltJoint'),
                  'Shift J',
                )}
                {tool('Joint Origin', <JointOriginIcon className="okc-icon" />, () =>
                  invoke('jointOrigin'),
                )}
              </>,
            )}
            {group(
              'CONSTRUCT',
              ['offsetPlane', 'planeAtAngle', 'midplane'].map((id) => ({
                ...cmd(id),
                group: 'Construct',
              })),
              tool('Offset Plane', <PlaneIcon className="okc-icon" />, () => invoke('offsetPlane')),
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
                <MeasureIcon className="okc-icon" />,
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
              tool('Insert', <HardwareIcon className="okc-icon" />, onCatalogue),
            )}
            {selectGroup}
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
        Keys follow Fusion 360 wherever the command exists here. Press S to search every command.
      </p>
    </dialog>
  )
}
