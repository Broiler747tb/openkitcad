import { useStore } from '../doc/store'
import { selectedObjectActions, extrusionAction } from './workflow'
import { chooseAction } from './ActionDialog'
import { FlyoutMenu } from './FlyoutMenu'

export function SelectionActions() {
  const state = useStore()
  if (state.activeSketch || state.selection.kind === 'none') return null
  const actions = selectedObjectActions()
  const extrude = extrusionAction()
  return <div className="selection-actions section">
    <span className="eyebrow">ACTIONS FOR SELECTION</span>
    {extrude && <button className="primary-button" onClick={() => chooseAction(extrude)}>Extrude sketch</button>}
    <FlyoutMenu actions={actions} onPick={chooseAction} />
  </div>
}
