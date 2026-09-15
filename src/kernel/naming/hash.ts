const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

export const MAX_NAME_LENGTH = 128

export const MAX_FULL_NAME_LENGTH = 4096

export interface Label {
  name: string
  full: string
}

export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

export function capFullName(full: string): string {
  return full.length > MAX_FULL_NAME_LENGTH ? `${full.slice(0, MAX_FULL_NAME_LENGTH - 3)}...` : full
}

export function finishLabel(name: string, full: string, table: Map<string, string>): Label {
  const capped = capFullName(full)
  if (name.length > MAX_NAME_LENGTH) {
    const hashed = fnv1a64(name)
    table.set(hashed, capped)
    return { name: hashed, full: capped }
  }
  if (capped !== name) table.set(name, capped)
  return { name, full: capped }
}
