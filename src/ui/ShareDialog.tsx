import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../doc/store'
import { createShareLink } from '../doc/share'
import { saveDocument } from '../doc/persist'

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const [doc] = useState(() => useStore.getState().doc)
  const [result] = useState(() => {
    try {
      return { link: createShareLink(doc), error: '' }
    } catch (error) {
      return { link: '', error: (error as Error).message }
    }
  })
  const [notice, setNotice] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="action-dialog share-dialog"
      aria-label={t('Share model')}
      onCancel={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div>
        <h2>
          {t('Share ')}
          {doc.name}
        </h2>
        <p className="sub">
          {t(
            'A snapshot inside a link. Nothing is uploaded. Anyone with the link can view it, download it or edit their own copy.',
          )}
        </p>
        {result.link ? (
          <>
            <label htmlFor="share-link">{t('Model link')}</label>
            <textarea
              id="share-link"
              ref={field}
              readOnly
              value={result.link}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="sub">
              {result.link.length.toLocaleString()}
              {t(
                " characters. Some messengers may shorten long links. Edits you make later won't change this snapshot.",
              )}
            </p>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.link)
                  setNotice('Link copied.')
                } catch {
                  field.current?.focus()
                  field.current?.select()
                  setNotice('Select and copy the link above.')
                }
              }}
            >
              {t('Copy link')}
            </button>
          </>
        ) : (
          <p className="msg info">{t(result.error)}</p>
        )}
        <p role="status">{t(notice)}</p>
        <div className="dialog-footer">
          <button className="btn" onClick={() => void saveDocument(doc)}>
            {t('Save .okc file')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </dialog>
  )
}
