import { useCallback, useEffect, useRef } from 'react'
import type { CataloguePart } from '../../catalogue'
import { PartSketch } from './PartSketch'
import { defaultView, renderPart, usePartThumbnail, type PreviewView } from './render'

export function PartThumb({
  part,
  className,
  width = 46,
  height = 36,
}: {
  part: CataloguePart
  className?: string
  width?: number
  height?: number
}) {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const url = usePartThumbnail(part, Math.round(width * ratio), Math.round(height * ratio))
  return url ? (
    <img className={className} src={url} alt="" draggable={false} />
  ) : (
    <PartSketch part={part} className={className} />
  )
}

export function PartPreview({
  part,
  className,
  radius = 0,
}: {
  part: CataloguePart
  className?: string
  radius?: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<PreviewView>(defaultView(part))
  const drag = useRef<{ x: number; y: number; start: PreviewView } | null>(null)
  const frame = useRef(0)

  const draw = useCallback(() => {
    frame.current = 0
    const target = canvas.current
    if (!target) return
    const rect = target.getBoundingClientRect()
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (rect.width < 1 || rect.height < 1) return
    if (target.width !== width) target.width = width
    if (target.height !== height) target.height = height
    const source = renderPart(part, width, height, view.current, radius)
    const context = target.getContext('2d')
    if (!source || !context) return
    context.clearRect(0, 0, width, height)
    context.drawImage(source, 0, 0)
  }, [part, radius])

  const redraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw)
  }, [draw])

  useEffect(() => {
    view.current = defaultView(part)
    draw()
  }, [part, draw])

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(target)
    return () => {
      observer.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [draw])

  return (
    <canvas
      ref={canvas}
      className={`part-preview ${className ?? ''}`}
      title="Drag to turn it round. Double-click to reset the view."
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, start: { ...view.current } }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (!start) return
        view.current = {
          yaw: start.start.yaw - (e.clientX - start.x) * 0.012,
          pitch: Math.max(-1.45, Math.min(1.45, start.start.pitch + (e.clientY - start.y) * 0.012)),
        }
        redraw()
      }}
      onPointerUp={(e) => {
        drag.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onDoubleClick={() => {
        view.current = defaultView(part)
        redraw()
      }}
    />
  )
}
