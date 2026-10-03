import { t, matchesTranslation } from '../i18n'
import { useState } from 'react'
import { groupActions } from './menuGroups'
interface MenuItem {
  id: string
  label: string
  group?: string
  sub?: string
  hint?: string
  danger?: boolean
}
/** Flat sections expose every action without hover navigation. */
export function FlyoutMenu<T extends MenuItem>({
  actions,
  order,
  onPick,
}: {
  actions: T[]
  order?: string[]
  onPick: (action: T) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = actions.filter((a) =>
    [a.label, a.group, a.sub, a.hint].some((text) => text && matchesTranslation(text, query)),
  )
  return (
    <div
      className="action-list"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && filtered.length) {
          e.preventDefault()
          onPick(filtered[0])
          return
        }
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation()
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }}
    >
      {actions.length > 7 && (
        <input
          className="action-search"
          aria-label={t('Search actions')}
          placeholder={t('Find an action…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {groupActions(filtered, order).map(([name, items]) => (
        <section className="action-group" key={name}>
          <h4>{t(name)}</h4>
          {items.map((action) => (
            <button
              key={action.id}
              className={`sketch-menu-item ${action.danger ? 'danger' : ''}`}
              onClick={() => onPick(action)}
            >
              <strong>{t(action.label)}</strong>
              {action.hint && <span>{t(action.hint)}</span>}
            </button>
          ))}
        </section>
      ))}
      {!filtered.length && <p className="hint">{t('No matching actions.')}</p>}
    </div>
  )
}
