import { t } from '../i18n'
import { LanguagePicker } from './LanguagePicker'
import { useEffect, useRef, useState } from 'react'
import { readSharedSnapshot } from '../doc/share'
import { downloadBlob, parseDesign, setAsideAutosave } from '../doc/persist'
import { bootOnce } from '../doc/boot'
import { replaceDesign } from '../doc/open'
import { findBody, findComponent } from '../doc/model'
import { usePreferences } from '../doc/preferences'
import { kernel } from '../kernel/api'
import { ViewportEngine } from '../viewport/engine'
import { lookPrototype } from '../viewport/partLook'
import { CATALOGUE } from '../catalogue'
import { effectivePart } from '../catalogue/placement'
import { useStore } from '../doc/store'
import { MOUSE_SCHEMES } from './mouse/schemes'
import { CATEGORY_COLOUR } from '../catalogue/types'
import { readPalette } from '../theme/palette'
import { ConfirmHost } from './Confirm'
import { BrandMark } from './BrandMark'
import type { Instance } from '../kernel/types'

export function SharedModelView({ hash, onOpen }: { hash: string; onOpen: () => void }) {
  const [snapshot] = useState(() => {
    try {
      return { doc: readSharedSnapshot(hash), error: '' }
    } catch (error) {
      return { doc: null, error: (error as Error).message }
    }
  })
  const mount = useRef<HTMLDivElement>(null)
  const engine = useRef<ViewportEngine | null>(null)
  const [loading, setLoading] = useState(!!snapshot.doc)
  const [error, setError] = useState(snapshot.error)
  const [warning, setWarning] = useState('')
  const [opening, setOpening] = useState(false)
  const doc = snapshot.doc
  useEffect(() => {
    if (!mount.current || !doc) return
    let active = true
    let view: ViewportEngine
    try {
      view = new ViewportEngine(mount.current)
      engine.current = view
      view.setPalette(readPalette())
      view.setGridPreferences(usePreferences.getState().values, null)
      view.setFingerNavigation(true)
      view.setMouseScheme({
        ...MOUSE_SCHEMES.tinkercad,
        drag: [
          { buttons: ['left'], modifiers: [], action: 'orbit' },
          ...MOUSE_SCHEMES.tinkercad.drag,
        ],
      })
    } catch (error) {
      setError((error as Error).message)
      setLoading(false)
      return
    }
    const observer = new ResizeObserver(() => view.resize())
    observer.observe(mount.current)
    const parts = new Map([...CATALOGUE, ...(doc.customParts ?? [])].map((part) => [part.id, part]))
    const partOf = (instance: Instance) => {
      const source = findComponent(doc, instance.componentId)?.source
      const part = source?.kind === 'catalogue' ? parts.get(source.partId) : undefined
      return part && source?.kind === 'catalogue' ? effectivePart(part, source) : undefined
    }
    void (async () => {
      try {
        await kernel().ready()
        if (!active) return
        const result = await kernel().evaluate(doc, [])
        if (!active) return
        view.setScene(
          result.instances,
          new Map(result.meshes.map((mesh) => [mesh.key, mesh])),
          (instance) => {
            const part = partOf(instance)
            return part
              ? CATEGORY_COLOUR[part.category]
              : (findBody(doc, instance.bodyId)?.body.colour ?? '#90a4ae')
          },
          true,
          (instance) => {
            const part = instance.kind === 'catalogue' ? partOf(instance) : undefined
            return part ? lookPrototype(part) : null
          },
        )
        view.frameAll()
        const failures = result.errors.filter((failure) => failure.severity === 'error')
        if (failures.length)
          setWarning(
            `${failures.length} model step(s) could not be built. The .okc download still contains the full design.`,
          )
        else if (!result.instances.some((instance) => instance.visible))
          setWarning(
            'No visible 3D shapes in this snapshot. Open a copy to see the sketches and timeline.',
          )
        setLoading(false)
      } catch (error) {
        if (active) {
          setError((error as Error).message)
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
      observer.disconnect()
      view.dispose()
      engine.current = null
    }
  }, [doc])
  return (
    <div className="shared-view">
      <header className="shared-header">
        <span className="brand">
          <BrandMark size={26} />
          OpenKitCAD
        </span>
        <div className="shared-title">
          <strong>{doc?.name ?? t('Shared model')}</strong>
          <span>{t('View only')}</span>
        </div>
        <div className="shared-actions">
          <LanguagePicker />
          <button
            className="btn"
            disabled={!doc}
            onClick={() => {
              if (doc)
                downloadBlob(
                  new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
                  (doc.name.replace(/[^\w\-. ]+/g, '_').trim() || 'design') + '.okc',
                )
            }}
          >
            {t('Download .okc')}
          </button>
          <button
            className="btn primary"
            disabled={!doc || loading || opening}
            onClick={async () => {
              if (!doc) return
              setOpening(true)
              try {
                await bootOnce(true)
                if (!useStore.getState().kernelReady)
                  throw new Error(
                    useStore.getState().kernelError ?? 'The geometry engine could not start.',
                  )
                if (await replaceDesign(parseDesign(JSON.stringify(doc)))) {
                  setAsideAutosave()
                  history.replaceState(null, '', location.pathname + location.search)
                  onOpen()
                }
              } catch (error) {
                setError((error as Error).message)
              } finally {
                setOpening(false)
              }
            }}
          >
            {opening ? t('Opening…') : t('Open a copy')}
          </button>
        </div>
      </header>
      <div className="shared-canvas" ref={mount} aria-label={t('Shared model 3D view')} />
      {(loading || error) && (
        <div className="shared-message" role="status">
          {t(error || 'Building the model…')}
          {error && (
            <p>
              <button
                className="btn"
                onClick={() => {
                  history.replaceState(null, '', location.pathname + location.search)
                  onOpen()
                }}
              >
                {t('Back to CAD')}
              </button>
            </p>
          )}
        </div>
      )}
      <footer className="shared-footer">
        <span>
          {t(
            warning ||
              'Drag to orbit · Scroll to zoom. Viewing this model does not replace your work.',
          )}
        </span>
        <button
          className="btn"
          disabled={loading || !doc}
          onClick={() => engine.current?.frameAll()}
        >
          {t('Fit view')}
        </button>
      </footer>
      <ConfirmHost />
    </div>
  )
}
