import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Feature } from '../../doc/types'
import { clampPanelOffset, type Box, type Offset } from './geometry'
import {
  createCommandState,
  evaluateCommand,
  reduceCommand,
  selectionSummary,
  type CommandAction,
  type CommandEvaluation,
  type CommandState,
  type FieldState,
} from './state'
import type {
  AnyCommandSpec,
  ChoiceInput,
  CommandContext,
  CommandInitialValues,
  CommandInput,
  CommandValue,
  SelectionInput,
} from './types'

export interface CommandPreview {
  values: Record<string, CommandValue>
  features: Feature[] | null
  valid: boolean
  fieldErrors: Record<string, string>
  formError: string | null
  buildError: string | null
}

export interface CommandCommit {
  values: Record<string, CommandValue>
  features: Feature[]
}

export interface CommandPanelProps {
  spec: AnyCommandSpec
  context: CommandContext
  initial?: CommandInitialValues
  state?: CommandState
  dispatch?: (action: CommandAction) => void
  onPreview?: (preview: CommandPreview) => void
  previewDelay?: number
  onCommit: (commit: CommandCommit) => void
  onCancel: () => void
  keyboard?: 'window' | 'panel'
  defaultCollapsed?: boolean
  okLabel?: string
  problem?: string | null
  cancelLabel?: string
  className?: string
  style?: CSSProperties
}

interface DragSession {
  pointerId: number
  startX: number
  startY: number
  origin: Offset
  base: Box
  container: Box
  keepVisible: number
}

export const DEFAULT_PREVIEW_DELAY = 150

function previewOf(evaluation: CommandEvaluation): CommandPreview {
  return {
    values: evaluation.values,
    features: evaluation.features,
    valid: evaluation.valid,
    fieldErrors: evaluation.fieldErrors,
    formError: evaluation.formError,
    buildError: evaluation.buildError,
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={collapsed ? 'M2 3.5 L5 6.5 L8 3.5' : 'M2 6.5 L5 3.5 L8 6.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PickIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 1.5 L2 10 L4.6 7.6 L6.4 11 L7.9 10.2 L6.2 6.9 L9.6 6.6 Z" fill="currentColor" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1 1 L7 7 M7 1 L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

interface RowProps {
  input: CommandInput
  field: FieldState | undefined
  error: string | undefined
  active: boolean
  dispatch: (action: CommandAction) => void
  rowId: string
}

function SelectionControl({
  input,
  field,
  active,
  dispatch,
  labelId,
  rowId,
}: {
  input: SelectionInput
  field: FieldState | undefined
  active: boolean
  dispatch: (action: CommandAction) => void
  labelId: string
  rowId: string
}) {
  const picks = field?.kind === 'selection' ? field.picks : []
  const waiting = active && picks.length < input.min
  return (
    <div className="okc-cmd-selection">
      <button
        type="button"
        className="okc-cmd-pick"
        aria-pressed={active}
        aria-labelledby={`${labelId} ${rowId}-summary`}
        data-state={waiting ? 'waiting' : picks.length ? 'filled' : 'empty'}
        title={picks.map((pick) => pick.label).join(', ') || input.hint}
        onClick={() => dispatch({ type: 'activate', id: input.id })}
      >
        <PickIcon />
        <span id={`${rowId}-summary`}>{selectionSummary(input, picks)}</span>
      </button>
      {input.clearable !== false && picks.length > 0 && (
        <button
          type="button"
          className="okc-cmd-clear"
          aria-label={`Clear ${input.label}`}
          onClick={() => dispatch({ type: 'clear', id: input.id })}
        >
          <CrossIcon />
        </button>
      )}
    </div>
  )
}

function ChoiceControl({
  input,
  value,
  dispatch,
  labelId,
}: {
  input: ChoiceInput
  value: string
  dispatch: (action: CommandAction) => void
  labelId: string
}) {
  if (input.display === 'buttons') {
    return (
      <div className="okc-cmd-segments" role="radiogroup" aria-labelledby={labelId}>
        {input.options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.hint}
            onClick={() => dispatch({ type: 'choice', id: input.id, value: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <select
      className="okc-cmd-dropdown"
      aria-labelledby={labelId}
      value={value}
      onChange={(event) => dispatch({ type: 'choice', id: input.id, value: event.target.value })}
    >
      {input.options.map((option) => (
        <option key={option.value} value={option.value} title={option.hint}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function InputRow({ input, field, error, active, dispatch, rowId }: RowProps) {
  const labelId = `${rowId}-label`
  const errorId = `${rowId}-error`
  let control
  switch (input.kind) {
    case 'selection':
      control = (
        <SelectionControl
          input={input}
          field={field}
          active={active}
          dispatch={dispatch}
          labelId={labelId}
          rowId={rowId}
        />
      )
      break
    case 'length':
    case 'angle':
    case 'integer':
    case 'number': {
      const text = field && 'text' in field ? field.text : ''
      control = (
        <div className="okc-cmd-number">
          <input
            className="okc-cmd-input"
            type="text"
            inputMode={input.kind === 'integer' ? 'numeric' : 'decimal'}
            spellCheck={false}
            autoComplete="off"
            aria-labelledby={labelId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            value={text}
            onChange={(event) => dispatch({ type: 'text', id: input.id, text: event.target.value })}
            onFocus={(event) => event.currentTarget.select()}
          />
          {input.kind === 'integer' && (
            <span className="okc-cmd-stepper">
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Increase ${input.label}`}
                onClick={() => dispatch({ type: 'step', id: input.id, delta: 1 })}
              >
                <ChevronIcon collapsed={false} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Decrease ${input.label}`}
                onClick={() => dispatch({ type: 'step', id: input.id, delta: -1 })}
              >
                <ChevronIcon collapsed />
              </button>
            </span>
          )}
        </div>
      )
      break
    }
    case 'choice':
      control = (
        <ChoiceControl
          input={input}
          value={field?.kind === 'choice' ? field.value : ''}
          dispatch={dispatch}
          labelId={labelId}
        />
      )
      break
    case 'toggle':
      control = (
        <input
          className="okc-cmd-checkbox"
          type="checkbox"
          aria-labelledby={labelId}
          checked={field?.kind === 'toggle' ? field.value : false}
          onChange={(event) =>
            dispatch({ type: 'toggle', id: input.id, value: event.target.checked })
          }
        />
      )
      break
  }
  return (
    <div
      className="okc-cmd-row"
      data-okc-input={input.kind}
      data-okc-input-id={input.id}
      data-active={active ? 'true' : undefined}
      data-invalid={error ? 'true' : undefined}
    >
      <span className="okc-cmd-label" id={labelId} title={input.hint}>
        {input.label}
      </span>
      <div className="okc-cmd-control">{control}</div>
      {error && (
        <div className="okc-cmd-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export function CommandPanel(props: CommandPanelProps) {
  const {
    spec,
    context,
    initial,
    onPreview,
    previewDelay = DEFAULT_PREVIEW_DELAY,
    keyboard = 'window',
    defaultCollapsed = false,
    okLabel = 'OK',
    cancelLabel = 'Cancel',
    className,
    style,
  } = props
  const baseId = useId()
  const contextRef = useRef(context)
  contextRef.current = context
  const [ownState, ownDispatch] = useReducer(
    (current: CommandState, action: CommandAction) =>
      reduceCommand(spec, current, action, contextRef.current),
    undefined,
    () => createCommandState(spec, context, initial),
  )
  const state = props.state ?? ownState
  const dispatch = props.dispatch ?? ownDispatch
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [buildError, setBuildError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const callbacks = useRef(props)
  callbacks.current = props

  const evaluation = useMemo(
    () => evaluateCommand(spec, state, context),
    [spec, state, context.unit, context.variable, context.componentId],
  )

  useEffect(() => {
    if (!callbacks.current.onPreview) return
    const timer = setTimeout(() => {
      timerRef.current = null
      const result = evaluateCommand(spec, stateRef.current, contextRef.current, { build: true })
      setBuildError(result.buildError)
      callbacks.current.onPreview?.(previewOf(result))
    }, previewDelay)
    timerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (timerRef.current === timer) timerRef.current = null
    }
  }, [
    spec,
    state,
    previewDelay,
    !!onPreview,
    context.unit,
    context.variable,
    context.componentId,
    context.editingFeatureId,
  ])

  const commit = () => {
    const result = evaluateCommand(spec, stateRef.current, contextRef.current, { build: true })
    if (!result.valid) return false
    if (!result.features) {
      setBuildError(result.buildError ?? 'The command could not be built.')
      return false
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    callbacks.current.onCommit({ values: result.values, features: result.features })
    return true
  }

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    callbacks.current.onCancel()
  }

  const handleKey = (event: KeyboardEvent | ReactKeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const native = 'nativeEvent' in event ? event.nativeEvent : event
    if (native.isComposing) return
    const target = event.target as Element | null
    const inside = !!target && !!panelRef.current?.contains(target)
    if (!inside && isEditable(target)) return
    if (
      event.key === 'Enter' &&
      inside &&
      target &&
      ['BUTTON', 'SELECT', 'TEXTAREA'].includes(target.tagName)
    ) {
      return
    }
    event.preventDefault()
    if (event.key === 'Enter') commit()
    else cancel()
  }
  const keyRef = useRef(handleKey)
  keyRef.current = handleKey

  useEffect(() => {
    if (keyboard !== 'window' || typeof window === 'undefined') return
    const listener = (event: KeyboardEvent) => keyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [keyboard])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const onTitlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as Element).closest('button')) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const parent = panel.offsetParent
    const container: Box = parent
      ? parent.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
      base: {
        left: rect.left - offset.x,
        top: rect.top - offset.y,
        right: rect.right - offset.x,
        bottom: rect.bottom - offset.y,
      },
      container,
      keepVisible: event.currentTarget.offsetHeight,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const onTitlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(
      clampPanelOffset(
        {
          x: drag.origin.x + event.clientX - drag.startX,
          y: drag.origin.y + event.clientY - drag.startY,
        },
        drag.base,
        drag.container,
        drag.keepVisible,
      ),
    )
  }

  const onTitlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const toggleCollapsed = () => setCollapsed((value) => !value)
  const hintId = `${baseId}-hint`
  const message =
    evaluation.formError ?? (evaluation.valid ? (buildError ?? props.problem ?? null) : null)
  const tone = evaluation.formError ? 'warning' : 'error'

  return (
    <div
      ref={panelRef}
      className={['okc-cmd', className].filter(Boolean).join(' ')}
      style={{ ...style, transform: `translate(${offset.x}px, ${offset.y}px)` }}
      role="dialog"
      aria-label={spec.label}
      aria-describedby={collapsed ? undefined : hintId}
      data-okc-command={spec.id}
      data-collapsed={collapsed ? 'true' : undefined}
      onKeyDown={keyboard === 'panel' ? handleKey : undefined}
    >
      <div
        className="okc-cmd-title"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
        onDoubleClick={toggleCollapsed}
      >
        {spec.icon && (
          <span className="okc-cmd-icon" aria-hidden="true">
            {spec.icon}
          </span>
        )}
        <span className="okc-cmd-name">{spec.label}</span>
        <button
          type="button"
          className="okc-cmd-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${spec.label}` : `Collapse ${spec.label}`}
          onClick={toggleCollapsed}
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>
      {!collapsed && (
        <>
          <p className="okc-cmd-hint" id={hintId}>
            {spec.hint}
          </p>
          <div className="okc-cmd-body">
            {spec.inputs.map((input, index) =>
              evaluation.hidden.includes(input.id) ? null : (
                <InputRow
                  key={input.id}
                  input={input}
                  field={state.fields[input.id]}
                  error={evaluation.fieldErrors[input.id]}
                  active={state.active === input.id}
                  dispatch={dispatch}
                  rowId={`${baseId}-${index}`}
                />
              ),
            )}
          </div>
          {message && (
            <div className="okc-cmd-message" role="status" data-tone={tone}>
              {message}
            </div>
          )}
          <div className="okc-cmd-footer">
            <button
              type="button"
              className="okc-cmd-button okc-cmd-ok"
              data-okc-action="ok"
              disabled={!evaluation.valid}
              onClick={commit}
            >
              {okLabel}
            </button>
            <button
              type="button"
              className="okc-cmd-button okc-cmd-cancel"
              data-okc-action="cancel"
              onClick={cancel}
            >
              {cancelLabel}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
