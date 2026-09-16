import { useEffect, type ComponentType, type SVGProps } from 'react'

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
}: {
  x: number
  y: number
  items: ReadonlyArray<MarkingItem | null>
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const left = Math.max(RADIUS + 70, Math.min(x, innerWidth - RADIUS - 70))
  const top = Math.max(RADIUS + 20, Math.min(y, innerHeight - RADIUS - 20))

  return (
    <div className="marking-ring" style={{ left, top }} aria-label="Marking menu">
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
