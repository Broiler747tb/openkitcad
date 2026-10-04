import type { CataloguePart } from './types'

export function prototypingHoles(part: CataloguePart): Array<[number, number]> {
  const g = part.geometry
  if (part.category !== 'proto' || g.kind !== 'board' || g.outline.shape !== 'rect') return []
  const { w, h } = g.outline
  const points: Array<[number, number]> = []
  const row = (count: number, y: number) => {
    const start = (w - (count - 1) * 2.54) / 2
    for (let i = 0; i < count; i++) points.push([start + i * 2.54, y])
  }
  if (part.id.startsWith('proto-breadboard')) {
    const full = part.id.endsWith('830')
    for (let i = 0; i < 5; i++) {
      row(full ? 63 : 30, h / 2 - 3.81 - i * 2.54)
      row(full ? 63 : 30, h / 2 + 3.81 + i * 2.54)
    }
    for (const y of [5, 7.54, h - 7.54, h - 5]) row(full ? 50 : 25, y)
  } else {
    const rows = Math.floor((h - 5.08) / 2.54) + 1
    const cols = Math.floor((w - 5.08) / 2.54) + 1
    for (let i = 0; i < rows; i++) row(cols, (h - (rows - 1) * 2.54) / 2 + i * 2.54)
  }
  return points
}
