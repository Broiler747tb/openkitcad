import { getOC } from 'replicad'

export type Bounds = [number, number, number, number, number, number]

export function exactBounds(shape: any): Bounds {
  const oc = getOC() as any
  const box = new oc.Bnd_Box_1()
  try {
    oc.BRepBndLib.AddOptimal(shape.wrapped ?? shape, box, false, false)
    const low = box.CornerMin()
    const high = box.CornerMax()
    const out: Bounds = [low.X(), low.Y(), low.Z(), high.X(), high.Y(), high.Z()]
    low.delete()
    high.delete()
    return out
  } finally {
    box.delete()
  }
}

export function boundsCentre(bounds: Bounds): [number, number, number] {
  return [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2]
}

export function unionBounds(all: readonly Bounds[]): Bounds {
  const out: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const bounds of all) {
    for (let i = 0; i < 3; i++) {
      out[i] = Math.min(out[i], bounds[i])
      out[i + 3] = Math.max(out[i + 3], bounds[i + 3])
    }
  }
  return out
}
