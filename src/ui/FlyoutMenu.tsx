import { useLayoutEffect, useRef, useState } from 'react'
import { groupActions, showHeadings } from './menuGroups'

/**
 * The two-pane body of a right-click menu.
 *
 * The menu opens showing only section names. Pointing at one opens its actions
 * in a panel beside the list, so what you read on the first look is eight short
 * phrases rather than forty. The section list stays put while you move between
 * sections, which is what makes it quick to scan.
 *
 * Both menus render through this, so they behave identically - the sketch menu
 * and the object menu are the same gesture on different things, and having one
 * of them flyout and the other not would be worse than neither.
 */
interface MenuItem {
  id: string
  label: string
  group?: string
  hint?: string
  danger?: boolean
}

export function FlyoutMenu<T extends MenuItem>({
  actions,
  order,
  onPick,
}: {
  actions: T[]
  /** Section names in the order they should be listed. */
  order?: string[]
  onPick: (action: T) => void
}) {
  const groups = groupActions(actions, order)
  const sectioned = showHeadings(actions)
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [flip, setFlip] = useState(false)
  const [lift, setLift] = useState(0)

  // Right-clicking near the right edge of the window would put the panel off
  // screen, so it opens on the other side instead. Measured rather than guessed
  // because the panel is as wide as its longest label.
  useLayoutEffect(() => {
    if (!open || !ref.current || !panelRef.current) {
      setLift(0)
      return
    }
    const list = ref.current.getBoundingClientRect()
    const panel = panelRef.current.getBoundingClientRect()
    setFlip(list.right + panel.width + 8 > window.innerWidth && list.left - panel.width - 8 > 0)
    // And a tall section near the bottom of the screen gets pulled up rather
    // than clipped. Only ever upwards: the top of the panel is where the eye is.
    const overflow = list.top + panel.height + 8 - window.innerHeight
    setLift(overflow > 0 ? Math.min(overflow, list.top - 8) : 0)
  }, [open])

  if (!sectioned) {
    return (
      <>
        {actions.map((action) => (
          <ItemButton key={action.id} action={action} onPick={onPick} />
        ))}
      </>
    )
  }

  return (
    <div className="flyout" ref={ref}>
      {groups.map(([group, items]) => (
        <button
          key={group}
          className={`flyout-group ${open === group ? 'open' : ''}`}
          // Hover opens it, so browsing the sections costs no clicks. Click
          // works too, for touch and for anyone who expects to have to.
          onPointerEnter={() => setOpen(group)}
          onClick={() => setOpen(group)}
        >
          <strong>{group}</strong>
          <span className="flyout-count">{items.length}</span>
          <span className="flyout-arrow">›</span>
        </button>
      ))}
      {open && (
        <div
          className={`flyout-panel ${flip ? 'left' : ''}`}
          ref={panelRef}
          style={{ marginTop: -lift }}
        >
          {(groups.find(([g]) => g === open)?.[1] ?? []).map((action) => (
            <ItemButton key={action.id} action={action} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemButton<T extends MenuItem>({
  action,
  onPick,
}: {
  action: T
  onPick: (action: T) => void
}) {
  return (
    <button
      className={`sketch-menu-item ${action.danger ? 'danger' : ''}`}
      onClick={() => onPick(action)}
    >
      <strong>{action.label}</strong>
      {action.hint && <span>{action.hint}</span>}
    </button>
  )
}
