import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'fflate'
import ts from 'typescript'

const source = readFileSync(new URL('../src/doc/shareCodec.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const { encodeCompactDocument: encode, decodeCompactDocument: decode } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)
let checked = 0
for (const file of ['raspberry-pi-enclosure.okc', 'cartesian-printer.okc']) {
  const doc = JSON.parse(readFileSync(new URL('../examples/' + file, import.meta.url), 'utf8'))
  const binary = encode(doc)
  assert.deepEqual(decode(binary), doc, file)
  const old = deflateSync(Buffer.from(JSON.stringify(doc)), { level: 9 }).length
  const packed = deflateSync(binary, { level: 9 }).length
  console.log(`${file}: ${old} → ${packed} compressed bytes; exact round trip`)
  if (file === 'raspberry-pi-enclosure.okc') assert.ok(packed < old * 0.85)
  checked++
}
const precise = {
  format: 'openkitcad',
  version: 2,
  units: 'mm',
  parameters: [],
  bindings: [],
  occurrences: [],
  timeline: [],
  marker: null,
  groups: [],
  name: 'Корпус 🔧',
  id: 'feature-7e929587-e90d-433b-b03e',
  bodyId: 'feature-7e929587-e90d-433b-b03e',
  numbers: [
    0,
    -0,
    1,
    -1,
    127,
    128,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    0.1,
    Math.PI,
    1e-300,
    1e100,
  ],
  extension: {
    kind: 'future-operation',
    arbitrary: [true, false, null, '', { id: 'inner', bodyId: 'inner' }],
  },
  original: JSON.parse('{"__proto__":{"polluted":true}}'),
}
assert.deepEqual(decode(encode(precise)), precise)
assert.equal({}.polluted, undefined)
checked++
const bytes = encode(precise)
for (let i = 0; i < bytes.length; i++) assert.throws(() => decode(bytes.subarray(0, i)))
assert.throws(() => decode(Uint8Array.from([...bytes, 0])))
assert.throws(() => decode(Uint8Array.from([0, 0, 255])))
assert.throws(() => encode({ invalid: Infinity }))
let nested = null
for (let i = 0; i < 110; i++) nested = [nested]
assert.throws(() => encode({ nested }))
checked++
let seed = 12345
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const value = (depth = 0) => {
  const choice = depth > 4 ? Math.floor(random() * 5) : Math.floor(random() * 7)
  if (choice === 0) return null
  if (choice === 1) return random() > 0.5
  if (choice === 2) return (random() - 0.5) * 1e5
  if (choice === 3) return Math.floor((random() - 0.5) * 1e5)
  if (choice === 4)
    return ['box', 'Корпус', 'id', '', 'ref-123456789', 'named'][Math.floor(random() * 6)]
  if (choice === 5) return Array.from({ length: Math.floor(random() * 8) }, () => value(depth + 1))
  return Object.fromEntries(
    Array.from({ length: Math.floor(random() * 8) }, (_, i) => [
      i % 2 ? 'id' : 'unknown-' + i,
      value(depth + 1),
    ]),
  )
}
for (let i = 0; i < 300; i++) {
  const doc = { random: value(), kind: 'box', extra: value() }
  assert.deepEqual(decode(encode(doc)), doc)
}
checked++
console.log(
  `PASS ${checked} codec checks, 300 generated round trips, every truncated prefix rejected`,
)
