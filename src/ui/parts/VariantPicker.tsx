import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  allParts,
  byPopularity,
  FAMILIES,
  holeSummary,
  sizeSummary,
  type CataloguePart,
} from '../../catalogue'
import { useStore } from '../../doc/store'
import { endPartDrag, placePart, startPartDrag } from './actions'
import { PartSketch, sketchSpan } from './PartSketch'
import { usePartsView, useShelf } from './shelf'

const ACCURACY_SHORT: Record<CataloguePart['confidence'], string> = {
  datasheet: 'Official drawing',
  measured: 'Measured',
  approximate: 'Approximate',
}

export function VariantPicker() {
  const familyId = usePartsView((s) => s.picker)
  const version = useShelf((s) => s.version)
  const units = useStore((s) => s.doc.units)
  const [dragging, setDragging] = useState(false)
  const [spot, setSpot] = useState({ left: 8, top: 96 })
  const panel = useRef<HTMLDivElement>(null)
  const family = familyId ? FAMILIES.get(familyId) : undefined
  const parts = useMemo(
    () =>
      familyId
        ? allParts()
            .filter((part) => part.family === familyId)
            .sort(byPopularity)
        : [],
    [familyId, version],
  )

  useEffect(() => {
    if (!familyId) return
    const close = () => usePartsView.getState().openPicker(null)
    const place = () => {
      const rect = document.querySelector('.panel-left')?.getBoundingClientRect()
      const beside = !!rect && rect.width > 0 && innerWidth > 900
      setSpot({
        left: beside ? rect.right + 8 : 8,
        top: beside ? Math.max(rect.top, 64) : 64,
      })
    }
    place()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (panel.current?.contains(target)) return
      if ((target as Element).closest?.('.parts-row.family')) return
      close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('resize', place)
    }
  }, [familyId])

  const span = Math.max(0, ...parts.map(sketchSpan))
  if (!family || !parts.length) return null
  const close = () => usePartsView.getState().openPicker(null)

  return createPortal(
    <div
      ref={panel}
      className={`variant-picker ${dragging ? 'dragging' : ''}`}
      style={{ left: spot.left, top: spot.top, maxHeight: `calc(100vh - ${spot.top + 40}px)` }}
      role="dialog"
      aria-label={`Choose a version of ${family.name}`}
    >
      <header className="variant-header">
        <div>
          <strong>{family.name}</strong>
          <span>{parts.length} versions. Drag one onto a face, or insert it at the origin.</span>
        </div>
        <button className="variant-close" aria-label="Close" title="Close (Esc)" onClick={close}>
          ×
        </button>
      </header>
      <div className="variant-grid">
        {parts.map((part) => (
          <VariantCard
            key={part.id}
            part={part}
            size={sizeSummary(part, units)}
            holes={holeSummary(part, units)}
            span={span}
            onDragging={setDragging}
            onDone={close}
          />
        ))}
      </div>
    </div>,
    document.body,
  )
}

function VariantCard({
  part,
  size,
  holes,
  span,
  onDragging,
  onDone,
}: {
  part: CataloguePart
  size: string
  holes: string | null
  span: number
  onDragging: (dragging: boolean) => void
  onDone: () => void
}) {
  const favourite = useShelf((s) => s.favourites.includes(part.id))
  return (
    <div
      className="variant-card"
      draggable
      onDragStart={(e) => {
        startPartDrag(e, part.id)
        setTimeout(() => onDragging(true))
      }}
      onDragEnd={(e) => {
        endPartDrag()
        onDragging(false)
        if (e.dataTransfer.dropEffect !== 'none') onDone()
      }}
    >
      <div className="variant-preview">
        <PartSketch part={part} span={span} className="variant-sketch" />
      </div>
      <strong className="variant-label">{part.variant ?? part.name}</strong>
      <span className="variant-name">{part.name}</span>
      <span className="variant-fact">{size}</span>
      {holes && <span className="variant-fact">{holes}</span>}
      <span className={`variant-accuracy ${part.confidence}`}>
        {ACCURACY_SHORT[part.confidence]}
      </span>
      <div className="variant-actions">
        <button
          className="btn primary"
          onClick={() => {
            placePart(part.id)
            onDone()
          }}
        >
          Insert
        </button>
        <button
          className="btn"
          onClick={() => {
            const { view, show } = usePartsView.getState()
            show({
              kind: 'details',
              partId: part.id,
              back: view.kind === 'details' ? view.back : view,
            })
            onDone()
          }}
        >
          Details
        </button>
        <button
          className={`parts-star ${favourite ? 'on' : ''}`}
          aria-pressed={favourite}
          aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
          title={favourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => useShelf.getState().toggleFavourite(part.id)}
        >
          {favourite ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
}
