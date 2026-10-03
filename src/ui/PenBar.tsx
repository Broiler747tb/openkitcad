import { t } from '../i18n'
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
    <div className="pen-bar" aria-label={t('S Pen controls')}>
      <button onClick={onComponents}>{t('Components')}</button>
      <button onClick={onDetails}>{t('Details')}</button>
      {panelOpen && <button onClick={onClosePanel}>{t('Close panel')}</button>}
      <select
        aria-label={t('Screen orientation')}
        value={orientation}
        onChange={(e) => {
          setOrientation(e.target.value)
          window.OpenKitAndroid?.setOrientation?.(e.target.value)
        }}
      >
        <option value="auto">{t('Auto rotate')}</option>
        <option value="landscape">{t('Landscape')}</option>
        <option value="portrait">{t('Portrait')}</option>
      </select>
      <button aria-pressed={fingerMode === 'pan'} onClick={() => setFingerMode('pan')}>
        {t('Finger: pan')}
      </button>
      <button
        aria-pressed={fingerMode === 'orbit'}
        disabled={!!state.activeSketch}
        onClick={() => setFingerMode('orbit')}
      >
        {t('Finger: orbit')}
      </button>
      <button disabled={!state.past.length} onClick={() => state.undo()}>
        {t('↶ Undo')}
      </button>
      <button disabled={!state.future.length} onClick={() => state.redo()}>
        {t('↷ Redo')}
      </button>
      <button onClick={() => window.dispatchEvent(new Event('okc:cancel'))}>
        {t('Cancel tool')}
      </button>
    </div>
  )
}
