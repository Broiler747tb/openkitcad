import { deflateSync, strToU8 } from 'fflate'
import { canonicalJson } from '../core/canonical'
import { emptyDocument } from '../doc/types'
import { createShareLink, readSharedSnapshot, isSharedView, PUBLIC_APP_URL } from '../doc/share'
import { encodeCompactDocument, decodeCompactDocument, shareChecksum } from '../doc/shareCodec'
import { serialise } from '../doc/persist'
import type { TestResult } from './selftest'

export function runShareTest(): TestResult[] {
  const results: TestResult[] = []
  const check = (name: string, run: () => void) => {
    try {
      run()
      results.push({ name: `share: ${name}`, pass: true, detail: 'OK' })
    } catch (error) {
      results.push({ name: `share: ${name}`, pass: false, detail: String(error) })
    }
  }
  const assert = (condition: boolean) => {
    if (!condition) throw new Error('Assertion failed')
  }
  const rejects = (run: () => unknown) => {
    let failed = false
    try {
      run()
    } catch {
      failed = true
    }
    assert(failed)
  }
  const hashOf = (bytes: Uint8Array, key = 'm=1.') => {
    if (key === 'm=1.') {
      const payload = new Uint8Array(bytes.length + 4)
      payload.set(bytes)
      new DataView(payload.buffer).setUint32(bytes.length, shareChecksum(bytes), true)
      bytes = payload
    }
    return (
      '#' +
      key +
      btoa(String.fromCharCode(...deflateSync(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    )
  }
  const doc = emptyDocument('Корпус 🔧')
  doc.components[0].bodies = [
    { id: 'body-c21f8f01', name: 'Box', visible: true, colour: '#ffffff' },
  ]
  doc.timeline = [
    {
      id: 'feature-920df0a9',
      name: 'Box',
      componentId: doc.rootComponentId,
      kind: 'box',
      plane: { kind: 'named', name: 'XY', offset: 0 },
      origin: [0, 0],
      width: Math.PI,
      depth: 20,
      height: 0.1,
      result: { kind: 'newBody', bodyId: 'body-c21f8f01' },
    },
  ]
  check('public link is independent of the current page or Portable path', () =>
    assert(createShareLink(doc).startsWith(PUBLIC_APP_URL + '#m=1.')),
  )
  check('dimensions, names, IDs and references survive exactly', () =>
    assert(
      canonicalJson(readSharedSnapshot(new URL(createShareLink(doc)).hash)) ===
        canonicalJson(JSON.parse(serialise(doc))),
    ),
  )
  check('creating a snapshot leaves the original untouched', () => {
    const before = canonicalJson(doc)
    createShareLink(doc)
    assert(before === canonicalJson(doc))
  })
  check('viewing does not change browser storage', () => {
    const before = localStorage.getItem('openkitcad.autosave.v2')
    const parts = localStorage.getItem('openkitcad.userparts.v1')
    readSharedSnapshot(new URL(createShareLink(doc)).hash)
    assert(
      localStorage.getItem('openkitcad.autosave.v2') === before &&
        localStorage.getItem('openkitcad.userparts.v1') === parts,
    )
  })
  check('older JSON view links still open', () =>
    assert(
      canonicalJson(readSharedSnapshot(hashOf(strToU8(JSON.stringify(doc)), 'd=') + '&view=1')) ===
        canonicalJson(doc),
    ),
  )
  check('new viewer routing leaves older editable links alone', () =>
    assert(
      isSharedView('#m=1.abc') &&
        isSharedView('#d=abc&view=1') &&
        !isSharedView('#d=abc') &&
        !isSharedView(''),
    ),
  )
  check('unknown future fields survive binary encoding', () => {
    const data = { ...doc, extension: { kind: 'new-operation', future: [true, false, null, ''] } }
    assert(
      canonicalJson(decodeCompactDocument(encodeCompactDocument(data))) === canonicalJson(data),
    )
  })
  check('JSON fallback payload opens without losing fields', () => {
    const json = strToU8(JSON.stringify(doc))
    const data = new Uint8Array(json.length + 1)
    data.set(json, 1)
    assert(canonicalJson(readSharedSnapshot(hashOf(data))) === canonicalJson(doc))
  })
  check('future format versions require an update', () =>
    rejects(() => readSharedSnapshot('#m=2.abc')),
  )
  check('a changed dimension cannot slip past the checksum', () => {
    const binary = encodeCompactDocument(doc)
    const payload = new Uint8Array(binary.length + 5)
    payload[0] = 1
    payload.set(binary, 1)
    new DataView(payload.buffer).setUint32(
      payload.length - 4,
      shareChecksum(payload.subarray(0, -4)),
      true,
    )
    payload[10] ^= 1
    rejects(() => readSharedSnapshot(hashOf(payload, 'raw=').replace('#raw=', '#m=1.')))
  })
  check('damaged and truncated links are rejected', () => {
    rejects(() => readSharedSnapshot('#m=1.abcd'))
    rejects(() => readSharedSnapshot('#m=1.'))
    rejects(() => readSharedSnapshot('#m=1.a%20b'))
  })
  check('invalid document structure is rejected', () =>
    rejects(() =>
      readSharedSnapshot(hashOf(strToU8(JSON.stringify({ ...doc, components: null })), 'd=')),
    ),
  )
  check('a missing imported mesh cannot be shared', () => {
    const missing = structuredClone(doc)
    missing.timeline = [
      {
        id: 'mesh',
        name: 'Mesh',
        componentId: 'root',
        kind: 'meshInsert',
        bodyId: 'body',
        dataId: 'never-present',
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        unit: 'mm',
        yUp: false,
        centre: false,
        ground: false,
      },
    ]
    rejects(() => createShareLink(missing))
    rejects(() => readSharedSnapshot(hashOf(strToU8(JSON.stringify(missing)), 'd=')))
  })
  check('oversized links are rejected before copying', () => {
    const large = {
      ...doc,
      name: Array.from({ length: 20_000 }, (_, i) =>
        String.fromCharCode(32 + ((i * i * 79 + i * 283) % 90)),
      ).join(''),
    }
    const huge = {
      ...large,
      extension: Array.from({ length: 3_000 }, (_, i) => crypto.randomUUID() + i),
    }
    rejects(() => createShareLink(huge))
    rejects(() => readSharedSnapshot('#m=1.' + 'a'.repeat(8_000)))
  })
  return results
}
