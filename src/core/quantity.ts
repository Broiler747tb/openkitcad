const LENGTH: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

export function quantity(input: string, unit = '', variable?: (name: string) => number): number {
  if (!input.trim() || input.length > 256) throw new Error('Enter a number or a short expression.')
  const isLength = unit in LENGTH
  const scale = isLength ? LENGTH[unit] : 1
  const text = input.toLowerCase()
  let pos = 0
  const skip = () => {
    while (/\s/.test(text[pos] ?? '') && pos < text.length) pos++
  }
  function atom(): number {
    skip()
    if (text[pos] === '+' || text[pos] === '-') {
      const sign = text[pos++] === '-' ? -1 : 1
      return sign * atom()
    }
    let value: number
    if (text[pos] === '(') {
      pos++
      value = sum()
      skip()
      if (text[pos++] !== ')') throw new Error('Missing closing parenthesis.')
    } else if (/^[a-z_]/.test(text.slice(pos))) {
      const name = text.slice(pos).match(/^[a-z_][a-z0-9_]*/)![0]
      pos += name.length
      if (name === 'pi') value = Math.PI
      else if (variable) value = variable(name) / scale
      else throw new Error(`Unknown parameter: ${name}`)
    } else {
      const match = text.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/)
      if (!match) throw new Error('Use numbers, pi, + − * / and parentheses.')
      pos += match[0].length
      value = Number(match[0])
    }
    skip()
    const suffix = text.slice(pos).match(/^(mm|cm|ft|in|m|deg|rad|°)/)?.[0]
    if (suffix) {
      pos += suffix.length
      if (isLength && suffix in LENGTH) {
        value *= LENGTH[suffix] / scale
      } else if (['°', 'deg', 'degrees'].includes(unit) && ['deg', 'rad', '°'].includes(suffix)) {
        if (suffix === 'rad') value *= 180 / Math.PI
      } else throw new Error(`Unit ${suffix} is not valid for this ${unit || 'unitless'} field.`)
    }
    return value
  }
  function product(): number {
    let value = atom()
    skip()
    while (text[pos] === '*' || text[pos] === '/') {
      const op = text[pos++],
        right = atom()
      if (op === '/' && right === 0) throw new Error('Cannot divide by zero.')
      value = op === '*' ? value * right : value / right
      skip()
    }
    return value
  }
  function sum(): number {
    let value = product()
    skip()
    while (text[pos] === '+' || text[pos] === '-') {
      const op = text[pos++],
        right = product()
      value = op === '+' ? value + right : value - right
      skip()
    }
    return value
  }
  const result = sum()
  skip()
  if (pos !== text.length || !Number.isFinite(result))
    throw new Error('Invalid or non-finite expression.')
  return result * scale
}
