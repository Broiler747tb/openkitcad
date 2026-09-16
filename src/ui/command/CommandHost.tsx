import { CommandPanel } from './CommandPanel'
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
      onPreview={(preview) => useCommand.getState().show(preview.valid ? preview.features : null)}
      onCommit={({ features }) => useCommand.getState().commit(features)}
      onCancel={() => useCommand.getState().cancel()}
      problem={problem ? `${problem.message}${problem.hint ? ` ${problem.hint}` : ''}` : null}
    />
  )
}
