import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../doc/store'
import { findBody, findOccurrence } from '../doc/model'
import { EXPORT_FORMATS, exportShapes } from '../export'
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
  const building = useStore((s) => s.building)
  const errors = useStore((s) => s.errors)
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
  const [targets, setTargets] = useState<string[]>(
    preferred ? [preferred.id] : bodies.map((body) => body.id),
  )
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = bodies.filter((instance) => targets.includes(instance.id))
  const ready = !building && !errors.some((error) => error.severity === 'error')

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
              <fieldset className="export-bodies">
                <legend>{t('Bodies to export')}</legend>
                <button
                  className="tb"
                  disabled={busy !== null}
                  onClick={() => setTargets(bodies.map((body) => body.id))}
                >
                  {t('Select all')}
                </button>
                <button className="tb" disabled={busy !== null} onClick={() => setTargets([])}>
                  {t('Clear selection')}
                </button>
                {bodies.map((instance) => (
                  <label key={instance.id}>
                    <input
                      type="checkbox"
                      disabled={busy !== null}
                      checked={targets.includes(instance.id)}
                      onChange={(event) =>
                        setTargets((ids) =>
                          event.target.checked
                            ? [...ids, instance.id]
                            : ids.filter((id) => id !== instance.id),
                        )
                      }
                    />
                    {instanceLabel(doc, instance)}
                  </label>
                ))}
              </fieldset>
            )}
            {chosen.length > 1 && (
              <p className="hint">
                {t(
                  '3MF and STEP keep the selected bodies together. Other formats download a ZIP with one file per body. Assembly positions are preserved.',
                )}
              </p>
            )}
            {!ready && (
              <p role="alert" className="hint">
                {t(
                  building
                    ? 'Wait for the model to rebuild.'
                    : 'Fix the failed steps before exporting.',
                )}
              </p>
            )}

            {EXPORT_FORMATS.map((format) => (
              <button
                key={format.id}
                className="btn"
                disabled={busy !== null || !chosen.length || !ready}
                onClick={async () => {
                  if (!chosen.length) return
                  setBusy(format.id)
                  setError(null)
                  try {
                    await exportShapes(
                      format.id,
                      chosen.map((instance) => ({
                        id: instance.id,
                        name: instanceLabel(doc, instance),
                      })),
                    )
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === format.id ? t('Preparing {0}…', t(format.label)) : t(format.label)}
                <small>{t(format.detail)}</small>
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
