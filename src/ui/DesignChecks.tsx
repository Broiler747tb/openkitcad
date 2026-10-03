import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../doc/store'
import { kernel } from '../kernel/api'
import type { Clash, Instance, KernelApi, PrintWarning } from '../kernel/types'
import type { OkcDocument } from '../doc/types'
import { lengthLabel } from '../core/units'
import { NumberInput } from './NumberInput'
import { loadPrintSettings, savePrintSettings, validPrintSettings } from './printSettings'
import type { PrintOptions } from '../kernel/types'

type CheckKind = 'clashes' | 'print'
type CheckResult = { doc: OkcDocument; instances: Instance[] } & (
  | { kind: 'clashes'; value: Clash[] }
  | { kind: 'print'; value: PrintWarning[] }
  | { kind: 'error'; value: string }
)

export function DesignChecks({
  api = kernel,
}: {
  api?: () => Pick<KernelApi, 'clearance' | 'printPrep'>
}) {
  const section = useStore((s) => s.section)
  const instances = useStore((s) => s.instances)
  const doc = useStore((s) => s.doc)
  const building = useStore((s) => s.building)
  const kernelReady = useStore((s) => s.kernelReady)
  const errors = useStore((s) => s.errors)
  const store = useStore.getState()
  const [result, setResult] = useState<CheckResult | null>(null)
  const [busy, setBusy] = useState<CheckKind | null>(null)
  const ticket = useRef(0)
  const [settings, setSettings] = useState(loadPrintSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  function configure(next: PrintOptions) {
    if (!validPrintSettings(next)) return
    settingsRef.current = next
    setSettings(next)
    savePrintSettings(next)
    setResult(null)
  }
  const ready = kernelReady && !building && !errors.some((error) => error.severity === 'error')
  const printable = instances.filter((i) => i.kind === 'body' && i.visible && !i.negative)
  const current = ready && result?.doc === doc && result.instances === instances ? result : null
  const clashes = current?.kind === 'clashes' ? current.value : null
  const warnings = current?.kind === 'print' ? current.value : null

  useEffect(() => {
    setResult(null)
  }, [doc, instances])
  useEffect(
    () => () => {
      ticket.current++
    },
    [],
  )

  async function run(kind: CheckKind): Promise<void> {
    if (busy || !ready || (kind === 'print' && !printable.length)) return
    const snapshot = useStore.getState()
    const request = ++ticket.current
    const checkedSettings = settings
    const isCurrent = () => {
      const live = useStore.getState()
      return (
        request === ticket.current &&
        (kind !== 'print' || settingsRef.current === checkedSettings) &&
        live.doc === snapshot.doc &&
        live.instances === snapshot.instances &&
        !live.building
      )
    }
    setBusy(kind)
    setResult(null)
    try {
      const next: CheckResult =
        kind === 'clashes'
          ? { doc, instances, kind, value: await api().clearance(doc) }
          : {
              doc,
              instances,
              kind,
              value: await api().printPrep(
                printable.map((i) => i.id),
                checkedSettings,
              ),
            }
      if (isCurrent()) setResult(next)
    } catch (error) {
      if (isCurrent())
        setResult({
          doc,
          instances,
          kind: 'error',
          value: error instanceof Error ? error.message : String(error),
        })
    } finally {
      if (request === ticket.current) setBusy(null)
    }
  }

  return (
    <>
      <div className="section">
        <h3>{t('Look inside')}</h3>
        <div className="row">
          <label>{t('Cut away')}</label>
          <input
            type="checkbox"
            checked={section.enabled}
            onChange={(e) => store.setSection({ enabled: e.target.checked })}
          />
        </div>
        {section.enabled && (
          <>
            <div className="row">
              <label>{t('Direction')}</label>
              <select
                value={section.axis}
                onChange={(e) => store.setSection({ axis: e.target.value as 'x' | 'y' | 'z' })}
              >
                <option value="x">{t('Left to right')}</option>
                <option value="y">{t('Front to back')}</option>
                <option value="z">{t('Top to bottom')}</option>
              </select>
            </div>
            <NumberInput
              label={t('Position')}
              value={section.position}
              step={1}
              onChange={(v) => store.setSection({ position: v })}
            />
            <div className="row">
              <label>{t('Other side')}</label>
              <input
                type="checkbox"
                checked={section.flipped}
                onChange={(e) => store.setSection({ flipped: e.target.checked })}
              />
            </div>
          </>
        )}
      </div>

      <div className="section">
        <h3>{t('Check the design')}</h3>
        <details className="print-settings">
          <summary>{t('Printer settings')}</summary>
          <NumberInput
            label="Nozzle diameter"
            value={settings.nozzle}
            min={0.05}
            onChange={(nozzle) => configure({ ...settings, nozzle })}
          />
          {(['Bed width', 'Bed depth', 'Maximum print height'] as const).map((label, index) => (
            <NumberInput
              key={label}
              label={label}
              value={settings.bed[index]}
              min={1}
              onChange={(size) => {
                const bed = [...settings.bed] as PrintOptions['bed']
                bed[index] = size
                configure({ ...settings, bed })
              }}
            />
          ))}
          <p className="hint">
            {t('Checks use the current orientation. These settings stay on this device.')}
          </p>
        </details>
        <button
          className="btn"
          disabled={busy !== null || !ready}
          onClick={() => void run('clashes')}
        >
          {busy === 'clashes' ? t('Checking for clashes…') : t('Check for clashes')}
          <small>{t("Does anything overlap something it shouldn't?")}</small>
        </button>

        <button
          className="btn"
          disabled={busy !== null || !ready || printable.length === 0}
          onClick={() => void run('print')}
        >
          {busy === 'print' ? t('Checking printability…') : t('Check it will print')}
          <small>{t('Overhangs, thin walls, and whether it fits the bed')}</small>
        </button>

        {current?.kind === 'error' && (
          <div className="msg error">
            {t('Could not check the design: ')}
            {t(current.value)}
          </div>
        )}
        {clashes?.length === 0 && (
          <div className="msg info">{t('Nothing overlaps. All clear.')}</div>
        )}
        {clashes?.map((c, i) => (
          <div className="msg warn" key={i}>
            <strong>
              {c.aLabel}
              {t(' runs into ')}
              {c.bLabel}
            </strong>
            <em>
              {t('Overlapping by roughly ')}
              {lengthLabel(c.overlap, doc.units)}.
            </em>
          </div>
        ))}

        {warnings?.length === 0 && (
          <div className="msg info">{t('No printing problems spotted.')}</div>
        )}
        {warnings?.map((w, i) => (
          <div className={`msg ${w.severity === 'error' ? 'error' : 'warn'}`} key={i}>
            <button
              className="tb msg-action"
              onClick={() => {
                const instance = instances.find((item) => item.id === w.instanceId)
                if (instance)
                  store.select({ kind: 'body', id: instance.bodyId, instanceId: instance.id })
              }}
            >
              {w.name}
            </button>
            <strong>{t(w.message)}</strong>
            {w.hint && <em>{t(w.hint)}</em>}
            {w.span && (
              <button
                className="tb msg-action"
                onClick={() => {
                  const span = w.span!
                  store.clearMeasure()
                  store.addMeasurePoint(span.from)
                  store.addMeasurePoint(span.to)
                }}
              >
                {t('Show')}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
