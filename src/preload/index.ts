import { contextBridge, ipcRenderer } from 'electron'
import type { WorkbenchAPI, WorkbenchRequest } from '../shared/contracts'

const api: WorkbenchAPI = {
  platform: process.platform,
  invoke<T>(request: WorkbenchRequest): Promise<T> {
    return ipcRenderer.invoke('workbench:invoke', request) as Promise<T>
  }
}

contextBridge.exposeInMainWorld('workbench', api)
