import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { usePreferences } from '../doc/preferences'
import { CUBE_ZONES, directionLabels, projectCube, type Axis } from './cubeGeometry'

export type CubeFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

export function ViewCube({
  subscribe,
}: {
  subscribe: (listener: (view: number[]) => void) => () => void
}) {
  const [view, setView] = useState([1, 0, 0, 0, 1, 0, 0, 0, 1])
  const horizonLock = usePreferences((s) => s.values.horizonLock)
  const drag = useRef<{
    x: number
    y: number
    startX: number
    startY: number
    direction: string
    moved: boolean
  } | null>(null)
  useEffect(() => subscribe(setView), [subscribe])
  const go = (direction: string) =>
    window.dispatchEvent(new CustomEvent('okc:view', { detail: direction }))
  const zones = CUBE_ZONES.filter((zone) => projectCube(view, zone.direction)[2] > 0.01)
  const flat = CUBE_ZONES.some(
    (zone) => zone.kind === 'face' && projectCube(view, zone.direction)[2] > 0.9998,
  )
  const adjacent = (axis: number, sign: number) =>
    go(
      view
        .slice(axis * 3, axis * 3 + 3)
        .map((value) => Math.round(value) * sign)
        .join(','),
    )
  return (
    <div className="view-cube" aria-label={t('View cube')}>
      <button
        className="view-cube-home"
        title={t('Home view')}
        aria-label={t('Home view')}
        onClick={() => go('iso')}
      >
        <svg viewBox="0 0 16 16" width={17} height={17} aria-hidden="true">
          <path
            d="M2 8L8 2.5L14 8M4 7V13.5H12V7"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="view-cube-roll">
        <button
          aria-label={t('Roll counterclockwise')}
          disabled={horizonLock}
          title={t('Roll counterclockwise')}
          onClick={() =>
            window.dispatchEvent(new CustomEvent('okc:cube-roll', { detail: Math.PI / 2 }))
          }
        >
          ↶
        </button>
        <button
          aria-label={t('Roll clockwise')}
          disabled={horizonLock}
          title={t('Roll clockwise')}
          onClick={() =>
            window.dispatchEvent(new CustomEvent('okc:cube-roll', { detail: -Math.PI / 2 }))
          }
        >
          ↷
        </button>
      </div>
      <button
        className="view-horizon-lock"
        aria-label={t('Horizon lock')}
        aria-pressed={horizonLock}
        title={t('Keep the camera upright while orbiting')}
        onClick={() => usePreferences.getState().set({ horizonLock: !horizonLock })}
      >
        <svg viewBox="0 0 20 20" width={18} height={18} aria-hidden="true">
          <path
            d="M2 13h16M5 9l3-4 4 6 3-3 3 5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <svg
        className="view-cube-stage"
        viewBox="0 0 144 154"
        aria-label={t('Drag to orbit. Click a face, edge or corner to align the view.')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = (event.target as Element).closest('[data-direction]')
          const direction = target?.getAttribute('data-direction')
          if (!direction) return
          event.preventDefault()
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            direction,
            moved: false,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (!current) return
          if (
            !current.moved &&
            Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= 3
          )
            return
          current.moved = true
          window.dispatchEvent(
            new CustomEvent('okc:cube-orbit', {
              detail: { dx: event.clientX - current.x, dy: event.clientY - current.y },
            }),
          )
          current.x = event.clientX
          current.y = event.clientY
        }}
        onPointerUp={(event) => {
          const current = drag.current
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          if (current && !current.moved) go(current.direction)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
      >
        {zones.map((zone) => {
          const direction = zone.direction.join(',')
          const label = zone.label
            ? t(zone.label)
            : t(
                'View: {0}',
                directionLabels(zone.direction)
                  .map((name) => t(name))
                  .join(' · '),
              )
          const normal = projectCube(view, zone.direction)
          const centre = projectCube(
            view,
            zone.direction.map((value) => value / Math.hypot(...zone.direction)) as Axis,
          )
          const right = zone.right ? projectCube(view, zone.right) : null
          const down = zone.down ? projectCube(view, zone.down) : null
          const shade =
            zone.kind === 'face' ? (zone.direction[2] > 0 ? 0 : zone.direction[0] ? 8 : 15) : 20
          return (
            <g
              key={direction}
              role="button"
              tabIndex={0}
              aria-label={label}
              className={`cube-zone cube-${zone.kind}`}
              data-direction={direction}
              data-kind={zone.kind}
              aria-pressed={zone.kind === 'face' && normal[2] > 0.9998}
              onClick={(event) => {
                if (event.detail === 0) go(direction)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  go(direction)
                }
              }}
              style={{
                fill: `color-mix(in srgb, var(--okc-cube-face), var(--okc-cube-shade) ${shade}%)`,
              }}
            >
              <title>{label}</title>
              <polygon
                points={zone.points
                  .map((point) => {
                    const p = projectCube(view, point)
                    return `${72 + p[0] * 34},${80 + p[1] * 34}`
                  })
                  .join(' ')}
              />
              {zone.label && right && down && (
                <text
                  transform={`matrix(${right[0]} ${right[1]} ${down[0]} ${down[1]} ${72 + centre[0] * 34} ${80 + centre[1] * 34})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {flat && (
        <>
          <button
            className="cube-adjacent cube-up"
            aria-label={t('View above')}
            onClick={() => adjacent(1, 1)}
          >
            ▴
          </button>
          <button
            className="cube-adjacent cube-down"
            aria-label={t('View below')}
            onClick={() => adjacent(1, -1)}
          >
            ▾
          </button>
          <button
            className="cube-adjacent cube-left"
            aria-label={t('View to the left')}
            onClick={() => adjacent(0, -1)}
          >
            ◂
          </button>
          <button
            className="cube-adjacent cube-right"
            aria-label={t('View to the right')}
            onClick={() => adjacent(0, 1)}
          >
            ▸
          </button>
        </>
      )}
    </div>
  )
}
