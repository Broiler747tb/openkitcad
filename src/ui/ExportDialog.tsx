import { useState } from 'react'
import { useStore } from '../doc/store'
import { EXPORT_FORMATS, exportShape } from '../export'
import type { ExportFormat } from '../kernel/types'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const shapes = useStore((s) => s.shapes)
  const selection = useStore((s) => s.selection)
  const bodies = shapes.filter((s) => s.kind === 'body')
  const [target, setTarget] = useState(
    bodies.find((b) => b.id === selection.id)?.id ?? bodies[0]?.id ?? '',
  )
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = bodies.find((b) => b.id === target)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>
        <p className="sub">Everything happens in your browser. Nothing is uploaded.</p>

        {bodies.length === 0 ? (
          <div className="msg info">
            There is nothing solid to export yet. Draw a sketch and press Make solid first.
          </div>
        ) : (
          <>
            {bodies.length > 1 && (
              <div className="row" style={{ marginBottom: 14 }}>
                <label>Which part</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {bodies.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {EXPORT_FORMATS.map((format) => (
              <button
                key={format.id}
                className="btn"
                disabled={busy !== null}
                onClick={async () => {
                  if (!chosen) return
                  setBusy(format.id)
                  setError(null)
                  try {
                    await exportShape(format.id, { id: chosen.id, name: chosen.name })
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === format.id ? `Preparing ${format.label}…` : format.label}
                <small>{format.detail}</small>
              </button>
            ))}

            {error && <div className="msg error">{error}</div>}

            <p className="hint">
              DXF, SVG and the drill template are flattened looking straight down at the part, so
              lay the face you want to cut flat before exporting.
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="tb" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
