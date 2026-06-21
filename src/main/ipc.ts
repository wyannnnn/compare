import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { CardDraft, ComparisonListDraft } from '../shared/types'
import { PriceRepository } from './database'
import { validateBackupSnapshot } from './validation'

function dateStamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function ownerWindow(window: BrowserWindow): BrowserWindow | undefined {
  return window.isDestroyed() ? undefined : window
}

export function registerIpcHandlers(repository: PriceRepository, window: BrowserWindow): void {
  const channels = [
    'lists:get-all', 'lists:create', 'lists:update', 'lists:delete',
    'cards:get-all', 'cards:create', 'cards:duplicate', 'cards:update', 'cards:delete', 'cards:reorder',
    'backup:export', 'backup:restore'
  ]
  channels.forEach((channel) => ipcMain.removeHandler(channel))

  ipcMain.handle('lists:get-all', () => repository.getLists())
  ipcMain.handle('lists:create', (_event, draft: ComparisonListDraft) => repository.createList(draft))
  ipcMain.handle('lists:update', (_event, id: string, draft: ComparisonListDraft) => repository.updateList(id, draft))
  ipcMain.handle('lists:delete', (_event, id: string) => repository.deleteList(id))

  ipcMain.handle('cards:get-all', (_event, listId: string) => repository.getCards(listId))
  ipcMain.handle('cards:create', (_event, listId: string, draft: CardDraft) => repository.createCard(listId, draft))
  ipcMain.handle('cards:duplicate', (_event, id: string) => repository.duplicateCard(id))
  ipcMain.handle('cards:update', (_event, id: string, draft: CardDraft) => repository.updateCard(id, draft))
  ipcMain.handle('cards:delete', (_event, id: string) => repository.deleteCard(id))
  ipcMain.handle('cards:reorder', (_event, listId: string, cardIds: string[]) => repository.reorderCards(listId, cardIds))

  ipcMain.handle('backup:export', async () => {
    const defaultPath = join(app.getPath('documents'), `比价卡备份-${dateStamp().slice(0, 10)}.json`)
    const result = await dialog.showSaveDialog(ownerWindow(window), {
      title: '导出比价卡备份',
      defaultPath,
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { status: 'cancelled' as const }
    const snapshot = repository.exportSnapshot()
    await writeFile(result.filePath, JSON.stringify(snapshot, null, 2), 'utf8')
    return {
      status: 'completed' as const,
      path: result.filePath,
      listCount: snapshot.lists.length,
      cardCount: snapshot.cards.length
    }
  })

  ipcMain.handle('backup:restore', async () => {
    const openResult = await dialog.showOpenDialog(ownerWindow(window), {
      title: '选择比价卡备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    })
    if (openResult.canceled || openResult.filePaths.length === 0) return { status: 'cancelled' as const }

    const content = await readFile(openResult.filePaths[0], 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch {
      throw new Error('备份文件不是有效的 JSON')
    }
    const snapshot = validateBackupSnapshot(raw)
    const confirmation = await dialog.showMessageBox(ownerWindow(window), {
      type: 'warning',
      title: '恢复备份',
      message: `将恢复 ${snapshot.lists.length} 个清单和 ${snapshot.cards.length} 张卡片`,
      detail: '当前数据将被替换。应用会先在本机自动保存一份恢复前备份。',
      buttons: ['取消', '恢复'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (confirmation.response !== 1) return { status: 'cancelled' as const }

    const backupDirectory = join(app.getPath('userData'), 'backups')
    await mkdir(backupDirectory, { recursive: true })
    const safetyPath = join(backupDirectory, `恢复前备份-${dateStamp()}.json`)
    await writeFile(safetyPath, JSON.stringify(repository.exportSnapshot(), null, 2), 'utf8')
    repository.replaceSnapshot(snapshot)
    return {
      status: 'completed' as const,
      path: safetyPath,
      listCount: snapshot.lists.length,
      cardCount: snapshot.cards.length
    }
  })
}
