import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import type { MenuRect } from './ContextMenu'

export interface MarkingItem {
  id: string
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  disabled?: boolean
  run: () => void
}

const SLOT_ANGLES = [-90, -45, 0, 45, 90, 135, 180, -135]
const RADIUS = 92

let recent: { id: string; label: string; run: () => void } | null = null

export function rememberCommand(id: string, label: string, run: () => void) {
  recent = { id, label, run }
}

export function recentCommand() {
  return recent
}

export function MarkingRing({
  x,
  y,
  items,
  onClose,
  onBounds,
}: {
  x: number
  y: number
  items: ReadonlyArray<MarkingItem | null>
  onClose: () => void
  onBounds?: (rect: MenuRect) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const left = Math.max(RADIUS + 70, Math.min(x, innerWidth - RADIUS - 70)) + shift.x
  const top = Math.max(RADIUS + 20, Math.min(y, innerHeight - RADIUS - 20)) + shift.y

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rects = [...element.children].map((child) => child.getBoundingClientRect())
    if (!rects.length) return
    const rect: MenuRect = {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }
    const margin = 8
    const fitsWide = rect.right - rect.left <= innerWidth - 2 * margin
    const fitsTall = rect.bottom - rect.top <= innerHeight - 2 * margin
    const dx = !fitsWide
      ? 0
      : rect.left < margin
        ? margin - rect.left
        : rect.right > innerWidth - margin
          ? innerWidth - margin - rect.right
          : 0
    const dy = !fitsTall
      ? 0
      : rect.top < margin
        ? margin - rect.top
        : rect.bottom > innerHeight - margin
          ? innerHeight - margin - rect.bottom
          : 0
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setShift((current) => ({ x: current.x + dx, y: current.y + dy }))
      return
    }
    onBounds?.(rect)
  })

  return (
    <div ref={ref} className="marking-ring" style={{ left, top }} aria-label="Marking menu">
      <div className="marking-hub" />
      {items.map((item, index) => {
        if (!item) return null
        const angle = (SLOT_ANGLES[index] * Math.PI) / 180
        const dx = Math.cos(angle) * RADIUS
        const dy = Math.sin(angle) * RADIUS * 0.72
        const align = Math.abs(dx) < 1 ? '-50%' : dx > 0 ? '0%' : '-100%'
        const Icon = item.icon
        return (
          <button
            key={item.id + index}
            className="marking-item"
            style={{ transform: `translate(${dx}px, ${dy}px) translate(${align}, -50%)` }}
            disabled={item.disabled}
            title={item.label}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              if (item.disabled) return
              onClose()
              item.run()
            }}
          >
            {Icon ? <Icon className="okc-icon okc-icon-2d" width={18} height={18} /> : null}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
