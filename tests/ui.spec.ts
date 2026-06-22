import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

let server: Server | null = null
let baseUrl = ''

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

type CardInput = {
  name: string
  totalPrice: string
  packageCount?: string
  unitsPerPackage?: string
  volumePerUnit?: string
}

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type MeasureKind = 'count' | 'volume' | 'weight'
    type ContentUnit = 'ml' | 'L' | 'g' | 'kg'

    type ComparisonList = {
      id: string
      name: string
      measureKind: MeasureKind
      measureKinds: MeasureKind[]
      itemUnit: string
      currencyCode: string
      createdAt: string
      updatedAt: string
    }

    type CardDraft = {
      name: string
      totalPrice: string
      packageCount: number
      unitsPerPackage: number
      contentPerUnit?: string | null
      contentUnit?: ContentUnit | null
      volumePerUnit?: string | null
      volumeUnit?: 'ml' | 'L' | null
      weightPerUnit?: string | null
      weightUnit?: 'g' | 'kg' | null
      activeIngredientPercent?: string | null
      absorptionMultiplier?: string | null
      merchant: string | null
      note: string | null
      source: 'manual' | 'ocr'
    }

    type PriceCard = CardDraft & {
      id: string
      listId: string
      contentPerUnit: string | null
      contentUnit: ContentUnit | null
      volumePerUnit: string | null
      volumeUnit: 'ml' | 'L' | null
      weightPerUnit: string | null
      weightUnit: 'g' | 'kg' | null
      sortIndex: number
      createdAt: string
      updatedAt: string
    }

    type State = { lists: ComparisonList[], cards: Record<string, PriceCard[]> }

    const storageKey = 'bijiaka-playwright-ui-state'
    const backupKey = 'bijiaka-playwright-ui-backup'

    const loadState = (): State => {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { lists: [], cards: {} }
      return JSON.parse(raw) as State
    }

    const saveState = (state: State): void => {
      localStorage.setItem(storageKey, JSON.stringify(state))
    }

    const now = (): string => new Date().toISOString()
    const nextId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`

    const allCards = (state: State): PriceCard[] => Object.values(state.cards).flat()

    const cardFromDraft = (listId: string, draft: CardDraft, sortIndex: number): PriceCard => ({
      id: nextId('card'),
      listId,
      name: draft.name.trim(),
      totalPrice: String(draft.totalPrice),
      packageCount: Number(draft.packageCount),
      unitsPerPackage: Number(draft.unitsPerPackage),
      contentPerUnit: draft.contentPerUnit ?? null,
      contentUnit: draft.contentUnit ?? null,
      volumePerUnit: draft.volumePerUnit ?? null,
      volumeUnit: draft.volumeUnit ?? null,
      weightPerUnit: draft.weightPerUnit ?? null,
      weightUnit: draft.weightUnit ?? null,
      activeIngredientPercent: draft.activeIngredientPercent ?? null,
      absorptionMultiplier: draft.absorptionMultiplier ?? null,
      merchant: draft.merchant ?? null,
      note: draft.note ?? null,
      source: draft.source ?? 'manual',
      sortIndex,
      createdAt: now(),
      updatedAt: now()
    })

    window.compareApi = {
      lists: {
        async getAll() {
          return loadState().lists
        },
        async create(draft) {
          const state = loadState()
          const measureKind = draft.measureKind ?? draft.measureKinds?.[0] ?? 'volume'
          const list: ComparisonList = {
            id: nextId('list'),
            name: draft.name.trim(),
            measureKind,
            measureKinds: [measureKind],
            itemUnit: draft.itemUnit?.trim() || '件',
            currencyCode: 'CNY',
            createdAt: now(),
            updatedAt: now()
          }
          state.lists.push(list)
          state.cards[list.id] = []
          saveState(state)
          return list
        },
        async update(id, draft) {
          const state = loadState()
          const index = state.lists.findIndex((list) => list.id === id)
          if (index < 0) throw new Error('清单不存在')
          const measureKind = draft.measureKind ?? draft.measureKinds?.[0] ?? state.lists[index].measureKind
          state.lists[index] = {
            ...state.lists[index],
            name: draft.name.trim(),
            measureKind,
            measureKinds: [measureKind],
            itemUnit: draft.itemUnit?.trim() || '件',
            updatedAt: now()
          }
          saveState(state)
          return state.lists[index]
        },
        async delete(id) {
          const state = loadState()
          state.lists = state.lists.filter((list) => list.id !== id)
          delete state.cards[id]
          saveState(state)
        }
      },
      cards: {
        async getAll(listId) {
          return [...(loadState().cards[listId] ?? [])].sort((a, b) => a.sortIndex - b.sortIndex)
        },
        async create(listId, draft) {
          const state = loadState()
          const cards = state.cards[listId] ?? []
          const card = cardFromDraft(listId, draft, cards.length)
          state.cards[listId] = [...cards, card]
          saveState(state)
          return card
        },
        async duplicate(id) {
          const state = loadState()
          const cards = allCards(state)
          const source = cards.find((card) => card.id === id)
          if (!source) throw new Error('卡片不存在')
          const copied: PriceCard = {
            ...source,
            id: nextId('card'),
            name: `${source.name} 副本`,
            sortIndex: (state.cards[source.listId] ?? []).length,
            createdAt: now(),
            updatedAt: now()
          }
          state.cards[source.listId] = [...(state.cards[source.listId] ?? []), copied]
          saveState(state)
          return copied
        },
        async update(id, draft) {
          const state = loadState()
          for (const [listId, cards] of Object.entries(state.cards)) {
            const index = cards.findIndex((card) => card.id === id)
            if (index >= 0) {
              cards[index] = { ...cardFromDraft(listId, draft, cards[index].sortIndex), id, createdAt: cards[index].createdAt, updatedAt: now() }
              state.cards[listId] = cards
              saveState(state)
              return cards[index]
            }
          }
          throw new Error('卡片不存在')
        },
        async delete(id) {
          const state = loadState()
          for (const [listId, cards] of Object.entries(state.cards)) {
            const next = cards.filter((card) => card.id !== id).map((card, index) => ({ ...card, sortIndex: index }))
            if (next.length !== cards.length) state.cards[listId] = next
          }
          saveState(state)
        },
        async reorder(listId, cardIds) {
          const state = loadState()
          const cards = state.cards[listId] ?? []
          const byId = new Map(cards.map((card) => [card.id, card]))
          state.cards[listId] = cardIds.map((id, index) => ({ ...byId.get(id)!, sortIndex: index }))
          saveState(state)
          return state.cards[listId]
        }
      },
      backup: {
        async export() {
          const state = loadState()
          const snapshot = {
            schemaVersion: 1,
            exportedAt: now(),
            lists: state.lists,
            cards: allCards(state)
          }
          localStorage.setItem(backupKey, JSON.stringify(snapshot))
          return { status: 'completed', path: 'memory://backup.json', listCount: snapshot.lists.length, cardCount: snapshot.cards.length }
        },
        async restore() {
          const raw = localStorage.getItem(backupKey)
          if (!raw) throw new Error('没有可恢复的测试备份')
          const snapshot = JSON.parse(raw) as { lists: ComparisonList[], cards: PriceCard[] }
          const state: State = { lists: snapshot.lists, cards: {} }
          for (const list of snapshot.lists) state.cards[list.id] = []
          for (const card of snapshot.cards) {
            state.cards[card.listId] = [...(state.cards[card.listId] ?? []), card]
          }
          saveState(state)
          return { status: 'completed', path: 'memory://backup.json', listCount: snapshot.lists.length, cardCount: snapshot.cards.length }
        }
      }
    }
  })

  await page.setViewportSize({ width: 1280, height: 780 })
  await page.goto(baseUrl)
  await expect(page.locator('.app-shell')).toBeVisible()
}

async function createList(page: Page, options: { name: string, measure: '件数' | '容量' | '重量', unit?: string }): Promise<void> {
  const firstListButton = page.getByRole('button', { name: '创建第一个清单' })
  if (await firstListButton.isVisible().catch(() => false)) {
    await firstListButton.click()
  } else {
    await page.getByLabel('新建清单').click()
  }

  const dialog = page.getByRole('dialog', { name: /创建对比清单/ })
  await dialog.getByLabel('清单名称').fill(options.name)
  await dialog.locator('.segmented label', { hasText: options.measure }).click()
  if (options.unit) {
    await dialog.getByText('显示选项').click()
    await dialog.getByLabel('数量单位（可选）').fill(options.unit)
  }
  await dialog.getByRole('button', { name: '保存清单' }).click()
  await expect(page.getByRole('heading', { name: options.name })).toBeVisible()
}

async function openNewCardDrawer(page: Page): Promise<Locator> {
  const emptyBoardButton = page.getByRole('button', { name: /添加第一张价格卡/ })
  if (await emptyBoardButton.isVisible().catch(() => false)) {
    await emptyBoardButton.click()
  } else {
    await page.locator('.header-actions').getByRole('button', { name: /新建卡片/ }).click()
  }
  const drawer = page.getByRole('dialog', { name: '新建价格卡' })
  await expect(drawer).toBeVisible()
  return drawer
}

async function addCard(page: Page, card: CardInput): Promise<void> {
  const drawer = await openNewCardDrawer(page)
  await drawer.getByLabel('商品名称').fill(card.name)
  await drawer.getByPlaceholder('0.00').fill(card.totalPrice)
  await drawer.getByLabel('包装数量').fill(card.packageCount ?? '1')
  await drawer.getByLabel('规格').fill(card.unitsPerPackage ?? '1')
  if (card.volumePerUnit) await drawer.getByPlaceholder('550').fill(card.volumePerUnit)
  await drawer.getByRole('button', { name: '添加到最右侧' }).click()
  await expect(page.getByRole('heading', { name: card.name })).toBeVisible()
}

async function cardOrder(page: Page): Promise<string[]> {
  return page.locator('.price-card:not(.overlay-card) .card-title h2').evaluateAll((nodes) => (
    nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean)
  ))
}

async function expectCardOrder(page: Page, expected: string[]): Promise<void> {
  await expect.poll(() => cardOrder(page)).toEqual(expected)
}

function sortableDragHandle(page: Page, cardName: string): Locator {
  return page
    .locator('.sortable', { has: page.getByRole('heading', { name: cardName, exact: true }) })
    .locator('.drag-handle')
}

async function dragCard(page: Page, sourceName: string, targetName: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const order = await cardOrder(page)
    const sourceIndex = order.indexOf(sourceName)
    const targetIndex = order.indexOf(targetName)
    if (sourceIndex < 0 || targetIndex < 0) throw new Error('无法定位拖拽卡片')
    if (sourceIndex + 1 === targetIndex) return

    const source = sortableDragHandle(page, sourceName)
    const key = sourceIndex > targetIndex ? 'ArrowLeft' : 'ArrowRight'
    const steps = sourceIndex > targetIndex
      ? sourceIndex - targetIndex
      : Math.max(targetIndex - sourceIndex - 1, 1)

    await source.focus()
    await page.keyboard.press('Space')
    for (let step = 0; step < steps; step += 1) {
      await page.keyboard.press(key)
      await page.waitForTimeout(120)
    }
    await page.keyboard.press('Space')
    await page.waitForTimeout(180)
  }

  throw new Error(`拖拽排序未到位：${(await cardOrder(page)).join(' > ')}`)
}

async function clickBackupMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /备份与恢复/ }).click()
  await page.getByRole('menuitem', { name }).click()
}

test.beforeAll(async () => {
  const root = join(process.cwd(), 'out/renderer')
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname
      const normalizedPath = normalize(decodeURIComponent(requestedPath))
        .replace(/^(\.\.[/\\])+/, '')
        .replace(/^[\\/]+/, '')
      const filePath = join(root, normalizedPath)
      const content = await readFile(filePath)
      response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' })
      response.end(content)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    }
  })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法启动 E2E 静态服务器')
  baseUrl = `http://127.0.0.1:${address.port}/`
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve()
      return
    }
    server.close((error) => error ? reject(error) : resolve())
  })
})

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('启动空数据时不白屏', async ({ page }) => {
  await expect(page.getByRole('button', { name: '创建第一个清单' })).toBeVisible()
  await expect(page.getByText('比价卡启动失败')).not.toBeVisible()
})

test('创建矿泉水清单并计算 2 包 × 24 瓶 × 550ml', async ({ page }) => {
  await createList(page, { name: '矿泉水', measure: '容量', unit: '瓶' })
  await addCard(page, {
    name: '测试水 550ml',
    totalPrice: '48',
    packageCount: '2',
    unitsPerPackage: '24',
    volumePerUnit: '550'
  })

  await expect(page.getByText('2 包 × 24 瓶')).toBeVisible()
  await expect(page.getByText('550 ml/瓶')).toBeVisible()
  await expect(page.getByText(/¥1\.8182/)).toBeVisible()
  await expect(page.getByText('/ L')).toBeVisible()
  await expect(page.getByText('当前最低')).toBeVisible()
})

test('新卡追加到最右侧，拖拽排序后刷新仍保留顺序', async ({ page }) => {
  await createList(page, { name: '抽纸', measure: '件数', unit: '包' })
  await addCard(page, { name: 'A 抽纸', totalPrice: '10' })
  await addCard(page, { name: 'B 抽纸', totalPrice: '9' })
  await addCard(page, { name: 'C 抽纸', totalPrice: '8' })
  await expectCardOrder(page, ['A 抽纸', 'B 抽纸', 'C 抽纸'])

  await dragCard(page, 'C 抽纸', 'A 抽纸')
  await expectCardOrder(page, ['C 抽纸', 'A 抽纸', 'B 抽纸'])

  await page.reload()
  await expect(page.getByRole('heading', { name: '抽纸', exact: true })).toBeVisible()
  await expectCardOrder(page, ['C 抽纸', 'A 抽纸', 'B 抽纸'])
})

test('导出后删除数据，再导入可完整恢复', async ({ page }) => {
  await createList(page, { name: '咖啡', measure: '件数', unit: '盒' })
  await addCard(page, { name: '挂耳咖啡', totalPrice: '39.9', packageCount: '1', unitsPerPackage: '10' })

  await clickBackupMenuItem(page, '导出备份')
  await expect(page.getByText(/已导出 1 个清单、1 张卡片/)).toBeVisible()

  await page.getByRole('button', { name: '删除清单' }).click()
  await expect(page.getByRole('alertdialog', { name: '确认删除' })).toBeVisible()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByRole('button', { name: '创建第一个清单' })).toBeVisible()

  await clickBackupMenuItem(page, '恢复备份')
  await expect(page.getByText(/已恢复 1 个清单、1 张卡片/)).toBeVisible()
  await expect(page.getByRole('heading', { name: '咖啡', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '挂耳咖啡' })).toBeVisible()
  await expect(page.getByText('1 包 × 10 盒')).toBeVisible()
})
