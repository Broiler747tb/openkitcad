import { t } from '../i18n'
import { activeSketchFeature, useStore } from '../doc/store'
import { CONSTRAINT_LABELS } from '../sketch/types'
import { lengthLabel } from '../core/units'
import { useEffect, useMemo } from 'react'
import { solveSketch } from '../sketch/solver'

export function SketchDiagnostics() {
  const state = useStore()
  const sketch = activeSketchFeature(state)?.sketch
  const status = useMemo(() => (sketch ? solveSketch(sketch) : null), [sketch])
  useEffect(() => {
    if (!status || !sketch) return
    useStore.setState({
      sketchStatus: {
        dof: status.dof,
        failing: status.failing,
        closed: sketch.entities.some((entity) => !entity.construction),
        freePoints: status.freePoints,
        freeRadii: status.freeRadii,
        freeEntities: status.freeEntities,
      },
    })
  }, [sketch, status])
  if (!sketch || !status) return null
  const failing = sketch.constraints.filter((constraint) => status.failing.includes(constraint.id))
  const entities = new Set([...status.freeEntities, ...status.freeRadii])
  const freePoints = status.freePoints.filter((id) => id !== 'origin')
  return (
    <div className="section sketch-diagnostics">
      <h3>{t('Sketch health')}</h3>
      {failing.length > 0 ? (
        <>
          <p className="hint">
            {t(
              'These constraints cannot all be satisfied. Select one to inspect it before changing or removing it.',
            )}
          </p>
          {failing.map((constraint) => (
            <button
              className="btn diagnostic-conflict"
              key={constraint.id}
              onClick={() => state.setSketchSelection([{ kind: 'constraint', id: constraint.id }])}
            >
              {t(CONSTRAINT_LABELS[constraint.kind])}
              {'value' in constraint
                ? ` · ${constraint.kind === 'angle' ? `${constraint.value}°` : lengthLabel(constraint.value, state.doc.units)}`
                : ''}
              <small>{constraint.id}</small>
            </button>
          ))}
        </>
      ) : status.dof === 0 ? (
        <p className="hint">{t('Fully defined. Nothing can move by accident.')}</p>
      ) : (
        <>
          <p className="hint">{t('Remaining degrees of freedom: {0}', status.dof)}</p>
          <p className="hint">
            {t('Blue geometry can still move. Select it, then add a size or a constraint.')}
          </p>
          <button
            className="tb"
            onClick={() =>
              state.setSketchSelection([
                ...freePoints.map((id) => ({ kind: 'point' as const, id })),
                ...[...entities].map((id) => ({ kind: 'entity' as const, id })),
              ])
            }
          >
            {t('Show free geometry')}
          </button>
        </>
      )}
    </div>
  )
}
