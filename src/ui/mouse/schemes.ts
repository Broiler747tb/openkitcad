export type NavAction = 'orbit' | 'pan' | 'zoom' | 'none'
export type ActiveNavAction = Exclude<NavAction, 'none'>
export type MouseButton = 'left' | 'middle' | 'right'
export type ModifierKey = 'shift' | 'ctrl' | 'alt'
export type PointerKind = 'mouse' | 'pen' | 'touch'
export type MouseSchemeId = 'fusion' | 'solidworks' | 'onshape' | 'tinkercad'
export type ZoomDirection = 'in' | 'out'

export interface ModifierState {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
}

export interface DragBinding {
  buttons: readonly MouseButton[]
  modifiers: readonly ModifierKey[]
  action: ActiveNavAction
}

export interface MouseScheme {
  id: MouseSchemeId
  label: string
  hint: string
  drag: readonly DragBinding[]
  wheelForward: ZoomDirection
}

export interface TouchMapping {
  oneFinger: NavAction
  twoFinger: NavAction
  pinch: NavAction
  threeFinger: NavAction
  whilePenDown: NavAction
}

export interface PenMapping {
  tip: NavAction
  barrel: NavAction
  barrelShift: NavAction
  eraser: NavAction
}

export interface PointerInput {
  pointerType: PointerKind | string
  buttons: number
  modifiers?: ModifierState
  touches?: number
  penDown?: boolean
}

export interface WheelResult {
  action: 'zoom' | 'none'
  direction: ZoomDirection | null
}

export const BUTTON_BIT: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 }
export const PEN_ERASER_BIT = 32

export const MOUSE_SCHEMES: Record<MouseSchemeId, MouseScheme> = {
  fusion: {
    id: 'fusion',
    label: 'Fusion',
    hint: 'Middle drag pans, Shift and middle drag orbits, and the wheel zooms.',
    drag: [
      { buttons: ['middle'], modifiers: [], action: 'pan' },
      { buttons: ['middle'], modifiers: ['shift'], action: 'orbit' },
    ],
    wheelForward: 'in',
  },
  solidworks: {
    id: 'solidworks',
    label: 'SolidWorks',
    hint: 'Middle drag orbits, Ctrl and middle drag pans, Shift and middle drag zooms.',
    drag: [
      { buttons: ['middle'], modifiers: [], action: 'orbit' },
      { buttons: ['middle'], modifiers: ['ctrl'], action: 'pan' },
      { buttons: ['middle'], modifiers: ['shift'], action: 'zoom' },
    ],
    wheelForward: 'out',
  },
  onshape: {
    id: 'onshape',
    label: 'Onshape',
    hint: 'Right drag orbits, middle drag or Ctrl and right drag pans, and the wheel zooms.',
    drag: [
      { buttons: ['right'], modifiers: [], action: 'orbit' },
      { buttons: ['middle'], modifiers: [], action: 'pan' },
      { buttons: ['right'], modifiers: ['ctrl'], action: 'pan' },
    ],
    wheelForward: 'in',
  },
  tinkercad: {
    id: 'tinkercad',
    label: 'Tinkercad',
    hint: 'Right drag orbits, middle drag or Shift and right drag pans, and the wheel zooms.',
    drag: [
      { buttons: ['right'], modifiers: [], action: 'orbit' },
      { buttons: ['middle'], modifiers: [], action: 'pan' },
      { buttons: ['right'], modifiers: ['shift'], action: 'pan' },
    ],
    wheelForward: 'in',
  },
}

export const MOUSE_SCHEME_ORDER: readonly MouseSchemeId[] = [
  'fusion',
  'solidworks',
  'onshape',
  'tinkercad',
]

export const DEFAULT_MOUSE_SCHEME: MouseSchemeId = 'fusion'

export const TOUCH_MAPPING: TouchMapping = {
  oneFinger: 'orbit',
  twoFinger: 'pan',
  pinch: 'zoom',
  threeFinger: 'none',
  whilePenDown: 'none',
}

export const PEN_MAPPING: PenMapping = {
  tip: 'none',
  barrel: 'orbit',
  barrelShift: 'pan',
  eraser: 'pan',
}

export function mouseScheme(id: string | null | undefined): MouseScheme {
  return MOUSE_SCHEMES[id as MouseSchemeId] ?? MOUSE_SCHEMES[DEFAULT_MOUSE_SCHEME]
}

export function heldButtons(buttons: number): MouseButton[] {
  const held: MouseButton[] = []
  if (buttons & BUTTON_BIT.left) held.push('left')
  if (buttons & BUTTON_BIT.middle) held.push('middle')
  if (buttons & BUTTON_BIT.right) held.push('right')
  return held
}

export function heldModifiers(modifiers: ModifierState = {}): ModifierKey[] {
  const held: ModifierKey[] = []
  if (modifiers.shift) held.push('shift')
  if (modifiers.ctrl || modifiers.meta) held.push('ctrl')
  if (modifiers.alt) held.push('alt')
  return held
}

export function modifiersOf(event: {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): ModifierState {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey }
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item))
}

export function resolveDrag(
  scheme: MouseScheme,
  buttons: number,
  modifiers: ModifierState = {},
): NavAction {
  const held = heldButtons(buttons)
  if (!held.length) return 'none'
  const mods = heldModifiers(modifiers)
  const binding = scheme.drag.find(
    (candidate) => sameSet(candidate.buttons, held) && sameSet(candidate.modifiers, mods),
  )
  return binding?.action ?? 'none'
}

export function resolveWheel(scheme: MouseScheme, deltaY: number, reverse = false): WheelResult {
  if (!deltaY || !Number.isFinite(deltaY)) return { action: 'none', direction: null }
  const forward = deltaY < 0
  const zoomsIn = (scheme.wheelForward === 'in') === forward
  return { action: 'zoom', direction: zoomsIn !== reverse ? 'in' : 'out' }
}

export function resolveTouch(
  touches: number,
  penDown = false,
  mapping: TouchMapping = TOUCH_MAPPING,
): NavAction {
  if (penDown) return mapping.whilePenDown
  if (touches === 1) return mapping.oneFinger
  if (touches === 2) return mapping.twoFinger
  if (touches === 3) return mapping.threeFinger
  return 'none'
}

export function resolveTwoFinger(
  startDistance: number,
  distance: number,
  centroidTravel: number,
  threshold = 12,
  mapping: TouchMapping = TOUCH_MAPPING,
): NavAction {
  const spread = Math.abs(distance - startDistance)
  if (spread < threshold && centroidTravel < threshold) return 'none'
  return spread > centroidTravel ? mapping.pinch : mapping.twoFinger
}

export function resolvePen(
  buttons: number,
  modifiers: ModifierState = {},
  mapping: PenMapping = PEN_MAPPING,
): NavAction {
  if (buttons & PEN_ERASER_BIT) return mapping.eraser
  if (buttons & BUTTON_BIT.right) return modifiers.shift ? mapping.barrelShift : mapping.barrel
  if (buttons & BUTTON_BIT.left) return mapping.tip
  return 'none'
}

export function resolveNavigation(
  scheme: MouseScheme,
  input: PointerInput,
  touch: TouchMapping = TOUCH_MAPPING,
  pen: PenMapping = PEN_MAPPING,
): NavAction {
  if (input.pointerType === 'touch') return resolveTouch(input.touches ?? 1, input.penDown, touch)
  if (input.pointerType === 'pen') return resolvePen(input.buttons, input.modifiers, pen)
  return resolveDrag(scheme, input.buttons, input.modifiers)
}

export function rightButtonNavigates(scheme: MouseScheme): boolean {
  return scheme.drag.some((binding) => binding.buttons.includes('right'))
}

const BUTTON_LABEL: Record<MouseButton, string> = {
  left: 'Left',
  middle: 'Middle',
  right: 'Right',
}

const MODIFIER_LABEL: Record<ModifierKey, string> = { shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt' }

export function describeDrag(binding: DragBinding): string {
  const parts = [
    ...binding.modifiers.map((key) => MODIFIER_LABEL[key]),
    `${binding.buttons.map((button) => BUTTON_LABEL[button]).join(' and ')} drag`,
  ]
  return parts.join(' + ')
}

export function schemeSummary(scheme: MouseScheme): Record<ActiveNavAction, string[]> {
  const summary: Record<ActiveNavAction, string[]> = { orbit: [], pan: [], zoom: ['Wheel'] }
  for (const binding of scheme.drag) summary[binding.action].push(describeDrag(binding))
  return summary
}
