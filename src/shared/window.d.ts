import type { WorkbenchAPI } from './contracts'

declare global {
  interface Window {
    workbench: WorkbenchAPI
  }
}

export {}
