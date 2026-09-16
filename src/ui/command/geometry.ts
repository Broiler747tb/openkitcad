export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Offset {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function clampPanelOffset(
  offset: Offset,
  base: Box,
  container: Box,
  keepVisible: number,
): Offset {
  const height = base.bottom - base.top
  return {
    x: clamp(offset.x, container.left - base.left, container.right - base.right),
    y: clamp(
      offset.y,
      container.top - base.top,
      container.bottom - base.top - Math.min(Math.max(keepVisible, 0), height),
    ),
  }
}

export function shiftBox(box: Box, offset: Offset): Box {
  return {
    left: box.left + offset.x,
    top: box.top + offset.y,
    right: box.right + offset.x,
    bottom: box.bottom + offset.y,
  }
}
