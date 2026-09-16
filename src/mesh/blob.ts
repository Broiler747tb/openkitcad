import { deflateSync, inflateSync } from 'fflate'
import { createMesh, type MeshGroup, type TriMesh } from './types'

export interface EncodedMesh {
  positions: string
  triangles: string
  groups?: MeshGroup[]
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function encodeMesh(mesh: TriMesh): EncodedMesh {
  const positions = Float32Array.from(mesh.positions)
  const triangles = Uint32Array.from(mesh.triangles)
  return {
    positions: toBase64(deflateSync(new Uint8Array(positions.buffer), { level: 6 })),
    triangles: toBase64(deflateSync(new Uint8Array(triangles.buffer), { level: 6 })),
    ...(mesh.groups?.length ? { groups: mesh.groups.map((group) => ({ ...group })) } : {}),
  }
}

export function decodeMesh(encoded: EncodedMesh): TriMesh {
  const positions = inflateSync(fromBase64(encoded.positions))
  const triangles = inflateSync(fromBase64(encoded.triangles))
  return createMesh(
    new Float32Array(positions.buffer, positions.byteOffset, positions.byteLength / 4),
    new Uint32Array(triangles.buffer, triangles.byteOffset, triangles.byteLength / 4),
    encoded.groups,
  )
}

function mix(text: string, seed: number): [number, number] {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return [h1 >>> 0, h2 >>> 0]
}

export function meshDataId(encoded: EncodedMesh): string {
  const text = `${encoded.positions}|${encoded.triangles}|${JSON.stringify(encoded.groups ?? [])}`
  const [a, b] = mix(text, 0)
  const [c, d] = mix(text, 1)
  return `mesh-${[a, b, c, d].map((part) => part.toString(16).padStart(8, '0')).join('')}`
}
