import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'

test.setTimeout(45_000)
test.skip(
  process.env.BIJIAKA_RUN_ELECTRON_E2E !== '1',
  '真实 Electron E2E 作为诊断用例保留；默认自动 E2E 使用 tests/ui.spec.ts，避免 Windows native 崩溃弹窗。'
)

type RunningApp = {
  app: ElectronApplication
  page: Page
}

type CardInput = {
  name: string
  totalPrice: string
  packageCount?: string
  unitsPerPackage?: string
  volumePerUnit?: string
}

async function launchApp(userData: string, env: Record<string, string> = {}): Promise<RunningApp> {
  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--user-data-dir=${userData}`,
      join(process.cwd(), 'out/main/index.js')
    ],
    env: { ...process.env, BIJIAKA_USER_DATA: userData, BIJIAKA_E2E: '1', ...env }
  })
  const page = await app.firstWindow()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByText('比价卡').first()).toBeVisible()
  return { app, page }
}

async function withTempApp<T>(
  callback: (running: RunningApp, userData: string) => Promise<T>,
  env: Record<string, string> = {}
): Promise<T> {
  const userData = await mkdtemp(join(tmpdir(), 'bijiaka-e2e-'))
  const running = await launchApp(userData, env)
  try {
    return await callback(running, userData)
  } finally {
    await running.app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
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
  if (card.volumePerUnit) {
    await drawer.getByPlaceholder('550').fill(card.volumePerUnit)
  }
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
  const order = await cardOrder(page)
  const sourceIndex = order.indexOf(sourceName)
  const targetIndex = order.indexOf(targetName)
  if (sourceIndex < 0 || targetIndex < 0) throw new Error('无法定位拖拽卡片')

  const source = sortableDragHandle(page, sourceName)
  const key = sourceIndex > targetIndex ? 'ArrowLeft' : 'ArrowRight'
  await source.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(120)
  await page.keyboard.press(key)
  await page.waitForTimeout(120)
  await page.keyboard.press('Space')
}

async function clickBackupMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /备份与恢复/ }).click()
  await page.getByRole('menuitem', { name }).click()
}

test('启动空数据时不白屏', async () => {
  await withTempApp(async ({ page }) => {
    await expect(page.getByRole('button', { name: '创建第一个清单' })).toBeVisible()
    await expect(page.getByText('比价卡启动失败')).not.toBeVisible()
  })
})

test('创建矿泉水清单并计算 2 包 × 24 瓶 × 550ml', async () => {
  await withTempApp(async ({ page }) => {
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
})

test('新卡追加到最右侧，拖拽排序后重启仍保留顺序', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'bijiaka-e2e-'))
  let running = await launchApp(userData)

  try {
    await createList(running.page, { name: '抽纸', measure: '件数', unit: '包' })
    await addCard(running.page, { name: 'A 抽纸', totalPrice: '10' })
    await addCard(running.page, { name: 'B 抽纸', totalPrice: '9' })
    await addCard(running.page, { name: 'C 抽纸', totalPrice: '8' })
    await expectCardOrder(running.page, ['A 抽纸', 'B 抽纸', 'C 抽纸'])

    await dragCard(running.page, 'C 抽纸', 'B 抽纸')
    await expectCardOrder(running.page, ['A 抽纸', 'C 抽纸', 'B 抽纸'])

    await running.app.close()
    running = await launchApp(userData)
    await expect(running.page.getByRole('heading', { name: '抽纸', exact: true })).toBeVisible()
    await expectCardOrder(running.page, ['A 抽纸', 'C 抽纸', 'B 抽纸'])
  } finally {
    await running.app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('导出后删除数据，再导入可完整恢复', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'bijiaka-e2e-'))
  const backupPath = join(userData, 'backup.json')
  const running = await launchApp(userData, { BIJIAKA_E2E_BACKUP_PATH: backupPath })

  try {
    await createList(running.page, { name: '咖啡', measure: '件数', unit: '盒' })
    await addCard(running.page, { name: '挂耳咖啡', totalPrice: '39.9', packageCount: '1', unitsPerPackage: '10' })
    await clickBackupMenuItem(running.page, '导出备份')
    await expect(running.page.getByText(/已导出 1 个清单、1 张卡片/)).toBeVisible()
    await access(backupPath)
    const snapshot = JSON.parse(await readFile(backupPath, 'utf8')) as { lists: unknown[], cards: unknown[] }
    expect(snapshot.lists).toHaveLength(1)
    expect(snapshot.cards).toHaveLength(1)

    await running.page.getByRole('button', { name: '删除清单' }).click()
    await expect(running.page.getByRole('alertdialog', { name: '确认删除' })).toBeVisible()
    await running.page.getByRole('button', { name: '确认删除' }).click()
    await expect(running.page.getByRole('button', { name: '创建第一个清单' })).toBeVisible()

    await clickBackupMenuItem(running.page, '恢复备份')
    await expect(running.page.getByText(/已恢复 1 个清单、1 张卡片/)).toBeVisible()
    await expect(running.page.getByRole('heading', { name: '咖啡', exact: true })).toBeVisible()
    await expect(running.page.getByRole('heading', { name: '挂耳咖啡' })).toBeVisible()
    await expect(running.page.getByText('1 包 × 10 盒')).toBeVisible()
  } finally {
    await running.app.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})
