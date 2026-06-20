import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { PriceRepository } from './database'
import { registerIpcHandlers } from './ipc'

let repository: PriceRepository | null = null
const diagnosticMode = process.env.BIJIAKA_DIAGNOSTIC === '1'

if (process.env.BIJIAKA_E2E === '1' || diagnosticMode) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '比价卡',
    autoHideMenuBar: true,
    backgroundColor: '#f5f4ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setMenuBarVisibility(false)

  window.once('ready-to-show', () => {
    if (!diagnosticMode) window.show()
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error.stack ?? error.message}`)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.error(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[did-fail-load] ${code} ${description} ${url}`)
  })
  window.webContents.on('did-finish-load', () => {
    if (!diagnosticMode) return
    globalThis.setTimeout(async () => {
      try {
        const snapshot = await window.webContents.executeJavaScript(`({
          url: location.href,
          compareApi: typeof window.compareApi,
          rootHtml: document.querySelector('#root')?.innerHTML ?? '',
          bodyText: document.body?.innerText ?? ''
        })`)
        console.log(`[diagnostic] ${JSON.stringify(snapshot)}`)
      } catch (error) {
        console.error('[diagnostic-error]', error)
      } finally {
        app.quit()
      }
    }, 800)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (current && current !== 'about:blank' && url !== current) event.preventDefault()
  })

  if (!repository) {
    repository = new PriceRepository(join(app.getPath('userData'), 'compare.sqlite'))
  }
  registerIpcHandlers(repository, window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  if (diagnosticMode) {
    globalThis.setTimeout(() => {
      if (!window.isDestroyed()) console.error('[diagnostic-timeout] 页面在 8 秒内未完成加载')
      app.quit()
    }, 8000)
  }
}

if (process.env.BIJIAKA_USER_DATA) {
  app.setPath('userData', process.env.BIJIAKA_USER_DATA)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  repository?.close()
  repository = null
})
