import { randomUUID } from 'node:crypto'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  BackupSnapshot,
  CardDraft,
  ComparisonList,
  ComparisonListDraft,
  PriceCard
} from '../shared/types'
import { ValidationError } from '../shared/calculator'
import { validateCardDraft, validateListDraft } from './validation'

type DbRow = Record<string, SQLInputValue>

function listFromRow(row: DbRow): ComparisonList {
  return {
    id: String(row.id),
    name: String(row.name),
    measureKind: String(row.measure_kind) as ComparisonList['measureKind'],
    currencyCode: String(row.currency_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function cardFromRow(row: DbRow): PriceCard {
  return {
    id: String(row.id),
    listId: String(row.list_id),
    name: String(row.name),
    totalPrice: String(row.total_price),
    packageCount: Number(row.package_count),
    unitsPerPackage: Number(row.units_per_package),
    contentPerUnit: row.content_per_unit == null ? null : String(row.content_per_unit),
    contentUnit: row.content_unit == null ? null : (String(row.content_unit) as PriceCard['contentUnit']),
    merchant: row.merchant == null ? null : String(row.merchant),
    note: row.note == null ? null : String(row.note),
    source: String(row.source) as PriceCard['source'],
    sortIndex: Number(row.sort_index),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export class PriceRepository {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comparison_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        measure_kind TEXT NOT NULL CHECK (measure_kind IN ('count', 'volume', 'weight')),
        currency_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS price_cards (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES comparison_lists(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        total_price TEXT NOT NULL,
        package_count INTEGER NOT NULL CHECK (package_count > 0),
        units_per_package INTEGER NOT NULL CHECK (units_per_package > 0),
        content_per_unit TEXT,
        content_unit TEXT CHECK (content_unit IS NULL OR content_unit IN ('ml', 'L', 'g', 'kg')),
        merchant TEXT,
        note TEXT,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr')),
        sort_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_price_cards_list_sort
        ON price_cards(list_id, sort_index);
      INSERT OR IGNORE INTO app_meta(key, value) VALUES ('schema_version', '1');
    `)
  }

  close(): void {
    this.db.close()
  }

  getLists(): ComparisonList[] {
    return (this.db.prepare('SELECT * FROM comparison_lists ORDER BY created_at, id').all() as DbRow[]).map(listFromRow)
  }

  getList(id: string): ComparisonList | null {
    const row = this.db.prepare('SELECT * FROM comparison_lists WHERE id = ?').get(id) as DbRow | undefined
    return row ? listFromRow(row) : null
  }

  createList(input: ComparisonListDraft): ComparisonList {
    const draft = validateListDraft(input)
    const now = new Date().toISOString()
    const list: ComparisonList = { id: randomUUID(), ...draft, createdAt: now, updatedAt: now }
    this.db.prepare(`
      INSERT INTO comparison_lists(id, name, measure_kind, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(list.id, list.name, list.measureKind, list.currencyCode, list.createdAt, list.updatedAt)
    return list
  }

  updateList(id: string, input: ComparisonListDraft): ComparisonList {
    const current = this.requireList(id)
    const draft = validateListDraft(input)
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM price_cards WHERE list_id = ?').get(id) as DbRow).count)
    if (count > 0 && (draft.measureKind !== current.measureKind || draft.currencyCode !== current.currencyCode)) {
      throw new ValidationError('清单已有卡片，只能修改名称')
    }
    const updatedAt = new Date().toISOString()
    this.db.prepare(`
      UPDATE comparison_lists SET name = ?, measure_kind = ?, currency_code = ?, updated_at = ? WHERE id = ?
    `).run(draft.name, draft.measureKind, draft.currencyCode, updatedAt, id)
    return { ...current, ...draft, updatedAt }
  }

  deleteList(id: string): void {
    const result = this.db.prepare('DELETE FROM comparison_lists WHERE id = ?').run(id)
    if (result.changes === 0) throw new ValidationError('清单不存在')
  }

  getCards(listId: string): PriceCard[] {
    this.requireList(listId)
    return (this.db.prepare('SELECT * FROM price_cards WHERE list_id = ? ORDER BY sort_index, created_at, id').all(listId) as DbRow[]).map(cardFromRow)
  }

  getCard(id: string): PriceCard | null {
    const row = this.db.prepare('SELECT * FROM price_cards WHERE id = ?').get(id) as DbRow | undefined
    return row ? cardFromRow(row) : null
  }

  createCard(listId: string, input: CardDraft): PriceCard {
    const list = this.requireList(listId)
    const draft = validateCardDraft(input, list.measureKind)
    const maxRow = this.db.prepare('SELECT COALESCE(MAX(sort_index), -1) AS max_sort FROM price_cards WHERE list_id = ?').get(listId) as DbRow
    const now = new Date().toISOString()
    const card: PriceCard = {
      id: randomUUID(), listId, ...draft, sortIndex: Number(maxRow.max_sort) + 1, createdAt: now, updatedAt: now
    }
    this.insertCard(card)
    return card
  }

  updateCard(id: string, input: CardDraft): PriceCard {
    const current = this.requireCard(id)
    const list = this.requireList(current.listId)
    const draft = validateCardDraft(input, list.measureKind)
    const updatedAt = new Date().toISOString()
    this.db.prepare(`
      UPDATE price_cards SET name = ?, total_price = ?, package_count = ?, units_per_package = ?,
        content_per_unit = ?, content_unit = ?, merchant = ?, note = ?, source = ?, updated_at = ?
      WHERE id = ?
    `).run(
      draft.name, draft.totalPrice, draft.packageCount, draft.unitsPerPackage,
      draft.contentPerUnit, draft.contentUnit, draft.merchant, draft.note, draft.source, updatedAt, id
    )
    return { ...current, ...draft, updatedAt }
  }

  deleteCard(id: string): void {
    const card = this.requireCard(id)
    this.transaction(() => {
      this.db.prepare('DELETE FROM price_cards WHERE id = ?').run(id)
      const remaining = this.getCards(card.listId)
      const statement = this.db.prepare('UPDATE price_cards SET sort_index = ? WHERE id = ?')
      remaining.forEach((entry, index) => statement.run(index, entry.id))
    })
  }

  reorderCards(listId: string, cardIds: string[]): PriceCard[] {
    const existing = this.getCards(listId)
    if (cardIds.length !== existing.length || new Set(cardIds).size !== cardIds.length) {
      throw new ValidationError('卡片排序数据不完整')
    }
    const existingIds = new Set(existing.map((card) => card.id))
    if (cardIds.some((id) => !existingIds.has(id))) throw new ValidationError('排序中包含未知卡片')
    this.transaction(() => {
      const statement = this.db.prepare('UPDATE price_cards SET sort_index = ?, updated_at = ? WHERE id = ?')
      const now = new Date().toISOString()
      cardIds.forEach((id, index) => statement.run(index, now, id))
    })
    return this.getCards(listId)
  }

  exportSnapshot(): BackupSnapshot {
    const lists = this.getLists()
    const cards = lists.flatMap((list) => this.getCards(list.id))
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), lists, cards }
  }

  replaceSnapshot(snapshot: BackupSnapshot): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM price_cards; DELETE FROM comparison_lists;')
      const listStatement = this.db.prepare(`
        INSERT INTO comparison_lists(id, name, measure_kind, currency_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      snapshot.lists.forEach((list) => listStatement.run(
        list.id, list.name, list.measureKind, list.currencyCode, list.createdAt, list.updatedAt
      ))
      snapshot.cards.forEach((card) => this.insertCard(card))
    })
  }

  private insertCard(card: PriceCard): void {
    this.db.prepare(`
      INSERT INTO price_cards(
        id, list_id, name, total_price, package_count, units_per_package,
        content_per_unit, content_unit, merchant, note, source, sort_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      card.id, card.listId, card.name, card.totalPrice, card.packageCount, card.unitsPerPackage,
      card.contentPerUnit, card.contentUnit, card.merchant, card.note, card.source,
      card.sortIndex, card.createdAt, card.updatedAt
    )
  }

  private requireList(id: string): ComparisonList {
    const list = this.getList(id)
    if (!list) throw new ValidationError('清单不存在')
    return list
  }

  private requireCard(id: string): PriceCard {
    const card = this.getCard(id)
    if (!card) throw new ValidationError('卡片不存在')
    return card
  }

  private transaction(action: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      action()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
