import { useState } from 'react'
import { activeSketchFeature, newId, useStore, type ToolId } from '../doc/store'
import { emptyDocument } from '../doc/types'
import {
  makeShareLink,
  openDocument,
  saveDocument,
} from '../doc/persist'
import { sketchLoopSummary } from '../kernel/profile'

const SKETCH_TOOLS: Array<{ id: ToolId; label: string; key: string; help: string }> = [
  { id: 'select', label: 'Pick', key: 'S', help: 'Select and drag corners' },
  { id: 'line', label: 'Line', key: 'L', help: 'Draw connected straight lines' },
  { id: 'rectangle', label: 'Rectangle', key: 'R', help: 'Draw a rectangle' },
  { id: 'circle', label: 'Circle', key: 'C', help: 'Draw a circle from its centre' },
  { id: 'arc', label: 'Arc', key: 'A', help: 'Centre, then start, then end' },
  { id: 'dimension', label: 'Size', key: 'D', help: 'Click a line or circle and type its size' },
]

export function Toolbar({ onExport, onTutorial }: { onExport: () => void; onTutorial: () => void }) {
  const doc = useStore((s) => s.doc)
  const tool = useStore((s) => s.tool)
  const activeSketch = useStore((s) => s.activeSketch)
  const past = useStore((s) => s.past)
  const future = useStore((s) => s.future)
  const [shared, setShared] = useState(false)

  // Loop analysis only - building the actual profile needs OpenCascade, which
  // lives in the worker and is not available on this thread.
  const sketchFeature = activeSketchFeature(useStore.getState())
  const summary = sketchFeature ? sketchLoopSummary(sketchFeature.sketch) : null
  const canExtrude = (summary?.closedLoops ?? 0) > 0

  if (activeSketch) {
    return (
      <div className="topbar">
        <span className="brand">
          Open<span>Kit</span>CAD
        </span>
        <span className="tb-sep" />
        {SKETCH_TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tb ${tool === t.id ? 'active' : ''}`}
            onClick={() => useStore.getState().setTool(t.id)}
            title={`${t.help}  (${t.key})`}
          >
            {t.label}
          </button>
        ))}
        <span className="tb-sep" />
        <button
          className="tb"
          disabled={!canExtrude}
          title={
            canExtrude
              ? 'Turn this sketch into a solid'
              : 'Draw a closed shape first - the outline has to join up'
          }
          onClick={() => {
            const store = useStore.getState()
            const active = store.activeSketch
            if (!active) return
            store.addFeature(active.bodyId, {
              id: newId('extrude'),
              kind: 'extrude',
              name: 'Extrude',
              sketchId: active.featureId,
              distance: 3,
              symmetric: false,
              reverse: false,
              operation: store.doc.bodies.find((b) => b.id === active.bodyId)?.features
                .some((f) => f.kind !== 'sketch')
                ? 'add'
                : 'new',
            })
            store.closeSketch()
            window.dispatchEvent(new CustomEvent('okc:fit'))
          }}
        >
          Make solid
        </button>
        <button className="tb" onClick={() => useStore.getState().closeSketch()}>
          Done
        </button>
        <span className="spacer" />
        <SketchStatus />
      </div>
    )
  }

  return (
    <div className="topbar">
      <span className="brand">
        Open<span>Kit</span>CAD
      </span>
      <span className="tb-sep" />

      <button
        className="tb"
        onClick={() => {
          if (doc.bodies.length && !confirm('Start a new design? Anything unsaved is lost.')) return
          useStore.getState().setDoc(emptyDocument())
        }}
      >
        New
      </button>
      <button
        className="tb"
        onClick={async () => {
          const opened = await openDocument()
          if (opened) useStore.getState().setDoc(opened)
        }}
      >
        Open
      </button>
      <button className="tb" onClick={() => saveDocument(doc)}>
        Save
      </button>
      <button
        className="tb"
        title="Copy a link containing the whole design. Nothing is uploaded anywhere."
        onClick={async () => {
          const link = makeShareLink(doc)
          try {
            await navigator.clipboard.writeText(link)
            setShared(true)
            setTimeout(() => setShared(false), 2200)
          } catch {
            prompt('Copy this link:', link)
          }
        }}
      >
        {shared ? 'Link copied' : 'Share'}
      </button>

      <span className="tb-sep" />
      <button className="tb" disabled={!past.length} onClick={() => useStore.getState().undo()} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button className="tb" disabled={!future.length} onClick={() => useStore.getState().redo()} title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>

      <span className="tb-sep" />
      <button
        className="tb active"
        onClick={() =>
          useStore.getState().startSketch({ kind: 'named', name: 'XY', offset: 0 })
        }
        title="Start drawing a shape on the top plane"
      >
        New sketch
      </button>

      <span className="tb-sep" />
      <GizmoButtons />

      <span className="tb-sep" />
      <button className="tb" onClick={() => window.dispatchEvent(new CustomEvent('okc:fit'))} title="Zoom to fit everything">
        Fit
      </button>
      <button className="tb" onClick={onExport} title="Save geometry for printing, cutting or another CAD package">
        Export
      </button>

      <span className="spacer" />
      <button className="tb" onClick={onTutorial} title="Walk through making your first part">
        Guide
      </button>
    </div>
  )
}

/** Move / turn, shown greyed until a catalogue part is picked. */
function GizmoButtons() {
  const mode = useStore((s) => s.gizmoMode)
  const selection = useStore((s) => s.selection)
  const armed = selection.kind === 'placement'
  const title = armed
    ? undefined
    : 'Select a part from the catalogue first, then drag the arrows'
  return (
    <>
      <button
        className={`tb ${armed && mode === 'translate' ? 'active' : ''}`}
        disabled={!armed}
        title={title ?? 'Drag the arrows to move it. Snaps to 1 mm.'}
        onClick={() => useStore.getState().setGizmoMode('translate')}
      >
        Move
      </button>
      <button
        className={`tb ${armed && mode === 'rotate' ? 'active' : ''}`}
        disabled={!armed}
        title={title ?? 'Drag the ring to turn it. Snaps to 15 degrees.'}
        onClick={() => useStore.getState().setGizmoMode('rotate')}
      >
        Turn
      </button>
    </>
  )
}

function SketchStatus() {
  const status = useStore((s) => s.sketchStatus)
  if (!status) return <span className="pill">Draw something to begin</span>
  if (status.failing.length) {
    return <span className="pill err">Some sizes contradict each other</span>
  }
  if (status.dof === 0) {
    return <span className="pill ok">Fully defined</span>
  }
  return (
    <span className="pill warn">
      {status.dof} thing{status.dof === 1 ? '' : 's'} can still move
    </span>
  )
}
