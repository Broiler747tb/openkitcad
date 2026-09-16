import { useCallback, useMemo, useReducer, useRef } from 'react'
import {
  activePrompt,
  createCommandState,
  evaluateCommand,
  reduceCommand,
  type CommandAction,
  type CommandEvaluation,
  type CommandState,
} from './state'
import type { AnyCommandSpec, CommandContext, CommandInitialValues, SelectionPick } from './types'

export interface CommandSession {
  state: CommandState
  dispatch: (action: CommandAction) => void
  evaluation: CommandEvaluation
  prompt: string | null
  pick: (pick: SelectionPick) => void
  reset: (initial?: CommandInitialValues) => void
}

export function useCommandSession(
  spec: AnyCommandSpec,
  context: CommandContext,
  initial?: CommandInitialValues,
): CommandSession {
  const contextRef = useRef(context)
  contextRef.current = context
  const [state, dispatch] = useReducer(
    (current: CommandState, action: CommandAction) =>
      reduceCommand(spec, current, action, contextRef.current),
    undefined,
    () => createCommandState(spec, context, initial),
  )
  const evaluation = useMemo(
    () => evaluateCommand(spec, state, context),
    [spec, state, context.unit, context.variable, context.componentId],
  )
  const pick = useCallback((value: SelectionPick) => dispatch({ type: 'pick', pick: value }), [])
  const reset = useCallback(
    (values?: CommandInitialValues) =>
      dispatch({
        type: 'replace',
        state: createCommandState(spec, contextRef.current, values ?? initial),
      }),
    [spec, initial],
  )
  return { state, dispatch, evaluation, prompt: activePrompt(spec, state), pick, reset }
}
