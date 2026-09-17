import { useEffect, useRef, useState } from 'react'
import { newId, useStore } from '../doc/store'
import { parameterFields, resolveParameters } from '../doc/parameters'
import { FIT_CLASSES, fitParameterName } from '../doc/fits'
import { usePreferences } from '../doc/preferences'

export function ParametersDialog({ onClose }: { onClose: () => void }) {
  const state = useStore(),
    ref = useRef<HTMLDialogElement>(null)
  const [parameters, setParameters] = useState(() => structuredClone(state.doc.parameters))
  const [bindings, setBindings] = useState(() => structuredClone(state.doc.bindings))
  const [failure, setFailure] = useState('')
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const targets = state.doc.timeline.flatMap((feature) =>
    parameterFields(feature).map((field) => ({
      feature,
      field,
      key: `${feature.id}/${field}`,
    })),
  )
  const preview = structuredClone(state.doc)
  preview.parameters = structuredClone(parameters)
  preview.bindings = bindings
  let error = ''
  try {
    resolveParameters(preview)
  } catch (e) {
    error = (e as Error).message
  }
  const printer = usePreferences((p) => p.values)
  const setPreference = usePreferences((p) => p.set)
  const useFits = () => {
    let next = [...parameters]
    for (const fit of FIT_CLASSES) {
      const name = fitParameterName(fit.value)
      const gap = printer[fit.preference]
      const expression = `${gap} mm`
      next = next.some((p) => p.name === name)
        ? next.map((p) => (p.name === name ? { ...p, value: gap, expression } : p))
        : [
            ...next,
            {
              id: newId('param'),
              name,
              value: gap,
              expression,
              comment: `${fit.label} fit: gap per side`,
            },
          ]
    }
    setParameters(next)
  }
  const add = () => {
    let name = 'parameter_1',
      i = 1
    while (parameters.some((p) => p.name === name)) name = `parameter_${++i}`
    setParameters([...parameters, { id: newId('param'), name, value: 10, expression: '10' }])
  }
  return (
    <dialog
      ref={ref}
      className="parameters-dialog"
      onCancel={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label="User parameters"
    >
      <header className="dialog-heading">
        <h2>User parameters · fx</h2>
        <button onClick={onClose} aria-label="Close parameters">
          ×
        </button>
      </header>
      <p>
        Persistent scalar formulas. Plain numbers are millimetres; type a unit (mm, cm, m, in, ft)
        to use another. Angle links read values as degrees.
      </p>
      <h3>Parameter table</h3>
      <div className="parameter-table">
        <div className="parameter-row">
          <b>Name</b>
          <b>Expression</b>
          <b>Value</b>
          <b>Comment</b>
          <span />
        </div>
        {parameters.map((p, index) => (
          <div className="parameter-row" key={p.id}>
            <input
              aria-label={`Parameter ${index + 1} name`}
              value={p.name}
              onChange={(e) =>
                setParameters(
                  parameters.map((q) => (q.id === p.id ? { ...q, name: e.target.value } : q)),
                )
              }
            />
            <input
              aria-label={`Parameter ${index + 1} expression`}
              value={p.expression ?? String(p.value)}
              onChange={(e) =>
                setParameters(
                  parameters.map((q) => (q.id === p.id ? { ...q, expression: e.target.value } : q)),
                )
              }
            />
            <output>
              {error
                ? '—'
                : preview.parameters[index].value.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}
            </output>
            <input
              aria-label={`Parameter ${index + 1} comment`}
              value={p.comment ?? ''}
              onChange={(e) =>
                setParameters(
                  parameters.map((q) => (q.id === p.id ? { ...q, comment: e.target.value } : q)),
                )
              }
            />
            <button
              aria-label={`Remove parameter ${p.name}`}
              onClick={() => setParameters(parameters.filter((q) => q.id !== p.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button onClick={add}>Add parameter</button>
      <p className="hint">
        Examples: width = 80; depth = width/2; wall = 3mm. Lowercase names. + − * /, parentheses,
        pi, mm/cm/m/in/ft. References may point to later rows. Rename referenced names in formulas
        too.
      </p>
      <h3>Printer fit classes</h3>
      <p className="hint">
        The gap each side of a fit, tuned to your printer. Saved in this browser for every design.
        Snap fits, pins, lips and the other fits read them through the fit_ parameters above.
      </p>
      <div className="fit-class-table">
        {FIT_CLASSES.map((fit) => (
          <label key={fit.value} className="fit-class-row" title={fit.hint}>
            <span>{fit.label}</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              aria-label={`${fit.label} fit gap`}
              defaultValue={printer[fit.preference]}
              onChange={(e) => {
                const value = e.target.valueAsNumber
                if (Number.isFinite(value)) setPreference({ [fit.preference]: value })
              }}
            />
            <span>mm</span>
            <small>{fit.hint}</small>
          </label>
        ))}
      </div>
      <button onClick={useFits}>Use these gaps in this design</button>
      <h3>Linked feature dimensions</h3>
      <p className="hint">
        Numeric edits in Properties detach that field's link. Unlink keeps its last applied value.
      </p>
      {bindings.map((b, index) => (
        <div className="binding-row" key={index}>
          <select
            aria-label={`Link ${index + 1} target`}
            value={`${b.featureId}/${b.field}`}
            onChange={(e) => {
              const t = targets.find((candidate) => candidate.key === e.target.value)
              if (!t) return
              setBindings(
                bindings.map((q, i) =>
                  i === index ? { ...q, featureId: t.feature.id, field: t.field } : q,
                ),
              )
            }}
          >
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.feature.name} / {t.field}
              </option>
            ))}
          </select>
          <input
            aria-label={`Link ${index + 1} expression`}
            value={b.expression}
            onChange={(e) =>
              setBindings(
                bindings.map((q, i) => (i === index ? { ...q, expression: e.target.value } : q)),
              )
            }
          />
          <button onClick={() => setBindings(bindings.filter((_, i) => i !== index))}>
            Unlink
          </button>
        </div>
      ))}
      <button
        disabled={!targets.length}
        onClick={() => {
          const t = targets.find(
            (candidate) =>
              !bindings.some(
                (b) => b.featureId === candidate.feature.id && b.field === candidate.field,
              ),
          )
          if (t)
            setBindings([
              ...bindings,
              {
                featureId: t.feature.id,
                field: t.field,
                expression: parameters[0]?.name ?? '10',
              },
            ])
        }}
      >
        Link dimension
      </button>
      {!targets.length && <p>Create a solid feature first, then link its dimensions here.</p>}
      {(error || failure) && (
        <p role="alert" className="problem">
          {error || failure}
        </p>
      )}
      <footer className="dialog-footer">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary-button"
          disabled={!!error}
          onClick={() => {
            try {
              state.commit((d) => {
                d.parameters = structuredClone(parameters)
                d.bindings = structuredClone(bindings)
              })
              onClose()
            } catch (e) {
              setFailure((e as Error).message)
            }
          }}
        >
          Apply & rebuild
        </button>
      </footer>
    </dialog>
  )
}
