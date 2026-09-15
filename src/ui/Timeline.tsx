import { Fragment } from 'react'
import { useStore } from '../doc/store'
import { FEATURE_HINT, FEATURE_ICON, FEATURE_LABEL } from '../doc/types'
import { findComponent, markerIndex } from '../doc/model'
import { GridSettings } from './PrecisionTools'

export function Timeline({ onEdit }: { onEdit: () => void }) {
  const state = useStore()
  const doc = state.doc
  const marker = markerIndex(doc)
  const failed = new Set(state.errors.filter((e) => e.severity === 'error').map((e) => e.featureId))
  const selectedIndex =
    state.selection.kind === 'feature'
      ? doc.timeline.findIndex((f) => f.id === state.selection.id)
      : -1
  const selected = selectedIndex >= 0 ? doc.timeline[selectedIndex] : undefined
  function edit() {
    if (!selected) return
    if (selected.kind === 'sketch') state.openSketch(selected.id)
    else onEdit()
  }
  const markerSlot = (
    <span
      key="marker"
      className="timeline-marker"
      role="separator"
      aria-label={`History marker after step ${marker}`}
      title="History marker. Steps to its right are rolled back and not built."
    />
  )
  return (
    <section className="design-timeline" aria-label="Feature timeline">
      <div className="timeline-label">
        TIMELINE<small>{doc.timeline.length} steps</small>
      </div>
      <div
        className="timeline-track"
        role="toolbar"
        aria-label="Modelling features"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[
            Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
          ]?.focus()
          e.preventDefault()
        }}
      >
        <div className="timeline-body timeline-global">
          {doc.timeline.map((f, i) => {
            const component = findComponent(doc, f.componentId)
            const where =
              component && component.id !== doc.rootComponentId ? `${component.name} · ` : ''
            const rolledBack = i >= marker
            return (
              <Fragment key={f.id}>
                {i === marker && markerSlot}
                <button
                  className={
                    'timeline-feature ' +
                    (state.selection.id === f.id ? 'selected ' : '') +
                    (f.suppressed ? 'suppressed ' : '') +
                    (rolledBack ? 'rolled-back ' : '') +
                    (failed.has(f.id) ? 'failed' : '')
                  }
                  aria-label={`${where}${f.name || FEATURE_LABEL[f.kind]} ${i + 1}`}
                  aria-pressed={state.selection.id === f.id}
                  title={`${where}${f.name || FEATURE_LABEL[f.kind]} (${FEATURE_LABEL[f.kind]})${f.suppressed ? ' · suppressed' : ''}${rolledBack ? ' · rolled back' : ''}${failed.has(f.id) ? ' · failed' : ''}\n${FEATURE_HINT[f.kind]}\nDouble-click to edit`}
                  onClick={() => state.select({ kind: 'feature', id: f.id })}
                  onDoubleClick={() => {
                    state.select({ kind: 'feature', id: f.id })
                    if (f.kind === 'sketch') state.openSketch(f.id)
                    else onEdit()
                  }}
                >
                  <span>{FEATURE_ICON[f.kind]}</span>
                  <small>{i + 1}</small>
                </button>
              </Fragment>
            )
          })}
          {marker >= doc.timeline.length && doc.timeline.length > 0 && markerSlot}
        </div>
        {!doc.timeline.length && (
          <span className="timeline-empty">Create a sketch or solid to begin feature history.</span>
        )}
      </div>
      <div className="timeline-actions">
        <button
          disabled={!selected || !!state.activeSketch}
          title="Change the selected step."
          onClick={edit}
        >
          Edit feature
        </button>
        <button
          disabled={!selected || !!state.activeSketch}
          title="Turn the selected step off without deleting it."
          onClick={() =>
            selected && state.updateFeature(selected.id, { suppressed: !selected.suppressed })
          }
        >
          {selected?.suppressed ? 'Unsuppress' : 'Suppress'}
        </button>
        <button
          disabled={!selected || !!state.activeSketch}
          title="Move the history marker to just after the selected step. Later steps are not built."
          onClick={() => selected && state.setMarker(selectedIndex + 1)}
        >
          Roll Back To Here
        </button>
        <button
          disabled={doc.marker === null || !!state.activeSketch}
          title="Move the history marker to the end so every step is built."
          onClick={() => state.setMarker(null)}
        >
          Roll To End
        </button>
      </div>
    </section>
  )
}

export function NavigationBar() {
  const state = useStore()
  return (
    <div className="navigation-bar" aria-label="View navigation">
      <button
        title="Home view"
        onClick={() => window.dispatchEvent(new CustomEvent('okc:view', { detail: 'iso' }))}
      >
        ⌂
      </button>
      <button
        title="Fit view (Home)"
        onClick={() => window.dispatchEvent(new CustomEvent('okc:fit'))}
      >
        ⤢ Fit
      </button>
      <GridSettings />
      <button
        aria-pressed={state.section.enabled}
        onClick={() => state.setSection({ enabled: !state.section.enabled })}
      >
        Section
      </button>
    </div>
  )
}
