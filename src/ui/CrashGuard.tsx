import { Component, type ReactNode } from 'react'
import { useStore } from '../doc/store'
import { useCommand } from './command/session'

interface CrashState {
  error: Error | null
}

export class CrashGuard extends Component<{ children: ReactNode }, CrashState> {
  state: CrashState = { error: null }

  static getDerivedStateFromError(error: unknown): CrashState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  undo = () => {
    useCommand.getState().cancel()
    const store = useStore.getState()
    if (store.transientBase) store.cancelTransient()
    else store.undo()
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const store = useStore.getState()
    const canUndo = store.past.length > 0 || !!store.transientBase
    return (
      <div className="overlay-centre crash-card" role="alert">
        <div>
          <h2>Something went wrong</h2>
          <p>{error.message || 'The app stopped drawing.'}</p>
          <div className="crash-actions">
            <button className="btn" disabled={!canUndo} onClick={this.undo}>
              Undo last change
            </button>
            <button className="btn" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
