import type {
  BackupSnapshot,
  CardDraft,
  ComparisonListDraft,
  ContentUnit,
  InputSource,
  MeasureKind,
  PriceCard,
  VolumeUnit,
  WeightUnit
} from '../shared/types'
import { calculatePrice, normalizePositiveDecimal, ValidationError } from '../shared/calculator'

const measureKinds = new Set<MeasureKind>(['count', 'volume', 'weight'])
const measureOrder: MeasureKind[] = ['count', 'volume', 'weight']
const sources = new Set<InputSource>(['manual', 'ocr'])

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label}不能为空`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`)
  return value.trim() || null
}

export function validateListDraft(value: ComparisonListDraft): ComparisonListDraft {
  const name = requiredText(value?.name, '清单名称')
  const normalizedMeasureKinds = normalizeMeasureKinds(value)
  return {
    name,
    measureKind: normalizedMeasureKinds[0],
    measureKinds: normalizedMeasureKinds,
    // 首版暂时固定人民币。保留字段是为了兼容旧数据和备份格式。
    currencyCode: 'CNY'
  }
}

export function validateCardDraft(value: CardDraft, selectedMeasureKinds: MeasureKind | MeasureKind[]): CardDraft {
  const selected = Array.isArray(selectedMeasureKinds) ? selectedMeasureKinds : [selectedMeasureKinds]
  const draft: CardDraft = {
    name: requiredText(value?.name, '商品名称'),
    totalPrice: normalizePositiveDecimal(String(value?.totalPrice ?? ''), '总价'),
    packageCount: Number(value?.packageCount),
    unitsPerPackage: Number(value?.unitsPerPackage),
    contentPerUnit: value?.contentPerUnit == null ? null : String(value.contentPerUnit),
    contentUnit: (value?.contentUnit ?? null) as ContentUnit | null,
    volumePerUnit: normalizeLegacyContent(value, 'volume').perUnit,
    volumeUnit: normalizeLegacyContent(value, 'volume').unit as VolumeUnit | null,
    weightPerUnit: normalizeLegacyContent(value, 'weight').perUnit,
    weightUnit: normalizeLegacyContent(value, 'weight').unit as WeightUnit | null,
    merchant: optionalText(value?.merchant, '购买商家'),
    note: optionalText(value?.note, '备注'),
    source: value?.source as InputSource
  }
  if (!sources.has(draft.source)) throw new ValidationError('录入来源不正确')
  selected.forEach((measureKind) => calculatePrice(draft, measureKind))
  if (selected.includes('volume')) {
    draft.volumePerUnit = normalizePositiveDecimal(draft.volumePerUnit ?? '', '每件容量')
  } else {
    draft.volumePerUnit = null
    draft.volumeUnit = null
  }
  if (selected.includes('weight')) {
    draft.weightPerUnit = normalizePositiveDecimal(draft.weightPerUnit ?? '', '每件重量')
  } else {
    draft.weightPerUnit = null
    draft.weightUnit = null
  }
  if (draft.volumePerUnit && draft.volumeUnit) {
    draft.contentPerUnit = draft.volumePerUnit
    draft.contentUnit = draft.volumeUnit
  } else if (draft.weightPerUnit && draft.weightUnit) {
    draft.contentPerUnit = draft.weightPerUnit
    draft.contentUnit = draft.weightUnit
  } else {
    draft.contentPerUnit = null
    draft.contentUnit = null
  }
  return draft
}

function normalizeMeasureKinds(value: ComparisonListDraft): MeasureKind[] {
  const raw = Array.isArray(value?.measureKinds)
    ? value.measureKinds
    : value?.measureKind
      ? [value.measureKind]
      : ['count', 'volume']
  const selected = new Set<MeasureKind>()
  raw.forEach((kind) => {
    if (!measureKinds.has(kind)) throw new ValidationError('计量方式不正确')
    selected.add(kind)
  })
  const normalized = measureOrder.filter((kind) => selected.has(kind))
  if (normalized.length === 0) throw new ValidationError('至少选择一种对比条件')
  return normalized
}

function normalizeLegacyContent(
  value: CardDraft,
  kind: 'volume' | 'weight'
): { perUnit: string | null, unit: VolumeUnit | WeightUnit | null } {
  if (kind === 'volume') {
    const unit = value?.volumeUnit ?? ((value?.contentUnit === 'ml' || value?.contentUnit === 'L') ? value.contentUnit : null)
    const perUnit = value?.volumePerUnit ?? ((unit && (value?.contentUnit === 'ml' || value?.contentUnit === 'L')) ? value?.contentPerUnit ?? null : null)
    return {
      perUnit: perUnit == null ? null : String(perUnit),
      unit: unit == null ? null : unit
    }
  }
  const unit = value?.weightUnit ?? ((value?.contentUnit === 'g' || value?.contentUnit === 'kg') ? value.contentUnit : null)
  const perUnit = value?.weightPerUnit ?? ((unit && (value?.contentUnit === 'g' || value?.contentUnit === 'kg')) ? value?.contentPerUnit ?? null : null)
  return {
    perUnit: perUnit == null ? null : String(perUnit),
    unit: unit == null ? null : unit
  }
}

export function validateBackupSnapshot(value: unknown): BackupSnapshot {
  if (!value || typeof value !== 'object') throw new ValidationError('备份文件格式不正确')
  const snapshot = value as Partial<BackupSnapshot>
  if (snapshot.schemaVersion !== 1) throw new ValidationError('不支持该备份文件版本')
  if (!Array.isArray(snapshot.lists) || !Array.isArray(snapshot.cards)) {
    throw new ValidationError('备份文件缺少清单或卡片数据')
  }

  const listIds = new Set<string>()
  const lists = snapshot.lists.map((list) => {
    if (!list || typeof list.id !== 'string' || !list.id) throw new ValidationError('备份中存在无效清单 ID')
    if (listIds.has(list.id)) throw new ValidationError('备份中存在重复清单 ID')
    if (typeof list.createdAt !== 'string' || typeof list.updatedAt !== 'string') {
      throw new ValidationError('备份中的清单时间无效')
    }
    listIds.add(list.id)
    return { ...list, ...validateListDraft(list) }
  })

  const cardIds = new Set<string>()
  const listById = new Map(lists.map((list) => [list.id, list]))
  const cards = snapshot.cards.map((card: PriceCard) => {
    if (!card || typeof card.id !== 'string' || !card.id) throw new ValidationError('备份中存在无效卡片 ID')
    if (cardIds.has(card.id)) throw new ValidationError('备份中存在重复卡片 ID')
    if (typeof card.listId !== 'string' || typeof card.createdAt !== 'string' || typeof card.updatedAt !== 'string') {
      throw new ValidationError('备份中的卡片归属或时间无效')
    }
    cardIds.add(card.id)
    const list = listById.get(card.listId)
    if (!list) throw new ValidationError('备份中存在未归属清单的卡片')
    if (!Number.isSafeInteger(card.sortIndex) || card.sortIndex < 0) throw new ValidationError('备份中的卡片顺序无效')
    return { ...card, ...validateCardDraft(card, list.measureKinds) }
  })

  return {
    schemaVersion: 1,
    exportedAt: typeof snapshot.exportedAt === 'string' ? snapshot.exportedAt : new Date().toISOString(),
    lists,
    cards
  }
}
