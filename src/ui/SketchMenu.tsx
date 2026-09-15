import { activeSketchFeature, useStore } from '../doc/store'
import { sketchActions, SKETCH_GROUP_ORDER } from '../sketch/actions'
import type { Vec2 } from '../core/math'
import { ContextMenu } from './ContextMenu'
import { chooseSketchAction } from './ActionDialog'
export function SketchMenu({ x, y, cursor, onClose }: { x: number; y: number; cursor?: Vec2; onClose: () => void }) {
  const state = useStore()
  const sketch = activeSketchFeature(state)?.sketch
  const actions = sketch ? sketchActions(sketch, state.sketchSelection, cursor) : []
  return <ContextMenu x={x} y={y} actions={actions} order={SKETCH_GROUP_ORDER} onClose={onClose}
    onPick={(action) => { onClose(); chooseSketchAction(action) }} />
}
