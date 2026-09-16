import type { Feature } from '../../doc/types'
import type {
  AnyCommandSpec,
  ChoiceInput,
  CommandContext,
  CommandInitialValues,
  CommandInput,
  CommandValue,
  NumericInput,
  SelectionInput,
  SelectionPick,
} from './types'
import {
  formatAngle,
  formatInteger,
  formatLength,
  parseAngle,
  formatNumber,
  parseInteger,
  parseLength,
  parseNumber,
} from './units'

export type NumericFieldState = { kind: 'length' | 'angle' | 'integer' | 'number'; text: string }

export type FieldState =
  | { kind: 'selection'; picks: SelectionPick[] }
  | NumericFieldState
  | { kind: 'choice'; value: string }
  | { kind: 'toggle'; value: boolean }

export interface CommandState {
  fields: Record<string, FieldState>
  active: string | null
}

export type CommandAction =
  | { type: 'text'; id: string; text: string }
  | { type: 'choice'; id: string; value: string }
  | { type: 'toggle'; id: string; value: boolean }
  | { type: 'pick'; pick: SelectionPick; id?: string }
  | { type: 'unpick'; id: string; pick: SelectionPick }
  | { type: 'setPicks'; id: string; picks: SelectionPick[] }
  | { type: 'clear'; id: string }
  | { type: 'activate'; id: string | null }
  | { type: 'step'; id: string; delta: number }
  | { type: 'replace'; state: CommandState }

export interface CommandEvaluation {
  values: Record<string, CommandValue>
  fieldErrors: Record<string, string>
  missing: string[]
  hidden: string[]
  formError: string | null
  valid: boolean
  features: Feature[] | null
  buildError: string | null
}

export type UnitContext = Pick<CommandContext, 'unit' | 'variable'>

const DEFAULT_UNITS: UnitContext = { unit: 'mm' }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function findInput(spec: AnyCommandSpec, id: string): CommandInput | undefined {
  return spec.inputs.find((input) => input.id === id)
}

export function acceptsPick(input: SelectionInput, pick: SelectionPick): boolean {
  return input.filter.includes(pick.kind)
}

export function samePick(a: SelectionPick, b: SelectionPick): boolean {
  return a.kind === b.kind && a.id === b.id && (a.instanceId ?? '') === (b.instanceId ?? '')
}

function uniquePicks(picks: readonly SelectionPick[]): SelectionPick[] {
  const out: SelectionPick[] = []
  for (const pick of picks) if (!out.some((existing) => samePick(existing, pick))) out.push(pick)
  return out
}

function defaultChoice(input: ChoiceInput): string {
  return input.default ?? input.options[0]?.value ?? ''
}

function formatNumeric(input: NumericInput, value: number, units: UnitContext): string {
  if (input.kind === 'length') return formatLength(value, units.unit)
  if (input.kind === 'angle') return formatAngle(value)
  if (input.kind === 'number') return formatNumber(value, 4)
  return formatInteger(value)
}

function picksOf(state: CommandState, id: string): SelectionPick[] {
  const field = state.fields[id]
  return field?.kind === 'selection' ? field.picks : []
}

function withField(state: CommandState, id: string, field: FieldState): CommandState {
  return { ...state, fields: { ...state.fields, [id]: field } }
}

export function createCommandState(
  spec: AnyCommandSpec,
  units: UnitContext = DEFAULT_UNITS,
  initial: CommandInitialValues = {},
): CommandState {
  const fields: Record<string, FieldState> = {}
  for (const input of spec.inputs) {
    const value = initial[input.id]
    switch (input.kind) {
      case 'selection': {
        const picks = Array.isArray(value)
          ? uniquePicks(value.filter((pick) => acceptsPick(input, pick)))
          : []
        fields[input.id] = { kind: 'selection', picks: picks.slice(0, input.max ?? picks.length) }
        break
      }
      case 'length':
      case 'angle':
      case 'integer':
      case 'number':
        fields[input.id] = {
          kind: input.kind,
          text:
            typeof value === 'string'
              ? value
              : formatNumeric(input, typeof value === 'number' ? value : input.default, units),
        }
        break
      case 'choice':
        fields[input.id] = {
          kind: 'choice',
          value:
            typeof value === 'string' && input.options.some((option) => option.value === value)
              ? value
              : defaultChoice(input),
        }
        break
      case 'toggle':
        fields[input.id] = {
          kind: 'toggle',
          value: typeof value === 'boolean' ? value : (input.default ?? false),
        }
        break
    }
  }
  const state: CommandState = { fields, active: null }
  const { hidden } = readCommand(spec, state, units)
  const selections = spec.inputs.filter(
    (input): input is SelectionInput => input.kind === 'selection' && !hidden.includes(input.id),
  )
  const open = selections.find((input) => picksOf(state, input.id).length < input.min)
  state.active = (open ?? selections[0])?.id ?? null
  return state
}

function nextOpenSelection(
  spec: AnyCommandSpec,
  state: CommandState,
  afterId: string,
  units: UnitContext,
): string | null {
  const { hidden } = readCommand(spec, state, units)
  const index = spec.inputs.findIndex((input) => input.id === afterId)
  const next = spec.inputs
    .slice(index + 1)
    .find(
      (input): input is SelectionInput =>
        input.kind === 'selection' &&
        !hidden.includes(input.id) &&
        picksOf(state, input.id).length < input.min,
    )
  return next?.id ?? null
}

function addPick(
  spec: AnyCommandSpec,
  state: CommandState,
  pick: SelectionPick,
  id: string | null,
  units: UnitContext,
): CommandState {
  if (!id) return state
  const input = findInput(spec, id)
  if (input?.kind !== 'selection' || !acceptsPick(input, pick)) return state
  const current = picksOf(state, id)
  const merged = input.merge?.(current, pick)
  if (merged) {
    const picks = uniquePicks(merged.filter((candidate) => acceptsPick(input, candidate)))
    return {
      ...withField(state, id, { kind: 'selection', picks: picks.slice(0, input.max) }),
      active: id,
    }
  }
  const existing = current.some((candidate) => samePick(candidate, pick))
  let picks: SelectionPick[]
  if (existing) picks = current.filter((candidate) => !samePick(candidate, pick))
  else if (input.max === 1) picks = [pick]
  else if (input.max !== undefined && current.length >= input.max) return state
  else picks = [...current, pick]
  let next: CommandState = { ...withField(state, id, { kind: 'selection', picks }), active: id }
  if (!existing && input.fills) next = applyFills(spec, next, input.fills(pick), units)
  if (!existing && input.max !== undefined && picks.length >= input.max) {
    next.active = nextOpenSelection(spec, next, id, units) ?? id
  }
  return next
}

function applyFills(
  spec: AnyCommandSpec,
  state: CommandState,
  fills: Readonly<Record<string, number | string | boolean>>,
  units: UnitContext,
): CommandState {
  let next = state
  for (const [id, value] of Object.entries(fills)) {
    const input = findInput(spec, id)
    if (!input) continue
    if (
      (input.kind === 'length' ||
        input.kind === 'angle' ||
        input.kind === 'integer' ||
        input.kind === 'number') &&
      typeof value === 'number'
    ) {
      next = withField(next, id, { kind: input.kind, text: formatNumeric(input, value, units) })
    } else if (input.kind === 'choice' && typeof value === 'string') {
      next = withField(next, id, { kind: 'choice', value })
    } else if (input.kind === 'toggle' && typeof value === 'boolean') {
      next = withField(next, id, { kind: 'toggle', value })
    }
  }
  return next
}

export function visibleSelections(
  spec: AnyCommandSpec,
  state: CommandState,
  units: UnitContext = DEFAULT_UNITS,
): SelectionInput[] {
  const { hidden } = readCommand(spec, state, units)
  return spec.inputs.filter(
    (input): input is SelectionInput => input.kind === 'selection' && !hidden.includes(input.id),
  )
}

function settleActive(spec: AnyCommandSpec, state: CommandState, units: UnitContext): CommandState {
  const selections = visibleSelections(spec, state, units)
  const current = selections.find((input) => input.id === state.active)
  const needed = selections.find((input) => picksOf(state, input.id).length < input.min)
  const unmet = !current || picksOf(state, current.id).length >= current.min
  const active = unmet && needed ? needed.id : (current?.id ?? selections[0]?.id ?? null)
  return active === state.active ? state : { ...state, active }
}

export function reduceCommand(
  spec: AnyCommandSpec,
  state: CommandState,
  action: CommandAction,
  units: UnitContext = DEFAULT_UNITS,
): CommandState {
  switch (action.type) {
    case 'text': {
      const field = state.fields[action.id]
      if (!field || field.kind === 'selection' || field.kind === 'choice') return state
      if (field.kind === 'toggle' || field.text === action.text) return state
      return withField(state, action.id, { kind: field.kind, text: action.text })
    }
    case 'choice': {
      const input = findInput(spec, action.id)
      if (input?.kind !== 'choice') return state
      if (!input.options.some((option) => option.value === action.value)) return state
      const field = state.fields[action.id]
      if (field?.kind === 'choice' && field.value === action.value) return state
      return settleActive(
        spec,
        withField(state, action.id, { kind: 'choice', value: action.value }),
        units,
      )
    }
    case 'toggle': {
      const field = state.fields[action.id]
      if (field?.kind !== 'toggle' || field.value === action.value) return state
      return settleActive(
        spec,
        withField(state, action.id, { kind: 'toggle', value: action.value }),
        units,
      )
    }
    case 'activate': {
      if (action.id === null) return state.active === null ? state : { ...state, active: null }
      if (findInput(spec, action.id)?.kind !== 'selection' || state.active === action.id) {
        return state
      }
      return { ...state, active: action.id }
    }
    case 'pick':
      return addPick(spec, state, action.pick, action.id ?? state.active, units)
    case 'unpick': {
      const current = picksOf(state, action.id)
      const picks = current.filter((candidate) => !samePick(candidate, action.pick))
      if (picks.length === current.length) return state
      return { ...withField(state, action.id, { kind: 'selection', picks }), active: action.id }
    }
    case 'setPicks': {
      const input = findInput(spec, action.id)
      if (input?.kind !== 'selection') return state
      const picks = uniquePicks(action.picks.filter((pick) => acceptsPick(input, pick)))
      return withField(state, action.id, {
        kind: 'selection',
        picks: picks.slice(0, input.max ?? picks.length),
      })
    }
    case 'clear': {
      if (findInput(spec, action.id)?.kind !== 'selection') return state
      return { ...withField(state, action.id, { kind: 'selection', picks: [] }), active: action.id }
    }
    case 'step': {
      const input = findInput(spec, action.id)
      const field = state.fields[action.id]
      if (input?.kind !== 'integer' || field?.kind !== 'integer') return state
      let current = input.default
      try {
        current = parseInteger(field.text, units.variable)
      } catch {}
      const stepped = current + action.delta * (input.step ?? 1)
      const clamped = Math.min(
        input.max ?? Number.POSITIVE_INFINITY,
        Math.max(input.min ?? Number.NEGATIVE_INFINITY, stepped),
      )
      return withField(state, action.id, { kind: 'integer', text: formatInteger(clamped) })
    }
    case 'replace':
      return action.state
  }
}

function rangeError(input: NumericInput, value: number, units: UnitContext): string | null {
  const show = (limit: number) => formatNumeric(input, limit, units)
  const exclusive = input.kind !== 'integer' && input.exclusiveMin
  if (input.min !== undefined) {
    if (exclusive && value <= input.min) return `Must be more than ${show(input.min)}.`
    if (!exclusive && value < input.min) return `Must be at least ${show(input.min)}.`
  }
  if (input.max !== undefined && value > input.max) return `Must be at most ${show(input.max)}.`
  return null
}

interface FieldReading {
  value: CommandValue
  error: string | null
  missing: boolean
}

function readField(
  input: CommandInput,
  field: FieldState | undefined,
  units: UnitContext,
): FieldReading {
  switch (input.kind) {
    case 'selection': {
      const picks = field?.kind === 'selection' ? field.picks : []
      const over = input.max !== undefined && picks.length > input.max
      return {
        value: picks,
        error: over ? `Select no more than ${input.max}.` : null,
        missing: picks.length < input.min,
      }
    }
    case 'length':
    case 'angle':
    case 'integer':
    case 'number': {
      const text = field && field.kind === input.kind ? field.text : ''
      try {
        const value =
          input.kind === 'length'
            ? parseLength(text, units.unit, units.variable)
            : input.kind === 'angle'
              ? parseAngle(text, units.variable)
              : input.kind === 'number'
                ? parseNumber(text, units.variable)
                : parseInteger(text, units.variable)
        return { value, error: rangeError(input, value, units), missing: false }
      } catch (error) {
        return { value: input.default, error: messageOf(error), missing: false }
      }
    }
    case 'choice': {
      const value = field?.kind === 'choice' ? field.value : defaultChoice(input)
      const known = input.options.some((option) => option.value === value)
      return {
        value: known ? value : defaultChoice(input),
        error: known ? null : 'Choose one of the options.',
        missing: false,
      }
    }
    case 'toggle':
      return {
        value: field?.kind === 'toggle' ? field.value : (input.default ?? false),
        error: null,
        missing: false,
      }
  }
}

interface CommandReading {
  values: Record<string, CommandValue>
  fieldErrors: Record<string, string>
  missing: string[]
  hidden: string[]
}

function readCommand(
  spec: AnyCommandSpec,
  state: CommandState,
  units: UnitContext,
): CommandReading {
  const values: Record<string, CommandValue> = {}
  const fieldErrors: Record<string, string> = {}
  let missing: string[] = []
  for (const input of spec.inputs) {
    const reading = readField(input, state.fields[input.id], units)
    values[input.id] = reading.value
    if (reading.error) fieldErrors[input.id] = reading.error
    if (reading.missing) missing.push(input.id)
  }
  const hidden = spec.inputs
    .filter((input) => {
      if (!input.visible) return false
      try {
        return !input.visible(values)
      } catch {
        return false
      }
    })
    .map((input) => input.id)
  for (const id of hidden) delete fieldErrors[id]
  missing = missing.filter((id) => !hidden.includes(id))
  return { values, fieldErrors, missing, hidden }
}

export function evaluateCommand(
  spec: AnyCommandSpec,
  state: CommandState,
  context: CommandContext,
  options: { build?: boolean } = {},
): CommandEvaluation {
  const { values, fieldErrors, missing, hidden } = readCommand(spec, state, context)
  let formError: string | null = null
  if (!Object.keys(fieldErrors).length && !missing.length && spec.validate) {
    try {
      const result = spec.validate(values, context)
      if (typeof result === 'string') {
        formError = result || null
      } else if (result) {
        for (const [id, message] of Object.entries(result)) {
          if (!message) continue
          if (findInput(spec, id) && !hidden.includes(id)) fieldErrors[id] = message
          else formError ??= message
        }
      }
    } catch (error) {
      formError = messageOf(error)
    }
  }
  const valid = !Object.keys(fieldErrors).length && !missing.length && !formError
  let features: Feature[] | null = null
  let buildError: string | null = null
  if (valid && options.build) {
    try {
      const built = spec.build(values, context)
      if (Array.isArray(built)) features = built
      else buildError = 'The command did not produce any features.'
    } catch (error) {
      buildError = messageOf(error)
    }
  }
  return { values, fieldErrors, missing, hidden, formError, valid, features, buildError }
}

export function selectionSummary(input: SelectionInput, picks: readonly SelectionPick[]): string {
  if (!picks.length) return input.prompt ?? 'Select'
  return `${picks.length} selected`
}

export function activePrompt(spec: AnyCommandSpec, state: CommandState): string | null {
  if (!state.active) return null
  const input = findInput(spec, state.active)
  if (input?.kind !== 'selection') return null
  return input.prompt ?? `Select ${input.label.toLowerCase()}`
}
