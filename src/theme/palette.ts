export interface ViewportPalette {
  background: number
  gridMinor: number
  gridMajor: number
  axisX: number
  axisY: number
  axisZ: number
  bodyEdge: number
  selection: number
  selectionDim: number
  hover: number
  sketchLine: number
  sketchFree: number
  sketchConstruction: number
  sketchPoint: number
  sketchPlane: number
  sketchPlaneOpacity: number
  dimension: number
  overlayLine: number
  overlayConstruction: number
  profileIdle: number
  profileHover: number
  profilePicked: number
  handle: number
  handleHot: number
  previewCut: number
  hemisphereSky: number
  hemisphereGround: number
}

export const LIGHT_PALETTE: ViewportPalette = {
  background: 0xe8ebee,
  gridMinor: 0xa9b4bf,
  gridMajor: 0x738597,
  axisX: 0xd6433a,
  axisY: 0x3c9739,
  axisZ: 0x2f6fd0,
  bodyEdge: 0x1a1d21,
  selection: 0x1a86e0,
  selectionDim: 0x0f5a99,
  hover: 0x5aaef0,
  sketchLine: 0x151d25,
  sketchFree: 0x1676c5,
  sketchConstruction: 0xcf7520,
  sketchPoint: 0x1d2831,
  sketchPlane: 0xffffff,
  sketchPlaneOpacity: 0.25,
  dimension: 0x3a4650,
  overlayLine: 0x3d4b5c,
  overlayConstruction: 0x9097a0,
  profileIdle: 0xf1cf9b,
  profileHover: 0xf0a64a,
  profilePicked: 0x4f9fe0,
  handle: 0x1676c5,
  handleHot: 0x46a3ec,
  previewCut: 0xd4473d,
  hemisphereSky: 0xdfe6ef,
  hemisphereGround: 0x24282d,
}

function parseColour(value: string): { hex: number; alpha: number } | null {
  const text = value.trim()
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return { hex: parseInt(digits, 16), alpha: 1 }
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
    return { hex: (r << 16) | (g << 8) | b, alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) }
  }
  return null
}

function blend(colour: { hex: number; alpha: number }, over: number): number {
  const mix = (shift: number) => {
    const top = (colour.hex >> shift) & 255
    const bottom = (over >> shift) & 255
    return Math.round(top * colour.alpha + bottom * (1 - colour.alpha))
  }
  return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}

export function readPalette(
  root: Element | null = globalThis.document?.documentElement ?? null,
): ViewportPalette {
  if (!root || typeof getComputedStyle !== 'function') return LIGHT_PALETTE
  const style = getComputedStyle(root)
  const read = (name: string) => parseColour(style.getPropertyValue(name))
  const background = read('--okc-surface-canvas-bottom')?.hex ?? LIGHT_PALETTE.background
  const solid = (name: string, fallback: number) => {
    const colour = read(name)
    return colour ? blend(colour, background) : fallback
  }
  const dark =
    (((background >> 16) & 255) + ((background >> 8) & 255) + (background & 255)) / 3 < 110
  return {
    background: blend(read('--okc-surface-app') ?? { hex: background, alpha: 1 }, background),
    gridMinor: solid('--okc-grid-minor', LIGHT_PALETTE.gridMinor),
    gridMajor: solid('--okc-grid-major', LIGHT_PALETTE.gridMajor),
    axisX: solid('--okc-axis-x', LIGHT_PALETTE.axisX),
    axisY: solid('--okc-axis-y', LIGHT_PALETTE.axisY),
    axisZ: solid('--okc-axis-z', LIGHT_PALETTE.axisZ),
    bodyEdge: dark ? 0x0b0d10 : LIGHT_PALETTE.bodyEdge,
    selection: solid('--okc-selection', LIGHT_PALETTE.selection),
    selectionDim: solid('--okc-accent-active', LIGHT_PALETTE.selectionDim),
    hover: solid('--okc-prehighlight', LIGHT_PALETTE.hover),
    sketchLine: solid('--okc-sketch-constrained', LIGHT_PALETTE.sketchLine),
    sketchFree: solid('--okc-sketch-free', LIGHT_PALETTE.sketchFree),
    sketchConstruction: solid('--okc-sketch-construction', LIGHT_PALETTE.sketchConstruction),
    sketchPoint: solid('--okc-sketch-point', LIGHT_PALETTE.sketchPoint),
    sketchPlane: dark ? 0x000000 : 0xffffff,
    sketchPlaneOpacity: dark ? 0.2 : 0.25,
    dimension: solid('--okc-sketch-dimension', LIGHT_PALETTE.dimension),
    overlayLine: dark ? 0xaab6c2 : LIGHT_PALETTE.overlayLine,
    overlayConstruction: dark ? 0x7d8792 : LIGHT_PALETTE.overlayConstruction,
    profileIdle: dark ? 0x8a6a36 : LIGHT_PALETTE.profileIdle,
    profileHover: dark ? 0xc98a2e : LIGHT_PALETTE.profileHover,
    profilePicked: solid('--okc-selection', LIGHT_PALETTE.profilePicked),
    handle: solid('--okc-accent', LIGHT_PALETTE.handle),
    handleHot: solid('--okc-prehighlight', LIGHT_PALETTE.handleHot),
    previewCut: solid('--okc-preview-cut', LIGHT_PALETTE.previewCut),
    hemisphereSky: dark ? 0xc9d3de : LIGHT_PALETTE.hemisphereSky,
    hemisphereGround: dark ? 0x101215 : LIGHT_PALETTE.hemisphereGround,
  }
}
