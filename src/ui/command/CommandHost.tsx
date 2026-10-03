import { CommandPanel } from './CommandPanel'
import { t } from '../../i18n'
import { useCommand } from './session'

export function CommandHost() {
  const session = useCommand((s) => s.session)
  const errors = useCommand((s) => s.preview?.errors)
  if (!session) return null
  const problem = errors?.find((error) => error.severity === 'error')
  return (
    <CommandPanel
      key={session.serial}
      spec={session.spec}
      context={session.context}
      state={session.state}
      dispatch={(action) => useCommand.getState().dispatch(action)}
      onPreview={(preview) =>
        useCommand.getState().show(preview.valid ? preview.features : null, preview.values)
      }
      onCommit={({ features, values }) => useCommand.getState().commit(features, values)}
      onCancel={() => useCommand.getState().cancel()}
      problem={problem ? `${t(problem.message)}${problem.hint ? ` ${t(problem.hint)}` : ''}` : null}
    />
  )
}
