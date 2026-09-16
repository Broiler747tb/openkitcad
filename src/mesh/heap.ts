export class MinHeap<T> {
  private keys: number[] = []
  private items: T[] = []

  get size(): number {
    return this.keys.length
  }

  peekKey(): number {
    return this.keys.length ? this.keys[0] : Infinity
  }

  push(key: number, item: T) {
    const keys = this.keys
    const items = this.items
    let i = keys.length
    keys.push(key)
    items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      items[i] = items[parent]
      i = parent
    }
    keys[i] = key
    items[i] = item
  }

  pop(): T | undefined {
    const keys = this.keys
    const items = this.items
    if (!keys.length) return undefined
    const top = items[0]
    const lastKey = keys.pop()!
    const lastItem = items.pop()!
    const count = keys.length
    if (count) {
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= count) break
        const right = left + 1
        const child = right < count && keys[right] < keys[left] ? right : left
        if (keys[child] >= lastKey) break
        keys[i] = keys[child]
        items[i] = items[child]
        i = child
      }
      keys[i] = lastKey
      items[i] = lastItem
    }
    return top
  }
}
