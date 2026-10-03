import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../doc/store'
import { findBody, findOccurrence } from '../doc/model'
import { EXPORT_FORMATS, exportShape } from '../export'
import type { ExportFormat, Instance } from '../kernel/types'
import type { OkcDocument } from '../doc/types'

function instanceLabel(doc: OkcDocument, instance: Instance): string {
  const body = findBody(doc, instance.bodyId)?.body.name ?? instance.bodyId
  const path = instance.path.map((id) => findOccurrence(doc, id)?.name ?? id)
  return [...path, body].join(' / ')
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const doc = useStore((s) => s.doc)
  const instances = useStore((s) => s.instances)
  const selection = useStore((s) => s.selection)
  const bodies = instances.filter(
    (instance) => instance.kind === 'body' && instance.visible && !instance.negative,
  )
  const preferred =
    bodies.find((instance) => instance.id === selection.instanceId) ??
    bodies.find(
      (instance) =>
        (selection.kind === 'body' || selection.kind === 'face' || selection.kind === 'edge') &&
        instance.bodyId === selection.id,
    ) ??
    bodies.find(
      (instance) =>
        selection.kind === 'occurrence' && !!selection.id && instance.path.includes(selection.id),
    )
  const [target, setTarget] = useState(preferred?.id ?? bodies[0]?.id ?? '')
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = bodies.find((instance) => instance.id === target)

  return (
    <dialog
      ref={dialog}
      className="action-dialog"
      onCancel={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={t('Export design')}
    >
      <div>
        <h2>{t('Export')}</h2>
        <p className="sub">{t('Everything happens in your browser. Nothing is uploaded.')}</p>

        {bodies.length === 0 ? (
          <div className="msg info">
            {t('Create a solid in the Create toolbar, or draw a closed sketch and choose Extrude.')}
          </div>
        ) : (
          <>
            {bodies.length > 1 && (
              <div className="row" style={{ marginBottom: 14 }}>
                <label>{t('Which body')}</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {bodies.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instanceLabel(doc, instance)}
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
                    await exportShape(format.id, {
                      id: chosen.id,
                      name: instanceLabel(doc, chosen),
                    })
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === format.id ? t('Preparing {0}…', t(format.label)) : t(format.label)}
                <small>{format.detail}</small>
              </button>
            ))}

            {error && <div className="msg error">{t(error)}</div>}

            <p className="hint">
              {t(
                'DXF, SVG and the drill template are flattened looking straight down at the body in its assembly position, so lay the face you want to cut flat before exporting.',
              )}
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="tb" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </dialog>
  )
}
