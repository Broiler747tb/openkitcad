import { activeSketchFeature, useStore } from '../doc/store'
import { sketchActions, SKETCH_GROUP_ORDER, type SketchAction } from '../sketch/actions'
import type { Vec2 } from '../core/math'
import { ContextMenu, type MenuRect } from './ContextMenu'
import { chooseSketchAction } from './ActionDialog'
export function SketchMenu({
  x,
  y,
  cursor,
  onClose,
  avoid,
  onPick,
}: {
  x: number
  y: number
  cursor?: Vec2
  onClose: () => void
  avoid?: MenuRect | null
  onPick?: (action: SketchAction) => void
}) {
  const state = useStore()
  const sketch = activeSketchFeature(state)?.sketch
  const actions = sketch ? sketchActions(sketch, state.sketchSelection, cursor) : []
  return (
    <ContextMenu
      x={x}
      y={y}
      avoid={avoid}
      actions={actions}
      order={SKETCH_GROUP_ORDER}
      onClose={onClose}
      onPick={(action) => {
        onClose()
        if (onPick) onPick(action)
        else chooseSketchAction(action)
      }}
    />
  )
}
