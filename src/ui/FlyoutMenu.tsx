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
  recommended?: boolean
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
  const recommended = filtered.filter((action) => action.recommended)
  const others = filtered.filter((action) => !action.recommended)
  const renderGroups = (items: T[], groupOrder?: string[]) =>
    groupActions(items, groupOrder).map(([name, items]) => (
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
    ))
  return (
    <div
      className="action-list"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && filtered.length) {
          e.preventDefault()
          onPick(recommended[0] ?? filtered[0])
          return
        }
        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation()
        const buttons = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
        ).filter((button) => button.getClientRects().length)
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
      {recommended.length ? (
        <>
          {renderGroups(
            recommended.map((action) => ({ ...action, group: 'Recommended for selection' })),
          )}
          {!!others.length &&
            (query.trim() ? (
              renderGroups(others, order)
            ) : (
              <details className="more-actions">
                <summary>{t('More actions ({0})', others.length)}</summary>
                {renderGroups(others, order)}
              </details>
            ))}
        </>
      ) : (
        renderGroups(filtered, order)
      )}
      {!filtered.length && <p className="hint">{t('No matching actions.')}</p>}
    </div>
  )
}
