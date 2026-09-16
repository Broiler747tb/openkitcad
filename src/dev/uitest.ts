import { LIGHT_PALETTE, readPalette } from '../theme/palette'
import { applyThemePreference, resolveTheme } from '../theme/theme'
import { MOUSE_SCHEMES, resolveDrag, resolveWheel, BUTTON_BIT } from '../ui/mouse/schemes'
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
  return results
}
