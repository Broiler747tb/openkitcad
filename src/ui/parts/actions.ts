import type { DragEvent } from 'react'
import { getPart } from '../../catalogue'
import { useStore } from '../../doc/store'
import type { Matrix4 } from '../../doc/types'
import { useShelf } from './shelf'

export const PART_MIME = 'application/x-openkitcad-part'

let dragged: string | null = null

export function draggedPart(): string | null {
  return dragged
}

export function startPartDrag(event: DragEvent, partId: string) {
  dragged = partId
  event.dataTransfer.setData(PART_MIME, partId)
  event.dataTransfer.effectAllowed = 'copy'
}

export function endPartDrag() {
  dragged = null
  window.dispatchEvent(new CustomEvent('okc:part-drag-end'))
}

export function placePart(partId: string, transform?: Matrix4): string | null {
  const part = getPart(partId)
  if (!part) return null
  const store = useStore.getState()
  const id = store.insertCatalogue(partId, transform)
  useShelf.getState().noteUsed(partId)
  store.setStatus(
    transform
      ? `${part.name} placed where you dropped it. Drag the arrows or type a position in Properties to adjust.`
      : `${part.name} inserted at the origin. Next time, drag it straight onto a face.`,
  )
  if (!transform) window.dispatchEvent(new CustomEvent('okc:fit'))
  return id
}

export function partUses(partId: string): number {
  const doc = useStore.getState().doc
  const components = new Set(
    doc.components
      .filter((c) => c.source.kind === 'catalogue' && c.source.partId === partId)
      .map((c) => c.id),
  )
  return doc.occurrences.filter((o) => components.has(o.componentId)).length
}
