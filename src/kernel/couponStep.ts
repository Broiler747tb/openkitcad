import {
  Blueprints,
  downcast,
  draw,
  drawRectangle,
  Drawing,
  getOC,
  makeCylinder,
  type Blueprint,
} from 'replicad'
import type { Vec2 } from '../core/math'
import type { Feature, FitCouponFeature } from '../doc/types'
import { place } from './fitSteps'
import { nameShape, type OC, type OcShape } from './naming'
import type { SolidStage } from './solidSteps'

const LABEL_HEIGHT = 4.5
const LABEL_STROKE = 0.6
const LABEL_DEPTH = 0.5
const EDGE = 3
const SPACING = 3
const BETWEEN = 4

const SEGMENTS: Record<string, readonly string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'd', 'c'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
}

function digitWidth(height: number): number {
  return height * 0.62
}

function textWidth(text: string, height: number): number {
  const width = digitWidth(height)
  return text.length * width + Math.max(0, text.length - 1) * height * 0.22
}

function digitBars(digit: string, at: Vec2, height: number): Blueprint[] {
  const names = SEGMENTS[digit]
  if (!names) return []
  const stroke = (height / LABEL_HEIGHT) * LABEL_STROKE
  const width = digitWidth(height)
  const gap = stroke * 0.18
  const bar = (x: number, y: number, w: number, h: number) =>
    (
      drawRectangle(w, h).translate(at[0] + x + w / 2, at[1] + y + h / 2) as unknown as {
        innerShape: Blueprint
      }
    ).innerShape
  const across = width - stroke - 2 * gap
  const tall = (height - 3 * stroke) / 2 - 2 * gap
  const upper = (height + stroke) / 2 + gap
  const lower = stroke + gap
  const parts: Record<string, () => Blueprint> = {
    a: () => bar(stroke / 2 + gap, height - stroke, across, stroke),
    b: () => bar(width - stroke, upper, stroke, tall),
    c: () => bar(width - stroke, lower, stroke, tall),
    d: () => bar(stroke / 2 + gap, 0, across, stroke),
    e: () => bar(0, lower, stroke, tall),
    f: () => bar(0, upper, stroke, tall),
    g: () => bar(stroke / 2 + gap, (height - stroke) / 2, across, stroke),
  }
  return names.map((name) => parts[name]())
}

function textBars(text: string, at: Vec2, height: number): Blueprint[] {
  const pitch = digitWidth(height) + height * 0.22
  return [...text].flatMap((digit, index) =>
    digitBars(digit, [at[0] + index * pitch, at[1]], height),
  )
}

export interface CouponLayout {
  gaps: number[]
  radius: number
  cardWidth: number
  cardDepth: number
  left: number
  bottom: number
  pinY: number
  holeY: number
  centreOf(index: number): number
}

export function couponLayout(coupon: {
  origin: Vec2
  diameter: number
  start: number
  step: number
  count: number
}): CouponLayout {
  const rungs = Math.round(coupon.count)
  const gaps = Array.from({ length: rungs }, (_, i) => coupon.start + i * coupon.step)
  const radius = coupon.diameter / 2
  const widest = radius + Math.max(...gaps)
  const labels = gaps.map((gap) => String(Math.round(gap * 100)))
  const pitch = Math.max(2 * widest + SPACING, textWidth(labels[0], LABEL_HEIGHT) + SPACING)
  const cardWidth = rungs * pitch + 2 * EDGE
  const cardDepth = 2 * widest + SPACING + LABEL_HEIGHT + 2 * EDGE
  const left = coupon.origin[0] - cardWidth / 2
  const bottom = coupon.origin[1] - (2 * cardDepth + BETWEEN) / 2
  const pinY = EDGE + LABEL_HEIGHT + SPACING + widest
  return {
    gaps,
    radius,
    cardWidth,
    cardDepth,
    left,
    bottom,
    pinY: bottom + pinY,
    holeY: bottom + cardDepth + BETWEEN + pinY,
    centreOf: (index) => left + EDGE + pitch * (index + 0.5),
  }
}

type Solid = {
  fuse(other: Solid): Solid
  cut(other: Solid): Solid
  translate(vector: [number, number, number]): Solid
  wrapped: OcShape
}

function pinSolid(radius: number, height: number): Solid {
  const lead = Math.min(0.4, radius / 3, height / 3)
  return draw([0, 0])
    .lineTo([radius, 0])
    .lineTo([radius, height - lead])
    .lineTo([radius - lead, height])
    .lineTo([0, height])
    .close()
    .sketchOnPlane('XZ')
    .revolve([0, 0, 1]) as unknown as Solid
}

export function runCouponStep(feature: Feature, stage: SolidStage): boolean {
  if (feature.kind !== 'fitCoupon') return false
  const oc = getOC() as unknown as OC
  const coupon = feature as FitCouponFeature
  const rungs = Math.round(coupon.count)
  if (!(coupon.diameter > 0) || !(coupon.thickness > 0) || !(coupon.height > 0)) {
    stage.report('error', 'The coupon needs a pin size, a plate thickness and a pin height.')
    return true
  }
  if (rungs < 2 || rungs > 12) {
    stage.report('error', 'A coupon has between 2 and 12 rungs.')
    return true
  }
  if (!(coupon.step > 0)) {
    stage.report('error', 'The step between rungs has to be more than zero.')
    return true
  }
  const layout = couponLayout(coupon)
  const gaps = layout.gaps
  if (gaps.some((gap) => gap < 0)) {
    stage.report('error', 'The rungs run into gaps below zero.', 'Raise the first gap.')
    return true
  }
  const radius = layout.radius
  if (gaps[gaps.length - 1] >= radius) {
    stage.report(
      'error',
      'The last rung is looser than the pin is wide.',
      'Use a smaller step, or fewer rungs.',
    )
    return true
  }
  const labels = gaps.map((gap) => String(Math.round(gap * 100)))
  const { cardWidth, cardDepth, left, bottom, centreOf } = layout

  const card = (row: number): Solid => {
    const y = bottom + row * (cardDepth + BETWEEN)
    let shape = drawRectangle(cardWidth, cardDepth)
      .translate(left + cardWidth / 2, y + cardDepth / 2)
      .sketchOnPlane('XY')
      .extrude(coupon.thickness) as unknown as Solid
    const bars = labels.flatMap((text, index) =>
      textBars(text, [centreOf(index) - textWidth(text, LABEL_HEIGHT) / 2, y + EDGE], LABEL_HEIGHT),
    )
    if (bars.length) {
      const pocket = new Drawing(new Blueprints(bars))
        .sketchOnPlane('XY', coupon.thickness - LABEL_DEPTH)
        .extrude(LABEL_DEPTH * 2) as unknown as Solid
      shape = shape.cut(pocket)
    }
    return shape
  }

  const pins = () => {
    let shape = card(0)
    gaps.forEach((_, index) => {
      const pin = pinSolid(radius, coupon.height).translate([
        centreOf(index),
        layout.pinY,
        coupon.thickness,
      ])
      shape = shape.fuse(pin)
    })
    return shape
  }

  const holes = () => {
    let shape = card(1)
    gaps.forEach((gap, index) => {
      const hole = makeCylinder(
        radius + gap,
        coupon.thickness + 2,
        [centreOf(index), layout.holeY, -1],
        [0, 0, 1],
      ) as unknown as Solid
      shape = shape.cut(hole)
    })
    return shape
  }

  const frame = stage.planeOf(coupon.plane)
  const named = (id: string, shape: Solid) =>
    nameShape(oc, id, downcast(place(shape, frame).wrapped) as unknown as OcShape)
  stage.set(coupon.pinBodyId, named(`${coupon.id}:pins`, pins()))
  stage.set(coupon.holeBodyId, named(`${coupon.id}:holes`, holes()))
  return true
}
