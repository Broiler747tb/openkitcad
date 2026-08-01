import { useEffect, useRef, useState } from 'react'
import { activeSketchFeature, useStore } from '../doc/store'
import { emptySelectionHint, sketchActions, type SketchAction } from '../sketch/actions'
import type { Vec2 } from '../core/math'
import { groupActions, showHeadings } from './menuGroups'

/**
 * The right-click menu inside a sketch.
 *
 * Only shows what actually applies to whatever is selected, so the user never
 * has to know which of seventeen constraint kinds they want - they point at two
 * lines and the menu says "Make parallel" and "Make square".
 */
export function SketchMenu({
  x,
  y,
  cursor,
  onClose,
}: {
  x: number
  y: number
  /** Where the right-click landed, in sketch coordinates. Trim needs it. */
  cursor?: Vec2
  onClose: () => void
}) {
  const selection = useStore((s) => s.sketchSelection)
  const doc = useStore((s) => s.doc)
  const [pending, setPending] = useState<SketchAction | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const secondRef = useRef<HTMLInputElement>(null)

  const sketch = activeSketchFeature(useStore.getState())?.sketch
  const actions = sketch ? sketchActions(sketch, selection, cursor) : []
  void doc

  // Close on anything that is not this menu.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred, or the click that opened the menu closes it again immediately.
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', away)
      window.addEventListener('keydown', key)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const run = (action: SketchAction, value: number, value2?: number) => {
    useStore.getState().applySketchAction(action.build(value, value2))
    onClose()
  }

  /** Commit the pending action, reading whichever fields it asked for. */
  const commit = (first: HTMLInputElement) => {
    if (!pending) return
    const a = Number(first.value)
    const b = pending.prompt2 ? Number(secondRef.current?.value) : undefined
    if (!Number.isFinite(a)) return
    if (pending.prompt2 && !Number.isFinite(b as number)) return
    run(pending, a, b)
  }

  // Keep the menu on screen when right-clicking near an edge.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 250),
    top: Math.min(y, window.innerHeight - 260),
  }

  return (
    <div className="sketch-menu" style={style} ref={ref}>
      {pending ? (
        <>
          <div className="sketch-menu-prompt">
            <label>{pending.prompt!.label}</label>
            <input
              autoFocus
              type="number"
              step="0.1"
              defaultValue={pending.prompt!.initial}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(e.target as HTMLInputElement)
                if (e.key === 'Escape') setPending(null)
              }}
            />
            <span>{pending.prompt!.unit}</span>
          </div>
          {pending.prompt2 && (
            <div className="sketch-menu-prompt">
              <label>{pending.prompt2.label}</label>
              <input
                ref={secondRef}
                type="number"
                step="0.1"
                defaultValue={pending.prompt2.initial}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Either field can commit, so tabbing is optional.
                    const first = ref.current?.querySelector('input')
                    if (first) commit(first as HTMLInputElement)
                  }
                  if (e.key === 'Escape') setPending(null)
                }}
              />
              <span>{pending.prompt2.unit}</span>
            </div>
          )}
        </>
      ) : actions.length === 0 ? (
        <div className="sketch-menu-empty">{emptySelectionHint(selection)}</div>
      ) : (
        groupActions(actions).map(([group, items]) => (
          <div key={group}>
            {showHeadings(actions) && <div className="menu-group">{group}</div>}
            {items.map((action) => (
              <button
                key={action.id}
                className="sketch-menu-item"
                onClick={() => (action.prompt ? setPending(action) : run(action, 0))}
              >
                <strong>{action.label}</strong>
                {action.hint && <span>{action.hint}</span>}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
