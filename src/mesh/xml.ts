export interface XmlHandler {
  open(name: string, attributes: Record<string, string>): void
  close(name: string): void
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(value: string): string {
  if (value.indexOf('&') < 0) return value
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function localName(name: string): string {
  const colon = name.lastIndexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

function tagEnd(text: string, from: number): number {
  let quote = 0
  for (let i = from; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (quote) {
      if (code === quote) quote = 0
    } else if (code === 34 || code === 39) {
      quote = code
    } else if (code === 62) {
      return i
    }
  }
  return -1
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function scanXml(text: string, handler: XmlHandler) {
  let i = 0
  const length = text.length
  while (i < length) {
    const lt = text.indexOf('<', i)
    if (lt < 0) break
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      i = end < 0 ? length : end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      i = end < 0 ? length : end + 3
      continue
    }
    const next = text.charCodeAt(lt + 1)
    if (next === 63) {
      const end = text.indexOf('?>', lt + 2)
      i = end < 0 ? length : end + 2
      continue
    }
    const gt = tagEnd(text, lt + 1)
    if (gt < 0) break
    i = gt + 1
    if (next === 33) continue
    if (next === 47) {
      handler.close(localName(text.slice(lt + 2, gt).trim()))
      continue
    }
    let body = text.slice(lt + 1, gt)
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1)
    const nameMatch = /^\s*([^\s/>]+)/.exec(body)
    if (!nameMatch) continue
    const name = localName(nameMatch[1])
    const attributes: Record<string, string> = {}
    ATTRIBUTE.lastIndex = nameMatch[0].length
    let match: RegExpExecArray | null
    while ((match = ATTRIBUTE.exec(body))) {
      const full = match[1]
      if (full === 'xmlns' || full.startsWith('xmlns:')) continue
      const key = localName(full)
      if (!(key in attributes)) attributes[key] = decodeEntities(match[2] ?? match[3] ?? '')
    }
    handler.open(name, attributes)
    if (selfClosing) handler.close(name)
  }
}
