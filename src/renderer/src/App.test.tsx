// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { CompareApi, ComparisonList } from '../../shared/types'

describe('App', () => {
  let lists: ComparisonList[]
  let api: CompareApi

  beforeEach(() => {
    lists = []
    api = {
      lists: {
        getAll: vi.fn(async () => lists),
        create: vi.fn(async (draft) => {
          const measureKinds = draft.measureKinds ?? [draft.measureKind ?? 'volume']
          const item = {
            id: 'list-1',
            name: draft.name,
            measureKind: measureKinds[0],
            measureKinds,
            currencyCode: 'CNY',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01'
          }
          lists.push(item)
          return item
        }),
        update: vi.fn(),
        delete: vi.fn()
      },
      cards: {
        getAll: vi.fn(async () => []),
        create: vi.fn(), update: vi.fn(), delete: vi.fn(), reorder: vi.fn()
      },
      backup: { export: vi.fn(), restore: vi.fn() }
    }
    window.compareApi = api
  })

  it('从欢迎页创建一个容量清单', async () => {
    render(<App />)
    expect(await screen.findByText('创建第一个清单')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /备份与恢复/ }))
    expect(screen.getByRole('menuitem', { name: /导出备份/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /恢复备份/ })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('创建第一个清单'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /备份与恢复/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('创建第一个清单'))
    expect(screen.queryByLabelText('货币代码')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('清单名称'), { target: { value: '矿泉水' } })
    fireEvent.click(screen.getByText('保存清单'))
    await waitFor(() => expect(api.lists.create).toHaveBeenCalledWith({ name: '矿泉水', measureKind: 'volume', measureKinds: ['volume'], currencyCode: 'CNY' }))
    expect(await screen.findByRole('heading', { name: '矿泉水' })).toBeInTheDocument()
  })

  it('清单设置读取当前基准，新建清单使用默认容量', async () => {
    const list: ComparisonList = {
      id: 'count-list', name: '抽纸', measureKind: 'count', measureKinds: ['count'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)

    render(<App />)
    expect(await screen.findByRole('heading', { name: '抽纸' })).toBeInTheDocument()
    expect(screen.getAllByText('每件 / 每瓶')).toHaveLength(2)
    expect(screen.queryByText('人民币')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清单设置' }))
    expect(screen.getByLabelText('件数')).toBeChecked()
    expect(screen.getByText('每个清单只使用一种比较基准；如需按其他指标比较，可以新建清单。')).toBeInTheDocument()
    expect(screen.queryByText(/另一种算法/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByLabelText('新建清单'))
    expect(screen.getByLabelText('容量')).toBeChecked()
  })

  it('容量清单展示每升单价', async () => {
    const list: ComparisonList = {
      id: 'water-list', name: '矿泉水', measureKind: 'volume', measureKinds: ['volume'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)
    vi.mocked(api.cards.getAll).mockResolvedValue([{
      id: 'water-card', listId: list.id, name: '测试水 550ml', totalPrice: '48',
      packageCount: 2, unitsPerPackage: 24, contentPerUnit: '550', contentUnit: 'ml',
      volumePerUnit: '550', volumeUnit: 'ml', weightPerUnit: null, weightUnit: null,
      activeIngredientPercent: null, absorptionMultiplier: null,
      merchant: null, note: null, source: 'manual', sortIndex: 0,
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    render(<App />)
    expect(await screen.findByRole('heading', { name: '测试水 550ml' })).toBeInTheDocument()
    expect(screen.getAllByText('每升').length).toBeGreaterThan(0)
    expect(screen.getByText('/ L')).toBeInTheDocument()
    expect(screen.getByText(/1\.8182/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /复制单价/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^¥1\.8182 \/ L$/)))
    expect(screen.getByText('已复制单价')).toBeInTheDocument()
    const toggle = screen.getByLabelText('切换 L/ml 显示')
    expect(toggle).toHaveAttribute('title', 'L/ml 切换')
    fireEvent.click(toggle)
    expect(screen.getAllByText('每毫升').length).toBeGreaterThan(0)
    expect(screen.getByText('/ ml')).toBeInTheDocument()
    expect(screen.getByText(/0\.0018/)).toBeInTheDocument()
    expect(screen.getByText('当前最低')).toBeInTheDocument()
    expect(screen.queryByText('最低')).not.toBeInTheDocument()
    expect(screen.queryByText('有效成分')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    const board = screen.getByLabelText('矿泉水商品卡片')
    fireEvent.wheel(board, { deltaY: 120, deltaX: 0 })
    expect(board.scrollLeft).toBe(120)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const cardDeleteDialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(cardDeleteDialog).toBeInTheDocument()
    expect(within(cardDeleteDialog).getByText('测试水 550ml')).toBeInTheDocument()
    expect(within(cardDeleteDialog).getByText('删除后无法撤销。')).toBeInTheDocument()
    expect(api.cards.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.cards.delete).toHaveBeenCalledWith('water-card'))
    expect(screen.getByText('卡片已删除')).toBeInTheDocument()
  })

  it('删除清单使用应用内确认对话框', async () => {
    const list: ComparisonList = {
      id: 'delete-list', name: '待删除清单', measureKind: 'count', measureKinds: ['count'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)

    render(<App />)
    expect(await screen.findByRole('heading', { name: '待删除清单' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除清单' }))
    const listDeleteDialog = screen.getByRole('alertdialog', { name: '确认删除' })
    expect(listDeleteDialog).toBeInTheDocument()
    expect(within(listDeleteDialog).getByText('待删除清单')).toBeInTheDocument()
    expect(within(listDeleteDialog).getByText('清单中的全部卡片也会被删除，且无法撤销。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.lists.delete).toHaveBeenCalledWith('delete-list'))
    expect(screen.getByText('清单已删除')).toBeInTheDocument()
  })

  it('有效成分和倍率默认折叠，勾选后才显示输入框', async () => {
    const list: ComparisonList = {
      id: 'fish-list', name: '鱼油', measureKind: 'weight', measureKinds: ['weight'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)

    render(<App />)
    expect(await screen.findByRole('heading', { name: '鱼油' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /添加第一张价格卡/ }))
    expect(screen.getByPlaceholderText('输入商品名称')).toBeInTheDocument()
    expect(screen.getByText('本次购买的包装总数')).toBeInTheDocument()
    expect(screen.getByText('每个包装内含的商品件数')).toBeInTheDocument()
    expect(screen.getByText('规格')).toBeInTheDocument()
    expect(screen.queryByText(/农夫山泉|每箱|鱼油 DHA/)).not.toBeInTheDocument()
    expect(screen.queryByText('填写商品标注的有效成分百分比')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('启用有效成分占比'))
    expect(screen.getByText('填写商品标注的有效成分百分比')).toBeInTheDocument()
    expect(screen.queryByText('填写用于修正有效利用量的倍率，基准值为 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('启用倍率修正'))
    expect(screen.getByText('填写用于修正有效利用量的倍率，基准值为 1')).toBeInTheDocument()
  })

  it('价格卡默认紧凑，展开后显示额外详情', async () => {
    const list: ComparisonList = {
      id: 'detail-list', name: '鱼油', measureKind: 'weight', measureKinds: ['weight'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)
    vi.mocked(api.cards.getAll).mockResolvedValue([{
      id: 'detail-card', listId: list.id, name: '鱼油详情卡', totalPrice: '132',
      packageCount: 1, unitsPerPackage: 1, contentPerUnit: '70.5', contentUnit: 'g',
      volumePerUnit: null, volumeUnit: null, weightPerUnit: '70.5', weightUnit: 'g',
      activeIngredientPercent: '72', absorptionMultiplier: '1',
      merchant: '京东', note: 'rTG 版本', source: 'manual', sortIndex: 0,
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }])

    render(<App />)
    expect(await screen.findByRole('heading', { name: '鱼油详情卡' })).toBeInTheDocument()
    expect(screen.queryByText('有效成分')).not.toBeInTheDocument()
    expect(screen.queryByText('倍率')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /展开详情/ }))
    expect(screen.getByText('有效成分')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
    expect(screen.getByText('倍率')).toBeInTheDocument()
    expect(screen.getByText('1 倍')).toBeInTheDocument()
    expect(screen.getByText('京东')).toBeInTheDocument()
    expect(screen.getByText('rTG 版本')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    expect(screen.queryByText('有效成分')).not.toBeInTheDocument()
  })

  it('重量单价可以点击在 kg 和 g 之间切换展示', async () => {
    const list: ComparisonList = {
      id: 'oil-list', name: '鱼油', measureKind: 'weight', measureKinds: ['weight'],
      currencyCode: 'CNY', createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    lists.push(list)
    vi.mocked(api.cards.getAll).mockResolvedValue([{
      id: 'oil-card', listId: list.id, name: '鱼油 100g', totalPrice: '100',
      packageCount: 1, unitsPerPackage: 1, contentPerUnit: '100', contentUnit: 'g',
      volumePerUnit: null, volumeUnit: null, weightPerUnit: '100', weightUnit: 'g',
      activeIngredientPercent: null, absorptionMultiplier: null,
      merchant: null, note: null, source: 'manual', sortIndex: 0,
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }])

    render(<App />)
    expect(await screen.findByRole('heading', { name: '鱼油 100g' })).toBeInTheDocument()
    expect(screen.getAllByText('每千克').length).toBeGreaterThan(0)
    expect(screen.getByText('/ kg')).toBeInTheDocument()
    const toggle = screen.getByLabelText('切换 kg/g 显示')
    expect(toggle).toHaveAttribute('title', 'kg/g 切换')
    fireEvent.click(toggle)
    expect(screen.getAllByText('每克').length).toBeGreaterThan(0)
    expect(screen.getByText('/ g')).toBeInTheDocument()
    expect(screen.getByText('¥1.00')).toBeInTheDocument()
  })

  it('从件数清单切换到重量清单时不会用旧卡片执行重量计算', async () => {
    const countList: ComparisonList = {
      id: 'count-list', name: '抽纸', measureKind: 'count', currencyCode: 'CNY',
      measureKinds: ['count'],
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    const weightList: ComparisonList = {
      id: 'weight-list', name: '大米', measureKind: 'weight', currencyCode: 'CNY',
      measureKinds: ['weight'],
      createdAt: '2026-01-02', updatedAt: '2026-01-02'
    }
    lists.push(countList, weightList)
    vi.mocked(api.cards.getAll).mockImplementation(async (listId) => {
      if (listId === countList.id) {
        return [{
          id: 'count-card', listId: countList.id, name: '六包装抽纸', totalPrice: '19.9',
          packageCount: 1, unitsPerPackage: 6, contentPerUnit: null, contentUnit: null,
          volumePerUnit: null, volumeUnit: null, weightPerUnit: null, weightUnit: null,
          activeIngredientPercent: null, absorptionMultiplier: null,
          merchant: null, note: null, source: 'manual', sortIndex: 0,
          createdAt: '2026-01-01', updatedAt: '2026-01-01'
        }]
      }
      await new Promise((resolve) => window.setTimeout(resolve, 20))
      return []
    })

    render(<App />)
    expect(await screen.findByRole('heading', { name: '抽纸' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '六包装抽纸' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /大米/ }))
    expect(await screen.findByRole('heading', { name: '大米' })).toBeInTheDocument()
    expect(screen.queryByText('比价卡启动失败')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /添加第一张价格卡/ })).toBeInTheDocument()
  })
})
