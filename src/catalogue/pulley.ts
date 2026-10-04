export function pulleyDimensions(teeth: number, width: number) {
  const flange = 0.8
  const belt = Math.min(6, width - flange * 2)
  return { flange, belt, radius: ((teeth * 2) / Math.PI - 0.508) / 2, hubStart: belt + flange * 2 }
}
