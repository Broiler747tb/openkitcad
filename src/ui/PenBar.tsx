import { isAndroidApp, usePenMode } from '../platform/android'
import { useStore } from '../doc/store'
import { useState } from 'react'

export function PenBar({
  onComponents,
  onDetails,
  onClosePanel,
  panelOpen,
}: {
  onComponents: () => void
  onDetails: () => void
  onClosePanel: () => void
  panelOpen: boolean
}) {
  const state = useStore(),
    { fingerMode, setFingerMode } = usePenMode()
  const [orientation, setOrientation] = useState(
    () => window.OpenKitAndroid?.getOrientation?.() ?? 'auto',
  )
  if (!isAndroidApp) return null
  return (
    <div className="pen-bar" aria-label="S Pen controls">
      <button onClick={onComponents}>Components</button>
      <button onClick={onDetails}>Details</button>
      {panelOpen && <button onClick={onClosePanel}>Close panel</button>}
      <select
        aria-label="Screen orientation"
        value={orientation}
        onChange={(e) => {
          setOrientation(e.target.value)
          window.OpenKitAndroid?.setOrientation?.(e.target.value)
        }}
      >
        <option value="auto">Auto rotate</option>
        <option value="landscape">Landscape</option>
        <option value="portrait">Portrait</option>
      </select>
      <button aria-pressed={fingerMode === 'pan'} onClick={() => setFingerMode('pan')}>
        Finger: pan
      </button>
      <button
        aria-pressed={fingerMode === 'orbit'}
        disabled={!!state.activeSketch}
        onClick={() => setFingerMode('orbit')}
      >
        Finger: orbit
      </button>
      <button disabled={!state.past.length} onClick={() => state.undo()}>
        ↶ Undo
      </button>
      <button disabled={!state.future.length} onClick={() => state.redo()}>
        ↷ Redo
      </button>
      <button onClick={() => window.dispatchEvent(new Event('okc:cancel'))}>Cancel tool</button>
    </div>
  )
}
