declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }

  export class Path {
    commands: PathCommand[]
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
    close(): void
  }

  export interface BoundingBox {
    x1: number
    y1: number
    x2: number
    y2: number
  }

  export class Glyph {
    constructor(options: {
      name: string
      unicode?: number
      unicodes?: number[]
      advanceWidth?: number
      path?: Path
    })
    name: string
    index: number
    unicode?: number
    advanceWidth?: number
    path: Path
    getBoundingBox(): BoundingBox
  }

  export interface LocalizedName {
    [language: string]: string
  }

  export class Font {
    constructor(options: {
      familyName: string
      styleName: string
      unitsPerEm: number
      ascender: number
      descender: number
      glyphs: Glyph[]
    })
    unitsPerEm: number
    ascender: number
    descender: number
    names: Record<string, LocalizedName | undefined>
    kerningPairs?: Record<string, number>
    tables: { os2?: { sCapHeight?: number; version?: number }; [table: string]: unknown }
    charToGlyph(character: string): Glyph
    forEachGlyph(
      text: string,
      x: number,
      y: number,
      fontSize: number,
      options: Record<string, unknown> | undefined,
      callback: (glyph: Glyph, x: number, y: number, fontSize: number) => void,
    ): number
    getEnglishName(name: string): string | undefined
    toArrayBuffer(): ArrayBuffer
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font
}
