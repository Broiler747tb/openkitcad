import { activeSketchFeature, newId, useStore } from '../doc/store'
import {
  constraintTool,
  resolveConstraint,
  toggleFixes,
  type ConstraintToolId,
} from '../sketch/constraintTools'
import type { SketchTarget } from '../sketch/inference'

export function runConstraintTool(
  id: ConstraintToolId,
  targets: readonly SketchTarget[],
): 'done' | 'more' | 'invalid' {
  const store = useStore.getState()
  const sketch = activeSketchFeature(store)?.sketch
  const spec = constraintTool(id)
  if (!sketch || !spec) return 'invalid'
  const picks = targets.filter((target) => target.kind !== 'constraint')
  const outcome = resolveConstraint(sketch, id, picks)
  switch (outcome.kind) {
    case 'more':
      store.setSketchSelection([...picks])
      store.setStatus(`${spec.label}: ${outcome.prompt}`)
      return 'more'
    case 'invalid':
      store.setSketchSelection([])
      store.setStatus(outcome.message)
      return 'invalid'
    case 'toggleFix': {
      let result = ''
      store.editSketch((draft) => {
        result = toggleFixes(draft, outcome.points, newId)
      })
      store.solveActiveSketch()
      store.setSketchSelection([])
      store.setStatus(result === 'released' ? 'Released.' : 'Fixed in place.')
      return 'done'
    }
    case 'apply':
      store.editSketch((draft) => {
        for (const constraint of outcome.constraints) {
          draft.constraints.push({ ...constraint, id: newId('c') } as never)
        }
      })
      store.solveActiveSketch()
      store.setSketchSelection([])
      store.setStatus(`${spec.label} added.`)
      return 'done'
  }
}

export function startConstraintTool(id: ConstraintToolId) {
  const store = useStore.getState()
  const picks = store.sketchSelection.filter((target) => target.kind !== 'constraint')
  if (picks.length && runConstraintTool(id, picks) === 'done') return
  store.setTool(`constrain:${id}`)
  const spec = constraintTool(id)
  if (spec && !useStore.getState().sketchSelection.length) {
    store.setStatus(`${spec.label}: ${spec.prompt}`)
  }
}
