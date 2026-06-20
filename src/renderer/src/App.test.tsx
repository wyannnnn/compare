// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
          const item = { id: 'list-1', ...draft, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
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
    fireEvent.click(screen.getByText('创建第一个清单'))
    fireEvent.change(screen.getByLabelText('清单名称'), { target: { value: '矿泉水' } })
    fireEvent.click(screen.getByText('保存清单'))
    await waitFor(() => expect(api.lists.create).toHaveBeenCalledWith({ name: '矿泉水', measureKind: 'volume', currencyCode: 'CNY' }))
    expect(await screen.findByRole('heading', { name: '矿泉水' })).toBeInTheDocument()
  })

  it('从件数清单切换到重量清单时不会用旧卡片执行重量计算', async () => {
    const countList: ComparisonList = {
      id: 'count-list', name: '抽纸', measureKind: 'count', currencyCode: 'CNY',
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }
    const weightList: ComparisonList = {
      id: 'weight-list', name: '大米', measureKind: 'weight', currencyCode: 'CNY',
      createdAt: '2026-01-02', updatedAt: '2026-01-02'
    }
    lists.push(countList, weightList)
    vi.mocked(api.cards.getAll).mockImplementation(async (listId) => {
      if (listId === countList.id) {
        return [{
          id: 'count-card', listId: countList.id, name: '六包装抽纸', totalPrice: '19.9',
          packageCount: 1, unitsPerPackage: 6, contentPerUnit: null, contentUnit: null,
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
