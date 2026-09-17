import type { Vec3 } from '../../core/math'
import type {
  ElementRef,
  Feature,
  JointKeypoint,
  LengthUnit,
  Matrix4,
  OkcDocument,
  PlaneRef,
} from '../../doc/types'

export type PickKind =
  | 'body'
  | 'occurrence'
  | 'component'
  | 'feature'
  | 'sketch'
  | 'profile'
  | 'sketchCurve'
  | 'sketchPoint'
  | 'face'
  | 'edge'
  | 'vertex'
  | 'plane'
  | 'axis'
  | 'point'
  | 'jointSnap'

export interface SelectionPick {
  kind: PickKind
  id: string
  label: string
  instanceId?: string
  bodyId?: string
  name?: string
  face?: ElementRef
  edge?: ElementRef
  plane?: PlaneRef
  point?: Vec3
  normal?: Vec3
  profile?: { sketchId: string; key: string }
  curve?: { sketchId: string; entityId: string }
  joint?: {
    occurrencePath: string[]
    ref: ElementRef | null
    keypoint: JointKeypoint
    frame: Matrix4
    originId?: string
  }
}

export type CommandValue = SelectionPick[] | number | string | boolean

export type LooseCommandValues = Readonly<Record<string, CommandValue>>

interface InputBase<Id extends string> {
  id: Id
  label: string
  hint?: string
  visible?: (values: LooseCommandValues) => boolean
}

export interface SelectionInput<Id extends string = string> extends InputBase<Id> {
  kind: 'selection'
  filter: readonly PickKind[]
  min: number
  max?: number
  clearable?: boolean
  prompt?: string
  fills?: (pick: SelectionPick) => Readonly<Record<string, CommandValue>>
  merge?: (current: readonly SelectionPick[], pick: SelectionPick) => SelectionPick[] | null
}

export interface LengthInput<Id extends string = string> extends InputBase<Id> {
  kind: 'length'
  default: number
  field?: string
  min?: number
  max?: number
  exclusiveMin?: boolean
}

export interface AngleInput<Id extends string = string> extends InputBase<Id> {
  kind: 'angle'
  default: number
  field?: string
  min?: number
  max?: number
  exclusiveMin?: boolean
}

export interface IntegerInput<Id extends string = string> extends InputBase<Id> {
  kind: 'integer'
  default: number
  min?: number
  max?: number
  step?: number
}

export interface NumberInput<Id extends string = string> extends InputBase<Id> {
  kind: 'number'
  default: number
  min?: number
  max?: number
  exclusiveMin?: boolean
}

export interface ChoiceOption<V extends string = string> {
  value: V
  label: string
  hint?: string
}

export interface ChoiceInput<
  Id extends string = string,
  V extends string = string,
> extends InputBase<Id> {
  kind: 'choice'
  options: readonly ChoiceOption<V>[]
  default?: V
  display?: 'dropdown' | 'buttons'
}

export interface ToggleInput<Id extends string = string> extends InputBase<Id> {
  kind: 'toggle'
  default?: boolean
}

export type CommandInput =
  SelectionInput | LengthInput | AngleInput | IntegerInput | NumberInput | ChoiceInput | ToggleInput

export type NumericInput = LengthInput | AngleInput | IntegerInput | NumberInput

export type InputKind = CommandInput['kind']

export type InputValueOf<I> = I extends { kind: 'selection' }
  ? SelectionPick[]
  : I extends { kind: 'choice'; options: readonly { value: infer V }[] }
    ? V
    : I extends { kind: 'toggle' }
      ? boolean
      : number

export type CommandValues<I extends readonly CommandInput[]> = {
  [K in I[number] as K['id']]: InputValueOf<K>
}

export interface CommandContext {
  doc: OkcDocument
  unit: LengthUnit
  componentId: string
  id: (role: string) => string
  variable?: (name: string) => number
  editing?: Feature
  editingFeatureId?: string
}

export type HandleAnchor = { point: Vec3; direction: Vec3 } | { edge: ElementRef }

export interface ArrowHandle {
  kind: 'arrow'
  input: string
  componentId: string
  anchor: HandleAnchor
  scale?: number
}

export interface ArcHandle {
  kind: 'arc'
  input: string
  componentId: string
  centre: Vec3
  axis: Vec3
  start: Vec3
  radius: number
}

export type CommandHandle = ArrowHandle | ArcHandle

export type CommandValidation<Id extends string = string> =
  string | Partial<Record<Id, string>> | null | undefined

export interface CommandSpec<I extends readonly CommandInput[] = readonly CommandInput[]> {
  id: string
  label: string
  hint: string
  icon?: string
  inputs: I
  build(values: CommandValues<I>, context: CommandContext): Feature[]
  validate?(values: CommandValues<I>, context: CommandContext): CommandValidation<I[number]['id']>
  handles?(values: CommandValues<I>, context: CommandContext): CommandHandle[]
  derive?(
    values: CommandValues<I>,
    changed: string,
    context: CommandContext,
  ): Readonly<Record<string, CommandValue>> | null
  adjust?(
    doc: OkcDocument,
    features: Feature[],
    context: CommandContext,
    values: CommandValues<I>,
  ): void
}

export type AnyCommandSpec = CommandSpec<readonly CommandInput[]>

export type CommandInitialValues = Readonly<Record<string, CommandValue | undefined>>

export function defineCommand<const I extends readonly CommandInput[]>(
  spec: CommandSpec<I>,
): CommandSpec<I> {
  return spec
}
