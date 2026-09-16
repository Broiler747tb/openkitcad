import type { Vec2 } from '../core/math'
import { activeSketchFeature, newId, useStore } from '../doc/store'
import { circularPattern, linearPattern } from '../sketch/edit'
import { moveEntities, scaleEntities, type ModifyResult } from '../sketch/modify'
import { copyTransformed } from '../sketch/power'
import type { Sketch2D } from '../sketch/types'
import type { ObjectAction } from './ObjectMenu'

export function sketchEdit(label: string, edit: (sketch: Sketch2D) => ModifyResult): boolean {
  const store = useStore.getState()
  const sketch = activeSketchFeature(store)?.sketch
  if (!sketch) return false
  let trial: ModifyResult
  try {
    trial = edit(structuredClone(sketch))
  } catch (error) {
    trial = { ok: false, message: (error as Error).message }
  }
  if (!trial.ok) {
    store.setStatus(trial.message ? `${label}: ${trial.message}` : `${label} could not be applied.`)
    return false
  }
  store.editSketch((draft) => {
    edit(draft)
  })
  store.solveActiveSketch()
  return true
}

function selectedEntities(): string[] {
  return useStore
    .getState()
    .sketchSelection.filter((target) => target.kind === 'entity')
    .map((target) => target.id)
}

function selectionCentre(sketch: Sketch2D, ids: readonly string[]): Vec2 {
  const used = new Set<string>()
  for (const entity of sketch.entities) {
    if (!ids.includes(entity.id)) continue
    for (const value of entity.kind === 'spline' ? entity.points : Object.values(entity)) {
      if (typeof value === 'string') used.add(value)
    }
  }
  const points = sketch.points.filter((p) => used.has(p.id))
  if (!points.length) return [0, 0]
  return [
    points.reduce((sum, p) => sum + p.x, 0) / points.length,
    points.reduce((sum, p) => sum + p.y, 0) / points.length,
  ]
}

export function moveCopyAction(): ObjectAction {
  return {
    id: 'sketch-move-copy',
    label: 'Move/Copy',
    group: 'Modify',
    hint: 'Moves or copies the selected sketch geometry by a distance and angle.',
    prompt: { label: 'X distance', initial: 10, unit: 'mm' },
    prompt2: { label: 'Y distance', initial: 0, unit: 'mm' },
    prompt3: { label: 'Angle', initial: 0, unit: 'deg' },
    choice: {
      label: 'Mode',
      initial: 'move',
      options: [
        { value: 'move', label: 'Move', hint: 'The geometry itself moves.' },
        { value: 'copy', label: 'Copy', hint: 'A copy moves; the original stays.' },
      ],
    },
    run: (dx, dy = 0, angle = 0, mode) => {
      const ids = selectedEntities()
      if (!ids.length) {
        useStore.getState().setStatus('Move/Copy: select sketch geometry first.')
        return
      }
      sketchEdit('Move/Copy', (sketch) => {
        const centre = selectionCentre(sketch, ids)
        if (mode === 'copy') {
          copyTransformed(sketch, ids, { dx, dy, angle, scale: 1, centre, count: 1 }, newId)
          return { ok: true }
        }
        return moveEntities(sketch, ids, [dx, dy], angle, centre)
      })
    },
  }
}

export function scaleAction(): ObjectAction {
  return {
    id: 'sketch-scale',
    label: 'Sketch Scale',
    group: 'Modify',
    hint: 'Grows or shrinks the selected geometry and its dimensions together.',
    prompt: { label: 'Scale factor', initial: 2, unit: '×' },
    choice: {
      label: 'Point',
      initial: 'origin',
      options: [
        { value: 'origin', label: 'Sketch origin' },
        { value: 'centre', label: 'Centre of the selection' },
      ],
    },
    run: (factor, _b, _c, pivot) => {
      const ids = selectedEntities()
      if (!ids.length) {
        useStore.getState().setStatus('Sketch Scale: select sketch geometry first.')
        return
      }
      sketchEdit('Sketch Scale', (sketch) =>
        scaleEntities(
          sketch,
          ids,
          pivot === 'centre' ? selectionCentre(sketch, ids) : [0, 0],
          factor,
        ),
      )
    },
  }
}

export function rectangularPatternAction(): ObjectAction {
  return {
    id: 'sketch-rectangular-pattern',
    label: 'Rectangular Pattern',
    group: 'Create',
    hint: 'Repeats the selected geometry in rows and columns.',
    prompt: { label: 'Quantity across', initial: 3, unit: '' },
    prompt2: { label: 'Spacing across', initial: 10, unit: 'mm' },
    prompt3: { label: 'Quantity up', initial: 1, unit: '' },
    run: (across, spacing = 10, up = 1) => {
      const ids = selectedEntities()
      if (!ids.length) {
        useStore.getState().setStatus('Rectangular Pattern: select sketch geometry first.')
        return
      }
      sketchEdit('Rectangular Pattern', (sketch) => {
        const columns = Math.round(across)
        const rows = Math.round(up)
        const before = new Set(sketch.entities.map((e) => e.id))
        if (columns >= 2) {
          const result = linearPattern(sketch, ids, { count: columns, dx: spacing, dy: 0 }, newId)
          if (!result.ok) return result
        }
        if (rows >= 2) {
          const row = sketch.entities.filter((e) => !before.has(e.id) || ids.includes(e.id))
          const result = linearPattern(
            sketch,
            row.map((e) => e.id),
            { count: rows, dx: 0, dy: spacing },
            newId,
          )
          if (!result.ok) return result
        }
        return columns >= 2 || rows >= 2
          ? { ok: true }
          : { ok: false, message: 'Ask for at least two copies across or up.' }
      })
    },
  }
}

export function circularPatternAt(centre: Vec2): ObjectAction {
  return {
    id: 'sketch-circular-pattern',
    label: 'Circular Pattern',
    group: 'Create',
    hint: 'Repeats the selected geometry around the point you clicked.',
    prompt: { label: 'Quantity', initial: 6, unit: '' },
    prompt2: { label: 'Angle', initial: 360, unit: 'deg' },
    run: (count, angle = 360) => {
      const ids = selectedEntities()
      if (!ids.length) {
        useStore.getState().setStatus('Circular Pattern: select sketch geometry first.')
        return
      }
      sketchEdit('Circular Pattern', (sketch) =>
        circularPattern(
          sketch,
          ids,
          { count: Math.round(count), centre, totalAngle: angle },
          newId,
        ),
      )
    },
  }
}
