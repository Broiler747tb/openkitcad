import { LIGHT_PALETTE, readPalette } from '../theme/palette'
import { applyThemePreference, resolveTheme } from '../theme/theme'
import {
  MOUSE_SCHEMES,
  MOUSE_SCHEME_ORDER,
  resolveDrag,
  resolveWheel,
  resolveWheelGesture,
  schemeSummary,
  wheelIsNotched,
  BUTTON_BIT,
} from '../ui/mouse/schemes'
import { placeAround, type MenuRect } from '../ui/ContextMenu'
import { DEFAULT_PREFERENCES, normalizePreferences } from '../doc/preferences'
import type { TestResult } from './selftest'

export function runUiTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `UI: ${name}`, pass, detail })

  const fusion = MOUSE_SCHEMES.fusion
  check(
    'Fusion pans with the middle button and orbits with Shift and the middle button',
    resolveDrag(fusion, BUTTON_BIT.middle) === 'pan' &&
      resolveDrag(fusion, BUTTON_BIT.middle, { shift: true }) === 'orbit' &&
      resolveDrag(fusion, BUTTON_BIT.left) === 'none',
    `${resolveDrag(fusion, BUTTON_BIT.middle)} / ${resolveDrag(fusion, BUTTON_BIT.middle, { shift: true })}`,
  )
  const solidworks = MOUSE_SCHEMES.solidworks
  check(
    'SolidWorks orbits with the middle button, pans with Ctrl and zooms with Shift',
    resolveDrag(solidworks, BUTTON_BIT.middle) === 'orbit' &&
      resolveDrag(solidworks, BUTTON_BIT.middle, { ctrl: true }) === 'pan' &&
      resolveDrag(solidworks, BUTTON_BIT.middle, { shift: true }) === 'zoom' &&
      resolveWheel(solidworks, -1).direction === 'out',
    `${resolveDrag(solidworks, BUTTON_BIT.middle)} ${resolveWheel(solidworks, -1).direction}`,
  )
  check(
    'Onshape and Tinkercad orbit with the right button',
    resolveDrag(MOUSE_SCHEMES.onshape, BUTTON_BIT.right) === 'orbit' &&
      resolveDrag(MOUSE_SCHEMES.tinkercad, BUTTON_BIT.right) === 'orbit' &&
      resolveDrag(MOUSE_SCHEMES.tinkercad, BUTTON_BIT.right, { shift: true }) === 'pan',
    resolveDrag(MOUSE_SCHEMES.onshape, BUTTON_BIT.right),
  )

  const pad = MOUSE_SCHEMES.touchpad
  const gesture = (event: Parameters<typeof resolveWheelGesture>[1]) =>
    resolveWheelGesture(pad, event)
  check(
    'a touchpad pans on two fingers and zooms on a pinch',
    gesture({ deltaX: 0, deltaY: 6.4 }).action === 'pan' &&
      gesture({ deltaX: -4, deltaY: 0 }).action === 'pan' &&
      gesture({ deltaX: 0, deltaY: -9, ctrlKey: true }).action === 'zoom',
    `${gesture({ deltaX: 0, deltaY: 6.4 }).action} / ${gesture({ deltaX: 0, deltaY: -9, ctrlKey: true }).action}`,
  )
  check(
    'Alt and two fingers orbits, and carries the gesture through',
    (() => {
      const out = gesture({ deltaX: 5, deltaY: -3, altKey: true })
      return out.action === 'orbit' && out.dx === 5 && out.dy === -3
    })(),
    JSON.stringify(gesture({ deltaX: 5, deltaY: -3, altKey: true })),
  )
  check(
    'a real wheel still zooms in touchpad mode',
    gesture({ deltaX: 0, deltaY: 100 }).action === 'zoom' &&
      gesture({ deltaX: 0, deltaY: -3, deltaMode: 1 }).action === 'zoom' &&
      wheelIsNotched({ deltaX: 0, deltaY: 120 }) &&
      !wheelIsNotched({ deltaX: 0, deltaY: 6.4 }),
    `${gesture({ deltaX: 0, deltaY: 100 }).action}, notched(6.4) ${wheelIsNotched({ deltaX: 0, deltaY: 6.4 })}`,
  )
  check(
    'the other schemes still zoom on every wheel event',
    (['fusion', 'solidworks', 'onshape', 'tinkercad'] as const).every(
      (id) =>
        resolveWheelGesture(MOUSE_SCHEMES[id], { deltaX: 0, deltaY: 6.4 }).action === 'zoom' &&
        resolveWheelGesture(MOUSE_SCHEMES[id], { deltaX: 8, deltaY: 0, altKey: true }).action !==
          'orbit',
    ),
    'small deltas and Alt leave the mouse schemes alone',
  )
  check(
    'only the touchpad scheme needs no middle button',
    (() => {
      const needsMiddle = (id: (typeof MOUSE_SCHEME_ORDER)[number]) => {
        const summary = schemeSummary(MOUSE_SCHEMES[id])
        return (['orbit', 'pan'] as const).some(
          (action) =>
            summary[action].length > 0 &&
            summary[action].every((route) => route.includes('Middle')),
        )
      }
      return !needsMiddle('touchpad') && needsMiddle('fusion') && needsMiddle('solidworks')
    })(),
    'Fusion and SolidWorks reach pan or orbit only through the middle button; Touchpad does not',
  )
  check(
    'touchpad speed scales panning and orbiting but not zooming',
    (() => {
      const pan = resolveWheelGesture(pad, { deltaX: 3, deltaY: -4 }, false, 2)
      const orbit = resolveWheelGesture(pad, { deltaX: 3, deltaY: -4, altKey: true }, false, 0.5)
      const zoom = resolveWheelGesture(pad, { deltaX: 0, deltaY: -9, ctrlKey: true }, false, 4)
      const slow = resolveWheelGesture(pad, { deltaX: 0, deltaY: -9, ctrlKey: true }, false, 0.25)
      return (
        pan.action === 'pan' &&
        pan.dx === 6 &&
        pan.dy === -8 &&
        orbit.action === 'orbit' &&
        orbit.dx === 1.5 &&
        orbit.dy === -2 &&
        zoom.action === 'zoom' &&
        slow.action === 'zoom' &&
        zoom.direction === slow.direction
      )
    })(),
    JSON.stringify(resolveWheelGesture(pad, { deltaX: 3, deltaY: -4 }, false, 2)),
  )
  check(
    'a stored touchpad speed starts at 1 and is held between a quarter and four times',
    DEFAULT_PREFERENCES.touchpadSpeed === 1 &&
      normalizePreferences({ touchpadSpeed: 99 }).touchpadSpeed === 4 &&
      normalizePreferences({ touchpadSpeed: 0 }).touchpadSpeed === 0.25 &&
      normalizePreferences({ touchpadSpeed: Number.NaN }).touchpadSpeed === 1 &&
      normalizePreferences({}).touchpadSpeed === 1,
    `99 -> ${normalizePreferences({ touchpadSpeed: 99 }).touchpadSpeed}, 0 -> ${normalizePreferences({ touchpadSpeed: 0 }).touchpadSpeed}`,
  )

  const root = document.createElement('div')
  document.body.appendChild(root)
  try {
    applyThemePreference('dark', root)
    const dark = readPalette(root)
    applyThemePreference('light', root)
    const light = readPalette(root)
    const brightness = (hex: number) => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255)
    check(
      'the dark theme darkens the 3D background and lightens sketch lines',
      brightness(dark.background) < brightness(light.background) &&
        brightness(dark.sketchLine) > brightness(light.sketchLine),
      `dark ${dark.background.toString(16)} / ${dark.sketchLine.toString(16)}, light ${light.background.toString(16)} / ${light.sketchLine.toString(16)}`,
    )
    check(
      'the light palette reads the blue selection colour from the tokens',
      light.selection !== LIGHT_PALETTE.previewCut &&
        (light.selection & 255) > ((light.selection >> 16) & 255),
      light.selection.toString(16),
    )
  } finally {
    root.remove()
  }
  check(
    'Match the system follows the system setting',
    resolveTheme('system', true) === 'dark' && resolveTheme('system', false) === 'light',
    `${resolveTheme('system', true)} ${resolveTheme('system', false)}`,
  )

  const swatch = document.createElement('div')
  swatch.style.cssText = 'position:fixed;left:-9999px;background:var(--okc-surface-panel)'
  swatch.innerHTML = '<div class="msg warn"></div><div class="msg error"></div>'
  document.body.appendChild(swatch)
  try {
    const channels = (colour: string) => (colour.match(/[\d.]+/g) ?? ['0']).map(Number)
    const flatten = (front: number[], back: number[]) => {
      const alpha = front[3] ?? 1
      return [0, 1, 2].map((i) => front[i] * alpha + back[i] * (1 - alpha))
    }
    const luminance = (colour: number[]) => {
      const linear = colour.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (a: number[], b: number[]) => {
      const [x, y] = [luminance(a), luminance(b)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    for (const theme of ['light', 'dark'] as const) {
      applyThemePreference(theme, swatch)
      const panel = channels(getComputedStyle(swatch).backgroundColor)
      for (const kind of ['warn', 'error'] as const) {
        const box = swatch.querySelector(`.msg.${kind}`) as HTMLElement
        const style = getComputedStyle(box)
        const ratio = contrast(
          flatten(channels(style.backgroundColor), panel),
          channels(style.color),
        )
        check(
          `a ${kind === 'warn' ? 'warning' : 'an error'} can be read against its own background in ${theme}`,
          ratio >= 3,
          `contrast ${ratio.toFixed(2)}:1 (needs 3)`,
        )
      }
    }
  } finally {
    swatch.remove()
  }

  const screen = { width: 1280, height: 800 }
  const clear = (ring: MenuRect, width: number, height: number) => {
    const placed = placeAround(ring.left, ring.bottom, width, height, ring, screen)
    const bottom = placed.top + Math.min(height, placed.maxHeight ?? height)
    const right = placed.left + width
    const overlaps =
      placed.left < ring.right && right > ring.left && placed.top < ring.bottom && bottom > ring.top
    const inside =
      placed.left >= 0 && placed.top >= 0 && right <= screen.width && bottom <= screen.height
    return { placed, ok: !overlaps && inside }
  }
  const cases: Array<[string, MenuRect, number, number]> = [
    ['in the middle', { left: 440, top: 300, right: 840, bottom: 460 }, 240, 260],
    ['near the bottom', { left: 440, top: 620, right: 840, bottom: 784 }, 240, 360],
    ['near the bottom right', { left: 872, top: 620, right: 1272, bottom: 784 }, 240, 520],
    ['with a very long list', { left: 440, top: 320, right: 840, bottom: 480 }, 240, 1200],
  ]
  for (const [where, ring, width, height] of cases) {
    const { placed, ok } = clear(ring, width, height)
    check(`the right-click list never covers the marking ring ${where}`, ok, JSON.stringify(placed))
  }

  if (window.innerWidth < 1 || window.innerHeight < 1) {
    results.push({
      name: 'UI: an open ribbon menu draws over the view cube and a command panel',
      pass: true,
      skipped: true,
      detail: 'needs a window with a size; this one is 0 x 0, so nothing can be hit tested',
    })
    return results
  }

  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;inset:0;'
  stage.innerHTML =
    '<header class="workspace-header" style="position:fixed;left:0;top:0;width:420px;height:40px">' +
    '<div class="fusion-group" style="position:absolute;left:0;top:0">' +
    '<div class="fusion-dropdown" style="position:fixed;left:20px;top:60px;width:260px;height:160px"></div>' +
    '</div></header>' +
    '<div class="viewport" style="position:absolute;left:0;top:40px;width:420px;height:320px">' +
    '<div class="view-cube" style="left:10px;top:30px;width:120px;height:120px">' +
    '<button class="view-cube-face" style="left:0;top:0;width:120px;height:120px"></button></div>' +
    '<div class="okc-cmd" style="position:absolute;left:150px;top:30px;width:200px;height:200px"></div>' +
    '</div>'
  document.body.appendChild(stage)
  try {
    const header = stage.querySelector('header')!
    const menu = stage.querySelector('.fusion-dropdown')!
    const onTop = () =>
      [
        [60, 120],
        [240, 150],
      ].every(([x, y]) => menu.contains(document.elementFromPoint(x, y)))
    const closed = onTop()
    header.classList.add('menu-open')
    const open = onTop()
    check(
      'an open ribbon menu draws over the view cube and a command panel',
      !closed && open,
      `covered while the header is at rest: ${!closed}, on top once a menu is open: ${open}`,
    )
  } finally {
    stage.remove()
  }

  return results
}
