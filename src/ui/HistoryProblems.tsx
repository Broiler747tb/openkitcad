import { t } from '../i18n'
import { useStore } from '../doc/store'
import {
  findBody,
  findFeature,
  featureDependencies,
  featureReadsBodies,
  featureModifiesBodies,
  featureCreatesBodies,
} from '../doc/model'
import type { Feature, OkcDocument } from '../doc/types'
import type { KernelError } from '../kernel/types'
import { editFeature } from './command/commands'
import { useCommand } from './command/session'
import { repairSketchPlaneCommand } from './command/specs/repair'

export function affectedFeatures(doc: OkcDocument, featureId: string): Feature[] {
  const affected = new Set([featureId])
  const start = doc.timeline.findIndex((feature) => feature.id === featureId)
  if (start < 0) return []
  const source = doc.timeline[start]
  const bodies = new Set([...featureCreatesBodies(source), ...featureModifiesBodies(source)])
  for (const feature of doc.timeline.slice(start + 1)) {
    if (
      featureDependencies(doc, feature).some((id) => affected.has(id)) ||
      [...featureReadsBodies(feature), ...featureModifiesBodies(feature)].some((id) =>
        bodies.has(id),
      )
    ) {
      affected.add(feature.id)
      for (const body of [...featureCreatesBodies(feature), ...featureModifiesBodies(feature)])
        bodies.add(body)
    }
  }
  return doc.timeline.filter((feature) => feature.id !== featureId && affected.has(feature.id))
}

export function rootProblem(error: KernelError, errors: KernelError[]): KernelError {
  const visited = new Set<string>()
  let current = error
  while (current.causeFeatureId && !visited.has(current.featureId)) {
    visited.add(current.featureId)
    const upstream = errors.find(
      (candidate) =>
        candidate.featureId === current.causeFeatureId && candidate.severity === 'error',
    )
    if (!upstream) break
    current = upstream
  }
  return current
}

export function HistoryProblems({ onProperties }: { onProperties: () => void }) {
  const doc = useStore((state) => state.doc)
  const errors = useStore((state) => state.errors)
  const building = useStore((state) => state.building)
  if (!errors.length) return null
  const roots = errors.filter((error) => rootProblem(error, errors) === error)
  const select = (featureId: string) => {
    useStore.getState().select({ kind: 'feature', id: featureId })
    onProperties()
  }
  return (
    <div className="section history-problems">
      <h3>{t('Needs attention')}</h3>
      {roots.map((error, index) => {
        const feature = findFeature(doc, error.featureId)
        const affected = feature ? affectedFeatures(doc, feature.id) : []
        const reference = error.reference
        const body = reference
          ? (findBody(doc, reference.bodyId)?.body.name ?? reference.bodyId)
          : null
        return (
          <div
            className={`msg ${error.severity === 'warning' ? 'warn' : 'error'}`}
            key={`${error.featureId}-${index}`}
          >
            {feature && (
              <button className="tb msg-action" onClick={() => select(feature.id)}>
                {feature.name}
              </button>
            )}
            <strong>{t(error.message)}</strong>
            {reference && (
              <p className="broken-reference">
                {t('Reference to repair: {0} on {1}', t(reference.kind), body ?? '')}
                <br />
                <code>{reference.name}</code>
              </p>
            )}
            {error.hint && <em>{t(error.hint)}</em>}
            {feature && (
              <div className="problem-actions">
                <button
                  className="tb"
                  disabled={building}
                  onClick={() => {
                    select(feature.id)
                    if (feature.kind === 'sketch' && reference)
                      useCommand.getState().start(repairSketchPlaneCommand, {
                        editing: feature,
                        initial: { plane: [], offset: feature.plane.offset },
                      })
                    else if (feature.kind === 'sketch') useStore.getState().openSketch(feature.id)
                    else editFeature(feature)
                  }}
                >
                  {t(reference ? 'Pick geometry again' : 'Edit Feature')}
                </button>
                {error.causeFeatureId && findFeature(doc, error.causeFeatureId) && (
                  <button className="tb" onClick={() => select(error.causeFeatureId!)}>
                    {t('Show the step that changed it')}
                  </button>
                )}
                {reference && findBody(doc, reference.bodyId) && (
                  <button
                    className="tb"
                    onClick={() => {
                      useStore.getState().select({ kind: 'body', id: reference.bodyId })
                      onProperties()
                    }}
                  >
                    {t('Show body')}
                  </button>
                )}
              </div>
            )}
            {affected.length > 0 && (
              <details>
                <summary>{t('Dependent steps: {0}', affected.length)}</summary>
                {affected.map((item) => (
                  <button key={item.id} className="tb" onClick={() => select(item.id)}>
                    {item.name}
                  </button>
                ))}
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
