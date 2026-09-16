import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FlyoutMenu } from './FlyoutMenu'

export interface MenuRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function sameRect(a: MenuRect | null, b: MenuRect | null): boolean {
  if (!a || !b) return a === b
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5
  )
}

export interface Placement {
  left: number
  top: number
  maxHeight?: number
}

export function placeAround(
  x: number,
  y: number,
  width: number,
  height: number,
  avoid: MenuRect | null | undefined,
  screen: { width: number; height: number } = { width: innerWidth, height: innerHeight },
): Placement {
  const margin = 8
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, screen.width - width - margin))
  const clampTop = (top: number) => Math.max(margin, Math.min(top, screen.height - height - margin))
  if (!avoid) return { left: clampLeft(x), top: clampTop(y) }
  const gap = 10
  const centred = clampLeft((avoid.left + avoid.right) / 2 - width / 2)
  const below = screen.height - margin - (avoid.bottom + gap)
  const above = avoid.top - gap - margin
  if (height <= below) return { left: centred, top: avoid.bottom + gap }
  if (height <= above) return { left: centred, top: avoid.top - gap - height }
  const sideTop = Math.max(margin, Math.min(avoid.top, screen.height - margin - height))
  const sideRoom = screen.height - margin - sideTop
  if (width <= screen.width - margin - (avoid.right + gap)) {
    return { left: avoid.right + gap, top: sideTop, maxHeight: sideRoom }
  }
  if (width <= avoid.left - gap - margin) {
    return { left: avoid.left - gap - width, top: sideTop, maxHeight: sideRoom }
  }
  return below >= above
    ? { left: centred, top: avoid.bottom + gap, maxHeight: Math.max(120, below) }
    : { left: centred, top: margin, maxHeight: Math.max(120, above) }
}

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
  avoid,
}: {
  x: number
  y: number
  actions: T[]
  order?: string[]
  onPick: (action: T) => void
  onClose: () => void
  avoid?: MenuRect | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Placement>({ left: x, top: y })
  useLayoutEffect(() => {
    const element = ref.current!
    const width = element.offsetWidth
    const height = element.scrollHeight
    const next = placeAround(x, y, width, height, avoid)
    setPosition((current) =>
      current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight
        ? current
        : next,
    )
  }, [x, y, avoid])
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
      style={
        position.maxHeight === undefined
          ? { left: position.left, top: position.top }
          : { ...position, overflowY: 'auto' }
      }
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
