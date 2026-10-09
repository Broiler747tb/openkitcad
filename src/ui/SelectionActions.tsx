import { t } from '../i18n'
import { useStore } from '../doc/store'
import { selectedObjectActions, extrusionAction } from './workflow'
import { chooseAction } from './ActionDialog'
import { FlyoutMenu } from './FlyoutMenu'
import { MoveObjectIcon, RotateObjectIcon, HoleObjectIcon } from './icons/ObjectActions'

export function SelectionActions({ compact = false }: { compact?: boolean }) {
  const state = useStore()
  if (state.activeSketch || state.selection.kind === 'none') return null
  const actions = selectedObjectActions()
  const extrude = extrusionAction()
  const revolve = extrusionAction(true)
  return (
    <div className="selection-actions section">
      <span className="eyebrow">{t('ACTIONS FOR SELECTION')}</span>
      <div className="object-action-shortcuts">
        {actions
          .filter((action) => ['move', 'turn', 'negative'].includes(action.id))
          .map((action) => {
            const Icon =
              action.id === 'move'
                ? MoveObjectIcon
                : action.id === 'turn'
                  ? RotateObjectIcon
                  : HoleObjectIcon
            return (
              <button
                key={action.id}
                title={t(action.hint ?? action.label)}
                onClick={() => chooseAction(action)}
              >
                <Icon className="okc-icon" />
                <span>{t(action.label)}</span>
              </button>
            )
          })}
      </div>
      {extrude && (
        <button
          className="primary-button"
          title={t(extrude.hint)}
          onClick={() => chooseAction(extrude)}
        >
          {t('Extrude')}
        </button>
      )}
      {revolve && (
        <button className="tb" onClick={() => chooseAction(revolve)}>
          {t('Revolve')}
        </button>
      )}
      {compact ? (
        actions
          .filter(
            (action) => action.recommended && !['move', 'turn', 'negative'].includes(action.id),
          )
          .map((action) => (
            <button
              className="tb"
              key={action.id}
              title={t(action.hint)}
              onClick={() => chooseAction(action)}
            >
              {t(action.label)}
            </button>
          ))
      ) : (
        <FlyoutMenu
          actions={actions.filter((action) => !['move', 'turn', 'negative'].includes(action.id))}
          onPick={chooseAction}
        />
      )}
    </div>
  )
}
