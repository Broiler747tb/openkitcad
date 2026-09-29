import { CommandPanel } from './CommandPanel'
import { useCommand } from './session'

export function CommandHost() {
  const session = useCommand((s) => s.session)
  const errors = useCommand((s) => s.preview?.errors)
  const featureIds = useCommand((s) => s.preview?.featureIds)
  if (!session) return null
  const own = errors?.find(
    (error) => error.severity === 'error' && featureIds?.includes(error.featureId),
  )
  const problem = own ?? errors?.find((error) => error.severity === 'error')
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
      problem={problem ? `${problem.message}${problem.hint ? ` ${problem.hint}` : ''}` : null}
      blocked={!!own}
    />
  )
}
