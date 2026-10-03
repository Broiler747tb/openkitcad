import { useStore } from '../doc/store'
import { lengthLabel } from '../core/units'
import { t } from '../i18n'

export function MeasurePanel() {
  const { a, b } = useStore((state) => state.measure)
  const tool = useStore((state) => state.tool)
  const units = useStore((state) => state.doc.units)
  if (tool !== 'measure' && !a) return null
  const delta = a && b ? b.map((value, index) => value - a[index]) : null
  return (
    <section className="section measure-panel" aria-label={t('Measurement')}>
      <h3>{t('Measure')}</h3>
      <p className="hint">
        {t(
          delta
            ? 'Click again to start a new measurement.'
            : a
              ? 'Pick the second point. Corners and edges snap exactly.'
              : 'Pick two points on visible geometry. Corners and edges snap exactly.',
        )}
      </p>
      {delta && (
        <>
          <output className="measurement-distance" aria-label={t('Distance')}>
            {lengthLabel(Math.hypot(...delta), units)}
          </output>
          <dl className="measurement-components">
            {delta.map((value, index) => (
              <div key={index}>
                <dt>{`Δ${'XYZ'[index]}`}</dt>
                <dd>{lengthLabel(value, units)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <div className="problem-actions">
        <button className="tb" onClick={() => useStore.getState().clearMeasure()}>
          {t('New measurement')}
        </button>
        <button
          className="tb"
          onClick={() => {
            useStore.getState().clearMeasure()
            useStore.getState().setTool('select')
          }}
        >
          {t('Close')}
        </button>
      </div>
    </section>
  )
}
