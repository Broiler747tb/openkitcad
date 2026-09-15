import { useEffect, useState } from 'react'
import { Viewport } from './viewport/Viewport'
import { BuildProgress } from './ui/BuildProgress'
import { Toolbar } from './ui/Toolbar'
import { LeftPanel } from './ui/LeftPanel'
import { Inspector } from './ui/Inspector'
import { Tutorial } from './ui/Tutorial'
import { ExportDialog } from './ui/ExportDialog'
import { useStore } from './doc/store'
import { kernel } from './kernel/api'
import {
  discardOldAutosave,
  loadAutosave,
  readShareLink,
  scheduleAutosave,
  saveAutosaveNow,
} from './doc/persist'
import { planeLabel } from './doc/planes'
import { UNIT_NAME } from './core/units'
import type { OkcDocument } from './doc/types'
import { activeSketchFeature } from './doc/store'
import { ActionDialogHost } from './ui/ActionDialog'
import { Timeline, NavigationBar } from './ui/Timeline'
import { PenBar } from './ui/PenBar'
import { isAndroidApp } from './platform/android'

export function App() {
  const [showExport, setShowExport] = useState(false)
  const [leftTab, setLeftTab] = useState<'design' | 'catalogue'>('design')
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'actions' | 'checks'>(
    'properties',
  )
  /** Which side panel is pulled over the model, on a screen too narrow for both. */
  const [sheet, setSheet] = useState<'left' | 'right' | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const kernelReady = useStore((s) => s.kernelReady)
  const doc = useStore((s) => s.doc)
  const activeSketch = useStore((s) => s.activeSketch)
  const selection = useStore((s) => s.selection)

  // Boot the kernel, then restore whatever the user was last working on.
  useEffect(() => {
    let cancelled = false
    discardOldAutosave()
    kernel()
      .ready()
      .then(() => {
        if (cancelled) return
        useStore.getState().setKernelReady(true)

        let shared: OkcDocument | null = null
        try {
          shared = readShareLink()
        } catch (e) {
          history.replaceState(null, '', location.pathname)
          useStore.getState().setStatus((e as Error).message)
        }
        if (shared) {
          useStore.getState().setDoc(shared)
          history.replaceState(null, '', location.pathname)
          return
        }
        const saved = loadAutosave()
        if (saved && (saved.doc.timeline.length || saved.doc.occurrences.length)) {
          useStore.getState().setDoc(saved.doc)
          return
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Slow mobile WASM startup must not overwrite the previous autosave with an empty document.
    if (kernelReady) scheduleAutosave(doc)
  }, [doc, kernelReady])

  useEffect(() => {
    const save = () => {
      const s = useStore.getState()
      if (s.kernelReady) saveAutosaveNow(s.doc)
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('okc:background', save)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('okc:background', save)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])

  /*
   * Which panel is pulled over the model, written as a custom property on the
   * root element rather than as a class the stylesheet reacts to.
   *
   * A rule keyed on two classes of the same element - `.app.sheet-left` - was
   * not winning the cascade here, and a descendant form of it was being dropped
   * from the parsed stylesheet outright. Rather than keep guessing at why, the
   * value is set where nothing can outrank it: an inline custom property on
   * :root beats every stylesheet rule, and inherits to both panels.
   */
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--sheet-left', sheet === 'left' ? '0px' : '-360px')
    root.setProperty('--sheet-right', sheet === 'right' ? '0px' : '-360px')
  }, [sheet])

  return (
    <div
      className={`app ${activeSketch ? 'sketching' : ''} ${selection.kind === 'none' && !activeSketch && inspectorTab === 'properties' ? 'inspector-empty' : ''} ${sheet ? `sheet-${sheet}` : ''}`}
    >
      <Toolbar
        onExport={() => setShowExport(true)}
        onTutorial={() => setShowTutorial(true)}
        onCatalogue={() => {
          setLeftTab('catalogue')
          if (isAndroidApp || innerWidth <= 900) setSheet('left')
        }}
        onInspect={() => {
          setInspectorTab('checks')
          if (isAndroidApp || innerWidth <= 900) setSheet('right')
        }}
      />
      <LeftPanel tab={leftTab} onTab={setLeftTab} />
      <div className="viewport-wrap" style={{ display: 'contents' }}>
        <Viewport />
        <BuildProgress />
      </div>
      {/* Only drawn on a narrow screen, where the side panels are stacked on
          top of the model rather than beside it. A tap on the model itself
          puts them away again, which is the gesture people try first. */}
      <div className="sheet-backdrop" onPointerDown={() => setSheet(null)} />
      <div className="sheet-tabs">
        <button
          className={sheet === 'left' ? 'active' : ''}
          onClick={() => setSheet(sheet === 'left' ? null : 'left')}
        >
          Parts
        </button>
        <button
          className={sheet === 'right' ? 'active' : ''}
          onClick={() => setSheet(sheet === 'right' ? null : 'right')}
        >
          Details
        </button>
      </div>
      <Inspector tab={inspectorTab} onTab={setInspectorTab} />
      <NavigationBar />
      <PenBar
        onComponents={() => {
          setLeftTab('catalogue')
          setSheet('left')
        }}
        onDetails={() => setSheet(sheet === 'right' ? null : 'right')}
        onClosePanel={() => setSheet(null)}
        panelOpen={!!sheet}
      />
      <Timeline
        onEdit={() => {
          setInspectorTab('properties')
          if (innerWidth <= 900) setSheet('right')
        }}
      />
      <ActionDialogHost />
      <StatusBar />

      {!kernelReady && (
        <div className="overlay-centre">
          <div>
            <div style={{ fontSize: 18, marginBottom: 6 }}>
              Open<span style={{ color: 'var(--accent)' }}>Kit</span>CAD
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>
              Starting the geometry engine…
              <br />
              <span style={{ color: 'var(--text-faint)' }}>
                About 11 MB, and only the first time.
              </span>
            </div>
          </div>
        </div>
      )}

      {activeSketch && <SketchBanner />}
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}

function SketchBanner() {
  const tool = useStore((s) => s.tool)
  const units = useStore((s) => s.doc.units)
  const sketch = activeSketchFeature(useStore.getState())
  const help: Record<string, string> = {
    select:
      'Drag a corner to move it. Select geometry to see available actions in the right panel.',
    line: 'Click for each corner. Right-click or Escape to stop the chain.',
    rectangle: 'Click one corner, then the opposite one.',
    circle: 'Click the centre, then click to set how big.',
    arc: 'Click the centre, then the start, then the end.',
    dimension: 'Click a line or a circle, then type the size you want.',
  }
  return (
    <div className="sketch-banner">
      <strong>
        Drawing on {sketch ? planeLabel(sketch.plane, units).toLowerCase() : 'a plane'}
      </strong>
      <span style={{ color: 'var(--text-faint)' }}>{help[tool]}</span>
    </div>
  )
}

function StatusBar() {
  const building = useStore((s) => s.building)
  const buildMs = useStore((s) => s.buildMs)
  const instances = useStore((s) => s.instances)
  const meshes = useStore((s) => s.meshes)
  const errors = useStore((s) => s.errors)
  const units = useStore((s) => s.doc.units)
  const status = useStore((s) => s.statusMessage)
  const showPlacements = useStore((s) => s.showPlacements)
  const showFasteners = useStore((s) => s.showFasteners)

  const shapes = instances.filter((instance) => instance.visible)
  const triangles = shapes.reduce(
    (n, instance) => n + (meshes.get(instance.meshKey)?.mesh.triangles.length ?? 0) / 3,
    0,
  )
  const failures = errors.filter((error) => error.severity === 'error')

  return (
    <div className="statusbar">
      <span className="engine-state" title={`Last rebuild: ${buildMs} ms`}>
        {building ? 'Updating geometry…' : '● Ready'}
      </span>
      <span>
        {shapes.length} shape{shapes.length === 1 ? '' : 's'}
      </span>
      <span className="mesh-stat">{triangles.toLocaleString()} triangles</span>
      {failures.length > 0 && (
        <span style={{ color: 'var(--err)' }}>
          {failures.length} step{failures.length === 1 ? '' : 's'} need attention
        </span>
      )}
      {status && <span style={{ color: 'var(--warn)' }}>{status}</span>}
      <span className="spacer" />
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showPlacements}
          onChange={(e) => useStore.getState().setShowPlacements(e.target.checked)}
        />
        Show catalogue parts
      </label>
      <label className="status-toggle">
        <input
          type="checkbox"
          checked={showFasteners}
          onChange={(e) => useStore.getState().setShowFasteners(e.target.checked)}
        />
        Show screws
      </label>
      <span>{UNIT_NAME[units].toLowerCase()}</span>
    </div>
  )
}
