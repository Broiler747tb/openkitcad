import { useEffect, useRef, useState } from 'react'
import { quantity } from '../core/quantity'
import type { ObjectAction } from './ObjectMenu'
import type { SketchAction } from '../sketch/actions'
import { useStore } from '../doc/store'

export function chooseAction(action: ObjectAction) {
  if (action.prompt || action.choice) {
    window.dispatchEvent(new CustomEvent('okc:action', { detail: action }))
  } else {
    action.run(0)
  }
}

export function chooseSketchAction(action: SketchAction) {
  chooseAction({
    ...action,
    run: (a, b, c, choice) => {
      useStore.getState().applySketchAction(action.build(a, b, c, choice))
    },
  })
}

export function ActionDialogHost() {
  const [action, setAction] = useState<ObjectAction | null>(null)
  useEffect(() => {
    const open = (event: Event) => setAction((event as CustomEvent<ObjectAction>).detail)
    window.addEventListener('okc:action', open)
    return () => window.removeEventListener('okc:action', open)
  }, [])
  return action ? (
    <ActionDialog key={action.id} action={action} onClose={() => setAction(null)} />
  ) : null
}

function ActionDialog({ action, onClose }: { action: ObjectAction; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [choice, setChoice] = useState(action.choice?.initial ?? '')
  const [error, setError] = useState('')
  const fields = [action.prompt, action.prompt2, action.prompt3].filter((p) => p != null)
  useEffect(() => {
    ref.current?.showModal()
    const firstField =
      ref.current?.querySelector<HTMLElement>('input') ??
      ref.current?.querySelector<HTMLElement>('select')
    firstField?.focus()
  }, [])
  return (
    <dialog
      ref={ref}
      className="action-dialog"
      onCancel={onClose}
      aria-labelledby="action-title"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          try {
            const values = fields.map((field, i) => {
              const value = quantity(String(data.get(`value-${i}`) ?? ''), field.unit)
              if (
                (field.min !== undefined && value < field.min) ||
                (field.max !== undefined && value > field.max)
              )
                throw new Error(
                  `${field.label}: expected ${field.min ?? '−∞'} to ${field.max ?? '∞'} ${field.unit}.`,
                )
              return value
            })
            action.run(values[0] ?? 0, values[1], values[2], choice)
            onClose()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <div className="dialog-heading">
          <span className="eyebrow">PARAMETERS</span>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <h2 id="action-title">{action.label}</h2>
        {action.hint && <p className="hint">{action.hint}</p>}
        {action.choice && (
          <label className="action-field">
            <span>{action.choice.label}</span>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              autoFocus={!fields.length}
            >
              {action.choice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <small>{action.choice.options.find((o) => o.value === choice)?.hint}</small>
          </label>
        )}
        {fields.map((field, i) => (
          <label className="action-field" key={i}>
            <span>{field.label}</span>
            <div className="unit-input">
              <input
                required
                autoFocus={i === 0}
                name={`value-${i}`}
                type="text"
                defaultValue={field.initial}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span>{field.unit}</span>
            </div>
          </label>
        ))}
        {!!fields.length && (
          <p className="hint">
            Arithmetic: 25.4/2, (10+5)*2, pi. Length fields accept mm, cm, m, in; angles accept deg
            or rad. Values are evaluated once, not linked formulas.
          </p>
        )}
        {error && (
          <p role="alert" className="problem">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" className="tb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            OK
          </button>
        </footer>
      </form>
    </dialog>
  )
}
