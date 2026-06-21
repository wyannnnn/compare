import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PriceRepository } from './database'

describe('PriceRepository', () => {
  let repository: PriceRepository

  beforeEach(() => { repository = new PriceRepository(':memory:') })
  afterEach(() => repository.close())

  it('保存清单、追加卡片并持久化排序', () => {
    const list = repository.createList({ name: '矿泉水', measureKind: 'volume', itemUnit: '瓶', currencyCode: 'cny' })
    expect(list.itemUnit).toBe('瓶')
    const draft = (name: string, totalPrice: string) => ({
      name, totalPrice, packageCount: 2, unitsPerPackage: 24,
      contentPerUnit: '550', contentUnit: 'ml' as const,
      merchant: null, note: null, source: 'manual' as const
    })
    const first = repository.createCard(list.id, draft('A', '48'))
    const second = repository.createCard(list.id, draft('B', '52'))
    const third = repository.createCard(list.id, draft('C', '46'))
    expect([first.sortIndex, second.sortIndex, third.sortIndex]).toEqual([0, 1, 2])

    repository.reorderCards(list.id, [third.id, first.id, second.id])
    expect(repository.getCards(list.id).map((card) => card.name)).toEqual(['C', 'A', 'B'])
  })

  it('复制卡片会追加到当前清单最右侧', () => {
    const list = repository.createList({ name: '胶囊', measureKind: 'count', itemUnit: '粒', currencyCode: 'CNY' })
    const first = repository.createCard(list.id, {
      name: '鱼油', totalPrice: '120', packageCount: 1, unitsPerPackage: 180,
      contentPerUnit: null, contentUnit: null, merchant: '京东', note: '促销', source: 'manual'
    })
    const copied = repository.duplicateCard(first.id)

    expect(copied.id).not.toBe(first.id)
    expect(copied.name).toBe('鱼油 副本')
    expect(copied.listId).toBe(list.id)
    expect(copied.sortIndex).toBe(1)
    expect(copied.merchant).toBe('京东')
    expect(repository.getCards(list.id).map((card) => card.name)).toEqual(['鱼油', '鱼油 副本'])
  })

  it('有卡片后仍可调整单一对比条件并允许改名', () => {
    const list = repository.createList({ name: '纸巾', measureKind: 'count', currencyCode: 'CNY' })
    repository.createCard(list.id, {
      name: '抽纸', totalPrice: '19.9', packageCount: 1, unitsPerPackage: 6,
      contentPerUnit: null, contentUnit: null, merchant: null, note: null, source: 'manual'
    })
    expect(repository.updateList(list.id, { name: '抽纸', measureKind: 'count', currencyCode: 'CNY' }).name).toBe('抽纸')
    const updated = repository.updateList(list.id, { name: '抽纸对比', measureKind: 'weight' })
    expect(updated.measureKind).toBe('weight')
    expect(updated.measureKinds).toEqual(['weight'])
    expect(updated.currencyCode).toBe('CNY')
  })

  it('完整导出并事务恢复备份', () => {
    const list = repository.createList({ name: '大米', measureKind: 'weight', itemUnit: '袋', currencyCode: 'CNY' })
    repository.createCard(list.id, {
      name: '东北大米', totalPrice: '59.9', packageCount: 1, unitsPerPackage: 1,
      contentPerUnit: '5', contentUnit: 'kg', merchant: '超市', note: '促销', source: 'manual'
    })
    const snapshot = repository.exportSnapshot()
    repository.deleteList(list.id)
    expect(repository.getLists()).toHaveLength(0)
    repository.replaceSnapshot(snapshot)
    expect(repository.getLists()[0].name).toBe('大米')
    expect(repository.getLists()[0].itemUnit).toBe('袋')
    expect(repository.getCards(list.id)[0].merchant).toBe('超市')
  })
})
