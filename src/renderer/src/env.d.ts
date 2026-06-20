import type { CompareApi } from '../../shared/types'

declare global {
  interface Window {
    compareApi: CompareApi
  }
}

export {}
