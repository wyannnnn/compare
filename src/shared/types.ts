export type MeasureKind = 'count' | 'volume' | 'weight'
export type VolumeUnit = 'ml' | 'L'
export type WeightUnit = 'g' | 'kg'
export type ContentUnit = VolumeUnit | WeightUnit
export type InputSource = 'manual' | 'ocr'

export interface ComparisonList {
  id: string
  /**
   * 旧版只支持一个比较基准，保留该字段用于迁移和备份兼容。
   * 新界面和计算逻辑使用 measureKinds。
   */
  name: string
  measureKind: MeasureKind
  measureKinds: MeasureKind[]
  currencyCode: string
  createdAt: string
  updatedAt: string
}

export interface ComparisonListDraft {
  name: string
  measureKind?: MeasureKind
  measureKinds?: MeasureKind[]
  currencyCode?: string
}

export interface PriceCard {
  id: string
  listId: string
  name: string
  totalPrice: string
  packageCount: number
  unitsPerPackage: number
  /**
   * 旧版单规格字段，保留用于备份和数据库兼容。新版按容量/重量分开保存。
   */
  contentPerUnit: string | null
  contentUnit: ContentUnit | null
  volumePerUnit: string | null
  volumeUnit: VolumeUnit | null
  weightPerUnit: string | null
  weightUnit: WeightUnit | null
  merchant: string | null
  note: string | null
  source: InputSource
  sortIndex: number
  createdAt: string
  updatedAt: string
}

export interface CardDraft {
  name: string
  totalPrice: string
  packageCount: number
  unitsPerPackage: number
  contentPerUnit?: string | null
  contentUnit?: ContentUnit | null
  volumePerUnit?: string | null
  volumeUnit?: VolumeUnit | null
  weightPerUnit?: string | null
  weightUnit?: WeightUnit | null
  merchant: string | null
  note: string | null
  source: InputSource
}

export interface PriceCalculation {
  totalUnits: string
  normalizedQuantity: string
  pricePerUnit: string
  normalizedPrice: string
  normalizedUnitLabel: '件' | 'L' | 'kg'
}

export interface BackupSnapshot {
  schemaVersion: 1
  exportedAt: string
  lists: ComparisonList[]
  cards: PriceCard[]
}

export interface BackupResult {
  status: 'completed' | 'cancelled'
  path?: string
  listCount?: number
  cardCount?: number
}

export interface CompareApi {
  lists: {
    getAll(): Promise<ComparisonList[]>
    create(draft: ComparisonListDraft): Promise<ComparisonList>
    update(id: string, draft: ComparisonListDraft): Promise<ComparisonList>
    delete(id: string): Promise<void>
  }
  cards: {
    getAll(listId: string): Promise<PriceCard[]>
    create(listId: string, draft: CardDraft): Promise<PriceCard>
    update(id: string, draft: CardDraft): Promise<PriceCard>
    delete(id: string): Promise<void>
    reorder(listId: string, cardIds: string[]): Promise<PriceCard[]>
  }
  backup: {
    export(): Promise<BackupResult>
    restore(): Promise<BackupResult>
  }
}

export const MEASURE_LABELS: Record<MeasureKind, string> = {
  count: '按件数',
  volume: '按容量',
  weight: '按重量'
}

export const SHORT_MEASURE_LABELS: Record<MeasureKind, string> = {
  count: '件数',
  volume: '容量',
  weight: '重量'
}

export const NORMALIZED_UNIT_LABELS: Record<MeasureKind, '件' | 'L' | 'kg'> = {
  count: '件',
  volume: 'L',
  weight: 'kg'
}
