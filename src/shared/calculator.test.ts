import { describe, expect, it } from 'vitest'
import { calculatePrice, findLowestCardIds, ValidationError } from './calculator'
import type { CardDraft, PriceCard } from './types'

const base: CardDraft = {
  name: '测试商品',
  totalPrice: '48',
  packageCount: 2,
  unitsPerPackage: 24,
  contentPerUnit: '550',
  contentUnit: 'ml',
  merchant: null,
  note: null,
  source: 'manual'
}

describe('calculatePrice', () => {
  it('计算多箱瓶装水的每瓶和每升价格', () => {
    const result = calculatePrice(base, 'volume')
    expect(result.totalUnits).toBe('48')
    expect(result.normalizedQuantity).toBe('26.4')
    expect(result.pricePerUnit).toBe('1')
    expect(result.normalizedPrice).toBe('1.8181818181818181818')
    expect(result.normalizedUnitLabel).toBe('L')
  })

  it('正确换算升和千克', () => {
    expect(calculatePrice({ ...base, packageCount: 1, unitsPerPackage: 2, contentPerUnit: '1.5', contentUnit: 'L' }, 'volume').normalizedQuantity).toBe('3')
    expect(calculatePrice({ ...base, packageCount: 2, unitsPerPackage: 5, contentPerUnit: '250', contentUnit: 'g' }, 'weight').normalizedQuantity).toBe('2.5')
    expect(calculatePrice({ ...base, packageCount: 1, unitsPerPackage: 2, contentPerUnit: '1.25', contentUnit: 'kg' }, 'weight').normalizedQuantity).toBe('2.5')
  })

  it('保持十进制精度', () => {
    const result = calculatePrice({ ...base, totalPrice: '0.3', packageCount: 1, unitsPerPackage: 3, contentPerUnit: null, contentUnit: null }, 'count')
    expect(result.pricePerUnit).toBe('0.1')
  })

  it('按有效成分占比和倍率计算真实有效单价', () => {
    const result = calculatePrice({
      ...base,
      totalPrice: '100',
      packageCount: 1,
      unitsPerPackage: 1,
      contentPerUnit: '100',
      contentUnit: 'g',
      activeIngredientPercent: '72',
      absorptionMultiplier: '0.65'
    }, 'weight')
    expect(result.normalizedQuantity).toBe('0.1')
    expect(result.effectiveQuantity).toBe('0.0468')
    expect(result.baseNormalizedPrice).toBe('1000')
    expect(result.normalizedPrice).toBe('2136.7521367521367521')
    expect(result.adjustmentFactor).toBe('0.468')
    expect(result.adjusted).toBe(true)
  })

  it('拒绝零值和错误单位', () => {
    expect(() => calculatePrice({ ...base, packageCount: 0 }, 'volume')).toThrow(ValidationError)
    expect(() => calculatePrice({ ...base, contentUnit: 'g' }, 'volume')).toThrow('容量单位')
    expect(() => calculatePrice({ ...base, activeIngredientPercent: '101' }, 'volume')).toThrow('有效成分占比')
  })
})

describe('findLowestCardIds', () => {
  const card = (id: string, totalPrice: string): PriceCard => ({
    id, listId: 'list', name: id, totalPrice, packageCount: 1, unitsPerPackage: 1,
    contentPerUnit: null, contentUnit: null, merchant: null, note: null, source: 'manual',
    volumePerUnit: null, volumeUnit: null, weightPerUnit: null, weightUnit: null,
    activeIngredientPercent: null, absorptionMultiplier: null,
    sortIndex: 0, createdAt: '', updatedAt: ''
  })

  it('按四位小数将并列最低同时高亮', () => {
    const ids = findLowestCardIds([card('a', '1.00001'), card('b', '1.00002'), card('c', '1.1')], 'count')
    expect([...ids]).toEqual(['a', 'b'])
  })
})
