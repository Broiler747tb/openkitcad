import type { ShapeOps } from './types'

interface Entry<S, V> {
  shape: S
  value: V
}

export class ShapeIndex<S, V> {
  private readonly ops: ShapeOps<S>
  private readonly buckets = new Map<number, Entry<S, V>[]>()
  private count = 0

  constructor(ops: ShapeOps<S>) {
    this.ops = ops
  }

  get size(): number {
    return this.count
  }

  private find(shape: S): Entry<S, V> | undefined {
    const bucket = this.buckets.get(this.ops.hash(shape))
    return bucket?.find((entry) => this.ops.same(entry.shape, shape))
  }

  has(shape: S): boolean {
    return this.find(shape) !== undefined
  }

  get(shape: S): V | undefined {
    return this.find(shape)?.value
  }

  set(shape: S, value: V): boolean {
    const existing = this.find(shape)
    if (existing) {
      existing.value = value
      return false
    }
    const hash = this.ops.hash(shape)
    const bucket = this.buckets.get(hash)
    if (bucket) bucket.push({ shape, value })
    else this.buckets.set(hash, [{ shape, value }])
    this.count++
    return true
  }

  *entries(): IterableIterator<[S, V]> {
    for (const bucket of this.buckets.values()) {
      for (const entry of bucket) yield [entry.shape, entry.value]
    }
  }
}
