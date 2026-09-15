import { objectActions } from './ObjectMenu'
import { chooseAction } from './ActionDialog'

export function WorkspaceWelcome({ onCatalogue }: { onCatalogue: () => void }) {
  const box = objectActions({ kind: 'none' }).find((a) => a.id === 'add-box')!
  const sketch = objectActions({ kind: 'none' }).find((a) => a.id === 'sketch-XY')!
  return <div className="workspace-welcome"><span className="eyebrow">YOUR NEXT BUILD STARTS HERE</span>
    <h1>Make room for<br />your ideas.</h1><p>Start with a shape, draw your own,<br />or build around a real component.</p>
    <div className="start-cards">
      <button onClick={() => chooseAction(box)}><span>▱</span><strong>Create a solid</strong><small>Box, cylinder or custom shape</small><b>01 →</b></button>
      <button onClick={() => chooseAction(sketch)}><span>▧</span><strong>Draw a sketch</strong><small>Exact dimensions, your outline</small><b>02 →</b></button>
      <button onClick={onCatalogue}><span>⊞</span><strong>Add hardware</strong><small>Boards, controls and fasteners</small><b>03 →</b></button>
    </div>
    <div className="welcome-tip">Orbit: drag · Pan: right-drag · Zoom: scroll · Fit: F</div>
  </div>
}
