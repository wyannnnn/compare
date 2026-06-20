import Decimal from 'decimal.js'
import type { CardDraft, MeasureKind, PriceCalculation, PriceCard } from './types'
import { NORMALIZED_UNIT_LABELS } from './types'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function positiveDecimal(value: string, label: string): Decimal {
  let parsed: Decimal
  try {
    parsed = new Decimal(value)
  } catch {
    throw new ValidationError(`${label}格式不正确`)
  }
  if (!parsed.isFinite() || parsed.lte(0)) {
    throw new ValidationError(`${label}必须大于 0`)
  }
  return parsed
}

function positiveInteger(value: number, label: string): Decimal {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${label}必须是大于 0 的整数`)
  }
  return new Decimal(value)
}

export function calculatePrice(
  value: Pick<CardDraft, 'totalPrice' | 'packageCount' | 'unitsPerPackage' | 'contentPerUnit' | 'contentUnit'>,
  measureKind: MeasureKind
): PriceCalculation {
  const totalPrice = positiveDecimal(value.totalPrice, '总价')
  const packageCount = positiveInteger(value.packageCount, '包装数量')
  const unitsPerPackage = positiveInteger(value.unitsPerPackage, '每包装件数')
  const totalUnits = packageCount.mul(unitsPerPackage)
  const pricePerUnit = totalPrice.div(totalUnits)
  let normalizedQuantity = totalUnits

  if (measureKind === 'volume') {
    if (value.contentUnit !== 'ml' && value.contentUnit !== 'L') {
      throw new ValidationError('容量单位必须是 ml 或 L')
    }
    const content = positiveDecimal(value.contentPerUnit ?? '', '每件容量')
    const liters = value.contentUnit === 'ml' ? content.div(1000) : content
    normalizedQuantity = totalUnits.mul(liters)
  }

  if (measureKind === 'weight') {
    if (value.contentUnit !== 'g' && value.contentUnit !== 'kg') {
      throw new ValidationError('重量单位必须是 g 或 kg')
    }
    const content = positiveDecimal(value.contentPerUnit ?? '', '每件重量')
    const kilograms = value.contentUnit === 'g' ? content.div(1000) : content
    normalizedQuantity = totalUnits.mul(kilograms)
  }

  return {
    totalUnits: totalUnits.toString(),
    normalizedQuantity: normalizedQuantity.toString(),
    pricePerUnit: pricePerUnit.toString(),
    normalizedPrice: totalPrice.div(normalizedQuantity).toString(),
    normalizedUnitLabel: NORMALIZED_UNIT_LABELS[measureKind]
  }
}

export function findLowestCardIds(cards: PriceCard[], measureKind: MeasureKind): Set<string> {
  if (cards.length === 0) return new Set()
  const prices = cards.map((card) => ({
    id: card.id,
    rounded: new Decimal(calculatePrice(card, measureKind).normalizedPrice).toDecimalPlaces(4)
  }))
  const minimum = Decimal.min(...prices.map((entry) => entry.rounded))
  return new Set(prices.filter((entry) => entry.rounded.eq(minimum)).map((entry) => entry.id))
}

export function normalizePositiveDecimal(value: string, label: string): string {
  return positiveDecimal(value.trim(), label).toString()
}
