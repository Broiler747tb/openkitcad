import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FlyoutMenu } from './FlyoutMenu'
interface Item {
  id: string
  label: string
  group?: string
  hint?: string
  danger?: boolean
  sub?: string
}
export function ContextMenu<T extends Item>({
  x,
  y,
  actions,
  order,
  onPick,
  onClose,
}: {
  x: number
  y: number
  actions: T[]
  order?: string[]
  onPick: (action: T) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const bounds = ref.current!.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(y, innerHeight - bounds.height - 8)),
    })
  }, [x, y])
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', close)
    ref.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => window.removeEventListener('pointerdown', close)
  }, [onClose])
  return (
    <div
      ref={ref}
      className="sketch-menu"
      style={position}
      aria-label="Available actions"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[
            (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus()
        }
      }}
    >
      <div className="menu-caption">
        Available actions{' '}
        <button onClick={onClose} aria-label="Close menu">
          ×
        </button>
      </div>
      <FlyoutMenu actions={actions} order={order} onPick={onPick} />
    </div>
  )
}
