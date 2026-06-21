import { contextBridge, ipcRenderer } from 'electron'
import type { CompareApi } from '../shared/types'

const compareApi: CompareApi = {
  lists: {
    getAll: () => ipcRenderer.invoke('lists:get-all'),
    create: (draft) => ipcRenderer.invoke('lists:create', draft),
    update: (id, draft) => ipcRenderer.invoke('lists:update', id, draft),
    delete: (id) => ipcRenderer.invoke('lists:delete', id)
  },
  cards: {
    getAll: (listId) => ipcRenderer.invoke('cards:get-all', listId),
    create: (listId, draft) => ipcRenderer.invoke('cards:create', listId, draft),
    duplicate: (id) => ipcRenderer.invoke('cards:duplicate', id),
    update: (id, draft) => ipcRenderer.invoke('cards:update', id, draft),
    delete: (id) => ipcRenderer.invoke('cards:delete', id),
    reorder: (listId, cardIds) => ipcRenderer.invoke('cards:reorder', listId, cardIds)
  },
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    restore: () => ipcRenderer.invoke('backup:restore')
  }
}

contextBridge.exposeInMainWorld('compareApi', compareApi)
