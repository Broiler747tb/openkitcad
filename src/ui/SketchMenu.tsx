import { useEffect, useRef, useState } from 'react'
import { activeSketchFeature, useStore } from '../doc/store'
import { emptySelectionHint, sketchActions, type SketchAction } from '../sketch/actions'

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
  onClose,
}: {
  x: number
  y: number
  onClose: () => void
}) {
  const selection = useStore((s) => s.sketchSelection)
  const doc = useStore((s) => s.doc)
  const [pending, setPending] = useState<SketchAction | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const sketch = activeSketchFeature(useStore.getState())?.sketch
  const actions = sketch ? sketchActions(sketch, selection) : []
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

  const run = (action: SketchAction, value: number) => {
    useStore.getState().applySketchAction(action.build(value))
    onClose()
  }

  // Keep the menu on screen when right-clicking near an edge.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 250),
    top: Math.min(y, window.innerHeight - 260),
  }

  return (
    <div className="sketch-menu" style={style} ref={ref}>
      {pending ? (
        <div className="sketch-menu-prompt">
          <label>{pending.prompt!.label}</label>
          <input
            autoFocus
            type="number"
            step="0.1"
            defaultValue={pending.prompt!.initial}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = Number((e.target as HTMLInputElement).value)
                if (Number.isFinite(value)) run(pending, value)
              }
              if (e.key === 'Escape') setPending(null)
            }}
          />
          <span>{pending.prompt!.unit}</span>
        </div>
      ) : actions.length === 0 ? (
        <div className="sketch-menu-empty">{emptySelectionHint(selection)}</div>
      ) : (
        actions.map((action) => (
          <button
            key={action.id}
            className="sketch-menu-item"
            onClick={() => (action.prompt ? setPending(action) : run(action, 0))}
          >
            <strong>{action.label}</strong>
            {action.hint && <span>{action.hint}</span>}
          </button>
        ))
      )}
    </div>
  )
}
