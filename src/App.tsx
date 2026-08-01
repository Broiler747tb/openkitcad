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
import { loadAutosave, readShareLink, scheduleAutosave } from './doc/persist'
import { planeLabel } from './doc/planes'
import { activeSketchFeature } from './doc/store'

export function App() {
  const [showExport, setShowExport] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const kernelReady = useStore((s) => s.kernelReady)
  const doc = useStore((s) => s.doc)
  const activeSketch = useStore((s) => s.activeSketch)

  // Boot the kernel, then restore whatever the user was last working on.
  useEffect(() => {
    let cancelled = false
    kernel()
      .ready()
      .then(() => {
        if (cancelled) return
        useStore.getState().setKernelReady(true)

        const shared = readShareLink()
        if (shared) {
          useStore.getState().setDoc(shared)
          history.replaceState(null, '', location.pathname)
          return
        }
        const saved = loadAutosave()
        if (saved && (saved.doc.bodies.length || saved.doc.placements.length)) {
          useStore.getState().setDoc(saved.doc)
          return
        }
        setShowTutorial(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    scheduleAutosave(doc)
  }, [doc])

  return (
    <div className={`app ${activeSketch ? 'sketching' : ''}`}>
      <Toolbar onExport={() => setShowExport(true)} onTutorial={() => setShowTutorial(true)} />
      <LeftPanel />
      <div className="viewport-wrap" style={{ display: 'contents' }}>
        <Viewport />
        <BuildProgress />
      </div>
      <Inspector />
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
  const sketch = activeSketchFeature(useStore.getState())
  const help: Record<string, string> = {
    select:
      'Drag a corner to move it. Click something and right-click for what you can do to it.',
    line: 'Click for each corner. Right-click or Escape to stop the chain.',
    rectangle: 'Click one corner, then the opposite one.',
    circle: 'Click the centre, then click to set how big.',
    arc: 'Click the centre, then the start, then the end.',
    dimension: 'Click a line or a circle, then type the size you want.',
  }
  return (
    <div className="sketch-banner">
      <strong>Drawing on {sketch ? planeLabel(sketch.plane).toLowerCase() : 'a plane'}</strong>
      <span style={{ color: 'var(--text-faint)' }}>{help[tool]}</span>
      <button className="tb" onClick={() => useStore.getState().closeSketch()}>
        Done
      </button>
    </div>
  )
}

function StatusBar() {
  const building = useStore((s) => s.building)
  const buildMs = useStore((s) => s.buildMs)
  const shapes = useStore((s) => s.shapes)
  const errors = useStore((s) => s.errors)
  const status = useStore((s) => s.statusMessage)
  const showPlacements = useStore((s) => s.showPlacements)

  const triangles = shapes.reduce((n, s) => n + s.mesh.triangles.length / 3, 0)

  return (
    <div className="statusbar">
      <span>{building ? 'Rebuilding…' : `Built in ${buildMs} ms`}</span>
      <span>
        {shapes.length} shape{shapes.length === 1 ? '' : 's'}
      </span>
      <span>{triangles.toLocaleString()} triangles</span>
      {errors.length > 0 && (
        <span style={{ color: 'var(--err)' }}>
          {errors.length} step{errors.length === 1 ? '' : 's'} need attention
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
      <span>millimetres</span>
    </div>
  )
}
