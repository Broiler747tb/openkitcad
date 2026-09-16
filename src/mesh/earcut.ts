interface Node {
  i: number
  x: number
  y: number
  prev: Node
  next: Node
}

function createNode(i: number, x: number, y: number): Node {
  const node = { i, x, y } as Node
  node.prev = node
  node.next = node
  return node
}

function insertNode(i: number, x: number, y: number, last: Node | null): Node {
  const node = createNode(i, x, y)
  if (last) {
    node.next = last.next
    node.prev = last
    last.next.prev = node
    last.next = node
  }
  return node
}

function removeNode(node: Node) {
  node.next.prev = node.prev
  node.prev.next = node.next
}

function turn(a: Node, b: Node, c: Node): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function equals(a: Node, b: Node): boolean {
  return a.x === b.x && a.y === b.y
}

function ringArea(coords: ArrayLike<number>, start: number, end: number): number {
  let sum = 0
  for (let i = start, j = end - 1; i < end; j = i++) {
    sum += coords[j * 2] * coords[i * 2 + 1] - coords[i * 2] * coords[j * 2 + 1]
  }
  return sum / 2
}

function linkedRing(
  coords: ArrayLike<number>,
  start: number,
  end: number,
  counterClockwise: boolean,
): Node | null {
  let last: Node | null = null
  if (counterClockwise === ringArea(coords, start, end) > 0) {
    for (let i = start; i < end; i++) last = insertNode(i, coords[i * 2], coords[i * 2 + 1], last)
  } else {
    for (let i = end - 1; i >= start; i--) {
      last = insertNode(i, coords[i * 2], coords[i * 2 + 1], last)
    }
  }
  if (last && last !== last.next && last.i === last.next.i) {
    const next = last.next
    removeNode(last)
    last = next
  }
  return last
}

function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return (
    (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0 &&
    (cx - bx) * (py - by) - (cy - by) * (px - bx) >= 0 &&
    (ax - cx) * (py - cy) - (ay - cy) * (px - cx) >= 0
  )
}

function isEar(ear: Node): boolean {
  const a = ear.prev
  const b = ear
  const c = ear.next
  if (turn(a, b, c) <= 0) return false
  const minX = Math.min(a.x, b.x, c.x)
  const minY = Math.min(a.y, b.y, c.y)
  const maxX = Math.max(a.x, b.x, c.x)
  const maxY = Math.max(a.y, b.y, c.y)
  let p = c.next
  while (p !== a) {
    if (
      p.x >= minX &&
      p.x <= maxX &&
      p.y >= minY &&
      p.y <= maxY &&
      !(p.x === a.x && p.y === a.y) &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
      turn(p.prev, p, p.next) <= 0
    ) {
      return false
    }
    p = p.next
  }
  return true
}

function filterPoints(start: Node | null, end?: Node | null, loose = true): Node | null {
  if (!start) return start
  let stop = end ?? start
  let p = start
  let again: boolean
  do {
    again = false
    const redundant = loose
      ? equals(p, p.next) || turn(p.prev, p, p.next) === 0
      : p.i === p.next.i || (p.prev.i === p.next.i && p.prev !== p.next)
    if (redundant) {
      removeNode(p)
      p = stop = p.prev
      if (p === p.next) break
      again = true
    } else {
      p = p.next
    }
  } while (again || p !== stop)
  return stop
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function onSegment(p: Node, q: Node, r: Node): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  )
}

function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(turn(p1, q1, p2))
  const o2 = sign(turn(p1, q1, q2))
  const o3 = sign(turn(p2, q2, p1))
  const o4 = sign(turn(p2, q2, q1))
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, q2, q1)) return true
  if (o3 === 0 && onSegment(p2, p1, q2)) return true
  if (o4 === 0 && onSegment(p2, q1, q2)) return true
  return false
}

function locallyInside(a: Node, b: Node): boolean {
  return turn(a.prev, a, a.next) > 0
    ? turn(a, b, a.next) <= 0 && turn(a, a.prev, b) <= 0
    : turn(a, b, a.prev) > 0 || turn(a, a.next, b) > 0
}

function middleInside(a: Node, b: Node): boolean {
  let p = a
  let inside = false
  const px = (a.x + b.x) / 2
  const py = (a.y + b.y) / 2
  do {
    if (
      p.y > py !== p.next.y > py &&
      p.next.y !== p.y &&
      px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
    ) {
      inside = !inside
    }
    p = p.next
  } while (p !== a)
  return inside
}

function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a
  do {
    if (
      p.i !== a.i &&
      p.next.i !== a.i &&
      p.i !== b.i &&
      p.next.i !== b.i &&
      intersects(p, p.next, a, b)
    ) {
      return true
    }
    p = p.next
  } while (p !== a)
  return false
}

function isValidDiagonal(a: Node, b: Node): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) &&
      locallyInside(b, a) &&
      middleInside(a, b) &&
      (turn(a.prev, a, b.prev) !== 0 || turn(a, b.prev, b) !== 0)) ||
      (equals(a, b) && turn(a.prev, a, a.next) < 0 && turn(b.prev, b, b.next) < 0))
  )
}

function splitPolygon(a: Node, b: Node): Node {
  const a2 = createNode(a.i, a.x, a.y)
  const b2 = createNode(b.i, b.x, b.y)
  const an = a.next
  const bp = b.prev
  a.next = b
  b.prev = a
  a2.next = an
  an.prev = a2
  b2.next = a2
  a2.prev = b2
  bp.next = b2
  b2.prev = bp
  return b2
}

function cureLocalIntersections(start: Node, out: number[]): Node | null {
  let p = start
  let stop = start
  do {
    const a = p.prev
    const b = p.next.next
    if (
      !equals(a, b) &&
      intersects(a, p, p.next, b) &&
      locallyInside(a, b) &&
      locallyInside(b, a)
    ) {
      out.push(a.i, p.i, b.i)
      removeNode(p)
      removeNode(p.next)
      p = stop = b
    }
    p = p.next
  } while (p !== stop)
  return filterPoints(p)
}

function splitEarcut(start: Node, out: number[]) {
  let a = start
  do {
    let b = a.next.next
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: Node | null = splitPolygon(a, b)
        const first = filterPoints(a, a.next)
        c = filterPoints(c, c.next)
        earcutLinked(first, out, 0)
        earcutLinked(c, out, 0)
        return
      }
      b = b.next
    }
    a = a.next
  } while (a !== start)
}

function earcutLinked(start: Node | null, out: number[], pass: number) {
  if (!start) return
  let ear = start
  let stop = ear
  while (ear.prev !== ear.next) {
    const prev = ear.prev
    const next = ear.next
    if (isEar(ear)) {
      out.push(prev.i, ear.i, next.i)
      removeNode(ear)
      ear = next.next
      stop = next.next
      continue
    }
    ear = next
    if (ear === stop) {
      if (pass === 0) {
        earcutLinked(filterPoints(ear), out, 1)
      } else if (pass === 1) {
        const filtered = filterPoints(ear)
        earcutLinked(filtered ? cureLocalIntersections(filtered, out) : null, out, 2)
      } else if (pass === 2) {
        splitEarcut(ear, out)
      }
      break
    }
  }
}

function leftmost(start: Node): Node {
  let p = start
  let best = start
  do {
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) best = p
    p = p.next
  } while (p !== start)
  return best
}

function sectorContainsSector(m: Node, p: Node): boolean {
  return turn(m.prev, m, p.prev) > 0 && turn(p.next, m, m.next) > 0
}

function findHoleBridge(hole: Node, outer: Node): Node | null {
  let p = outer
  const hx = hole.x
  const hy = hole.y
  let qx = -Infinity
  let m: Node | null = null
  if (equals(hole, p)) return p
  do {
    if (equals(hole, p.next)) return p.next
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y)
      if (x <= hx && x > qx) {
        qx = x
        m = p.x < p.next.x ? p : p.next
        if (x === hx) return m
      }
    }
    p = p.next
  } while (p !== outer)
  if (!m) return null
  const stop = m
  const mx = m.x
  const my = m.y
  let tanMin = Infinity
  p = m
  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x)
      if (
        locallyInside(p, hole) &&
        (tan < tanMin ||
          (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))
      ) {
        m = p
        tanMin = tan
      }
    }
    p = p.next
  } while (p !== stop)
  return m
}

function eliminateHoles(
  coords: ArrayLike<number>,
  holeStarts: number[],
  vertexTotal: number,
  outer: Node,
): Node {
  const queue: Node[] = []
  for (let k = 0; k < holeStarts.length; k++) {
    const start = holeStarts[k]
    const end = k < holeStarts.length - 1 ? holeStarts[k + 1] : vertexTotal
    if (end - start < 1) continue
    const ring = linkedRing(coords, start, end, false)
    if (ring) queue.push(leftmost(ring))
  }
  queue.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x
    if (a.y !== b.y) return a.y - b.y
    return (a.next.y - a.y) / (a.next.x - a.x) - (b.next.y - b.y) / (b.next.x - b.x)
  })
  let result = outer
  for (const hole of queue) {
    const bridge = findHoleBridge(hole, result)
    if (!bridge) continue
    const reverse = splitPolygon(bridge, hole)
    filterPoints(reverse, reverse.next, false)
    result = filterPoints(bridge, bridge.next, false) ?? result
  }
  return result
}

export function triangulate2D(coords: ArrayLike<number>, holeStarts: number[] = []): number[] {
  const vertexTotal = Math.floor(coords.length / 2)
  const outerEnd = holeStarts.length ? holeStarts[0] : vertexTotal
  const out: number[] = []
  let outer = linkedRing(coords, 0, outerEnd, true)
  if (!outer || outer.next === outer.prev) return out
  if (holeStarts.length) outer = eliminateHoles(coords, holeStarts, vertexTotal, outer)
  earcutLinked(outer, out, 0)
  return out
}
