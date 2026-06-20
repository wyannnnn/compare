import Decimal from 'decimal.js'
import type { CardDraft, ContentUnit, MeasureKind, PriceCalculation, PriceCard, VolumeUnit, WeightUnit } from './types'
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
  value: Pick<CardDraft, 'totalPrice' | 'packageCount' | 'unitsPerPackage' | 'contentPerUnit' | 'contentUnit' | 'volumePerUnit' | 'volumeUnit' | 'weightPerUnit' | 'weightUnit'>,
  measureKind: MeasureKind
): PriceCalculation {
  const totalPrice = positiveDecimal(value.totalPrice, '总价')
  const packageCount = positiveInteger(value.packageCount, '包装数量')
  const unitsPerPackage = positiveInteger(value.unitsPerPackage, '每包装件数')
  const totalUnits = packageCount.mul(unitsPerPackage)
  const pricePerUnit = totalPrice.div(totalUnits)
  let normalizedQuantity = totalUnits

  if (measureKind === 'volume') {
    const unit = resolveVolumeUnit(value)
    if (!unit) {
      throw new ValidationError('容量单位必须是 ml 或 L')
    }
    const content = positiveDecimal(resolveVolumePerUnit(value), '每件容量')
    const liters = unit === 'ml' ? content.div(1000) : content
    normalizedQuantity = totalUnits.mul(liters)
  }

  if (measureKind === 'weight') {
    const unit = resolveWeightUnit(value)
    if (!unit) {
      throw new ValidationError('重量单位必须是 g 或 kg')
    }
    const content = positiveDecimal(resolveWeightPerUnit(value), '每件重量')
    const kilograms = unit === 'g' ? content.div(1000) : content
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

function resolveVolumeUnit(value: Pick<CardDraft, 'contentUnit' | 'volumeUnit'>): VolumeUnit | null {
  if (value.volumeUnit === 'ml' || value.volumeUnit === 'L') return value.volumeUnit
  if (value.contentUnit === 'ml' || value.contentUnit === 'L') return value.contentUnit
  return null
}

function resolveWeightUnit(value: Pick<CardDraft, 'contentUnit' | 'weightUnit'>): WeightUnit | null {
  if (value.weightUnit === 'g' || value.weightUnit === 'kg') return value.weightUnit
  if (value.contentUnit === 'g' || value.contentUnit === 'kg') return value.contentUnit
  return null
}

function resolveVolumePerUnit(value: Pick<CardDraft, 'contentPerUnit' | 'contentUnit' | 'volumePerUnit'>): string {
  if (value.volumePerUnit != null) return value.volumePerUnit
  if (value.contentUnit === 'ml' || value.contentUnit === 'L') return value.contentPerUnit ?? ''
  return ''
}

function resolveWeightPerUnit(value: Pick<CardDraft, 'contentPerUnit' | 'contentUnit' | 'weightPerUnit'>): string {
  if (value.weightPerUnit != null) return value.weightPerUnit
  if (value.contentUnit === 'g' || value.contentUnit === 'kg') return value.contentPerUnit ?? ''
  return ''
}

export function tryCalculatePrice(
  value: Pick<CardDraft, 'totalPrice' | 'packageCount' | 'unitsPerPackage' | 'contentPerUnit' | 'contentUnit' | 'volumePerUnit' | 'volumeUnit' | 'weightPerUnit' | 'weightUnit'>,
  measureKind: MeasureKind
): PriceCalculation | null {
  try {
    return calculatePrice(value, measureKind)
  } catch {
    return null
  }
}

export function findLowestCardIds(cards: PriceCard[], measureKind: MeasureKind): Set<string> {
  if (cards.length === 0) return new Set()
  const prices = cards.flatMap((card) => {
    const result = tryCalculatePrice(card, measureKind)
    return result ? [{ id: card.id, rounded: new Decimal(result.normalizedPrice).toDecimalPlaces(4) }] : []
  })
  if (prices.length === 0) return new Set()
  const minimum = Decimal.min(...prices.map((entry) => entry.rounded))
  return new Set(prices.filter((entry) => entry.rounded.eq(minimum)).map((entry) => entry.id))
}

export function normalizePositiveDecimal(value: string, label: string): string {
  return positiveDecimal(value.trim(), label).toString()
}
