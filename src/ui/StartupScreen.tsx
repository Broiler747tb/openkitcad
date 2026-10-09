import { useEffect, useState } from 'react'
import { t } from '../i18n'
import './startup.css'

export function StartupScreen({ ready, error }: { ready: boolean; error: string | null }) {
  const [visible, setVisible] = useState(!ready)
  useEffect(() => {
    if (!ready) {
      setVisible(true)
      return
    }
    const timer = setTimeout(() => setVisible(false), 240)
    return () => clearTimeout(timer)
  }, [ready])
  if (!visible) return null
  return (
    <div className={`startup-screen${ready ? ' is-ready' : ''}${error ? ' has-error' : ''}`}>
      <div className="startup-content">
        <svg className="startup-mark" viewBox="0 0 120 120" fill="none" aria-hidden="true">
          <path
            className="startup-guide"
            d="M10 88 60 117 110 88 60 59ZM10 88V32L60 3l50 29v56M60 59V3"
          />
          <g className="startup-cube">
            <path d="m60 24 32 18-32 19-32-19Z" fill="var(--okc-surface-panel)" />
            <path d="M28 42v36l32 19V61Z" fill="var(--okc-surface-sunken)" />
            <path d="m60 61 32-19v36L60 97Z" fill="var(--okc-surface-header)" />
            <path
              className="startup-outline"
              d="m60 24 32 18v36L60 97 28 78V42Zm-32 18 32 19 32-19M60 61v36"
            />
            <path
              className="startup-trace"
              d="m28 78 32 19 32-19V42L60 24 28 42v36m0-36 32 19 32-19M60 61v36"
            />
          </g>
        </svg>
        <h1>
          OpenKit<span>CAD</span>
        </h1>
        <div className="startup-status" role={error ? 'alert' : 'status'} aria-live="polite">
          <p className="startup-label">
            {t(error ? 'Could not start CAD' : 'Starting the geometry engine…')}
          </p>
          <p className="startup-hint">{t(error ?? 'First launch can take a little longer.')}</p>
        </div>
        {error ? (
          <button className="startup-retry" onClick={() => location.reload()}>
            {t('Try again')}
          </button>
        ) : (
          <div className="startup-track" aria-hidden="true">
            <span />
          </div>
        )}
      </div>
    </div>
  )
}
