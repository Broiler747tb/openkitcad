export type BinaryInput = ArrayBuffer | ArrayBufferView

export function toBytes(data: BinaryInput): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

export function decodeText(data: string | BinaryInput): string {
  if (typeof data === 'string') return data
  const text = new TextDecoder('utf-8').decode(toBytes(data))
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function scalePositions(positions: Float64Array, factor: number) {
  if (factor === 1) return
  for (let i = 0; i < positions.length; i++) positions[i] *= factor
}

export function formatNumber(value: number): string {
  return value === 0 ? '0' : String(value)
}

export function fileBaseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
}
