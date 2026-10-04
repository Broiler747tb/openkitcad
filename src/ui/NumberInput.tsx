import { t } from '../i18n'
import { useEffect, useId, useState } from 'react'
import { useStore } from '../doc/store'
import { quantity } from '../core/quantity'
import { lengthText } from '../core/units'
export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  suffix = 'mm',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  const id = useId()
  const units = useStore((s) => s.doc.units)
  const isLength = suffix === 'mm'
  const shown = isLength ? lengthText(value, units) : String(Math.round(value * 1000) / 1000)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const commit = () => {
    if (draft.trim() === shown) return
    let v: number
    try {
      v = quantity(draft, isLength ? units : suffix === '°' ? '°' : '')
    } catch {
      setDraft(shown)
      return
    }
    if ((min != null && v < min) || (max != null && v > max)) {
      setDraft(shown)
      return
    }
    if (v !== value) onChange(v)
  }
  return (
    <div className="row">
      <label htmlFor={id}>{t(label)}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(shown)
          }
        }}
      />
      <span style={{ color: 'var(--text-faint)', fontSize: 11, width: 20 }}>
        {isLength ? units : suffix}
      </span>
    </div>
  )
}
