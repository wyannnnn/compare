import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('创建矿泉水清单并计算 2 箱 × 24 瓶 × 550ml', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'bijiaka-e2e-'))
  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env: { ...process.env, BIJIAKA_USER_DATA: userData, BIJIAKA_E2E: '1' }
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '创建第一个清单' }).click()
    await page.getByLabel('清单名称').fill('矿泉水')
    await page.getByRole('button', { name: '保存清单' }).click()
    await expect(page.getByRole('heading', { name: '矿泉水' })).toBeVisible()

    await page.getByRole('button', { name: '添加第一张价格卡' }).click()
    await page.getByLabel('商品名称').fill('测试水 550ml')
    await page.getByLabel('总价').fill('48')
    await page.getByLabel('包装数量').fill('2')
    await page.getByLabel('规格').fill('24')
    await page.getByLabel('每件容量').fill('550')
    await expect(page.getByText(/1\.8182 \/ L/)).toBeVisible()
    await page.getByRole('button', { name: '添加到最右侧' }).click()
    await expect(page.getByRole('heading', { name: '测试水 550ml' })).toBeVisible()
    await expect(page.getByText('当前最低')).toBeVisible()
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
