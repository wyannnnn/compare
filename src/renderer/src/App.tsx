import { useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Decimal from 'decimal.js'
import { calculatePrice, findLowestCardIds, tryCalculatePrice } from '../../shared/calculator'
import {
  SHORT_MEASURE_LABELS,
  type CardDraft,
  type ComparisonList,
  type ComparisonListDraft,
  type ContentUnit,
  type MeasureKind,
  type PriceCard,
  type VolumeUnit,
  type WeightUnit
} from '../../shared/types'

const logoUrl = new URL('./assets/logo.png', import.meta.url).href
const measureOrder: MeasureKind[] = ['count', 'volume', 'weight']
const fixedCurrencyCode = 'CNY'
type DisplayUnit = 'L' | 'ml' | 'kg' | 'g'

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败，请稍后重试'
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function formatCurrency(value: string, currency: string, unitPrice = false): string {
  const numeric = new Decimal(value).toNumber()
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: unitPrice ? 2 : undefined,
    maximumFractionDigits: unitPrice ? 4 : undefined
  }).format(numeric)
}

function formatDecimal(value: string): string {
  return new Decimal(value).toDecimalPlaces(4).toString()
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand?.('copy') ?? false
  document.body.removeChild(textarea)
  if (!copied) throw new Error('Clipboard copy failed')
}

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span aria-hidden="true">{children}</span>
}

function activeMeasureKind(list: ComparisonList): MeasureKind {
  return list.measureKind ?? list.measureKinds?.[0] ?? 'volume'
}

function measureSummary(list: ComparisonList): string {
  return unitPriceTitle(activeMeasureKind(list))
}

function hasMeasure(list: ComparisonList, measureKind: MeasureKind): boolean {
  return activeMeasureKind(list) === measureKind
}

function unitPriceTitle(measureKind: MeasureKind, displayUnit?: DisplayUnit | null): string {
  if (measureKind === 'count') return '每件 / 每瓶'
  if (measureKind === 'volume') return displayUnit === 'ml' ? '每毫升' : '每升'
  return displayUnit === 'g' ? '每克' : '每千克'
}

function contentSpec(card: PriceCard, list: ComparisonList): string[] {
  const specs: string[] = []
  if (hasMeasure(list, 'volume')) specs.push(card.volumePerUnit && card.volumeUnit ? `${card.volumePerUnit} ${card.volumeUnit}/件` : '容量待补充')
  if (hasMeasure(list, 'weight')) specs.push(card.weightPerUnit && card.weightUnit ? `${card.weightPerUnit} ${card.weightUnit}/件` : '重量待补充')
  return specs
}

function formatPercent(value: string): string {
  return `${new Decimal(value).toDecimalPlaces(2).toString()}%`
}

function formatMultiplier(value: string): string {
  return `${new Decimal(value).toDecimalPlaces(4).toString()} 倍`
}

function displayUnitPrice(
  value: string,
  unitLabel: '件' | 'L' | 'kg',
  adjusted: boolean,
  displayUnit: DisplayUnit | null
): { value: string, unitLabel: string } {
  if ((unitLabel === 'L' && displayUnit === 'ml') || (unitLabel === 'kg' && displayUnit === 'g')) {
    return {
      value: new Decimal(value).div(1000).toString(),
      unitLabel: adjusted ? `有效 ${displayUnit}` : displayUnit
    }
  }
  return { value, unitLabel: adjusted ? `有效 ${unitLabel}` : unitLabel }
}

function displayUnitFor(measureKind: MeasureKind, preferred?: DisplayUnit): DisplayUnit | null {
  if (measureKind === 'volume') {
    return preferred === 'ml' ? 'ml' : 'L'
  }
  if (measureKind === 'weight') {
    return preferred === 'g' ? 'g' : 'kg'
  }
  return null
}

function nextDisplayUnit(measureKind: MeasureKind, current?: DisplayUnit): DisplayUnit | null {
  if (measureKind === 'volume') {
    return current === 'ml' ? 'L' : 'ml'
  }
  if (measureKind === 'weight') {
    return current === 'g' ? 'kg' : 'g'
  }
  return null
}

function displayUnitSwitchLabel(measureKind: MeasureKind): string | null {
  if (measureKind === 'volume') return 'L/ml'
  if (measureKind === 'weight') return 'kg/g'
  return null
}

export function App(): React.JSX.Element {
  const [lists, setLists] = useState<ComparisonList[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cards, setCards] = useState<PriceCard[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [listDialog, setListDialog] = useState<'create' | 'edit' | null>(null)
  const [drawerCard, setDrawerCard] = useState<PriceCard | 'new' | null>(null)
  const [backupMenuOpen, setBackupMenuOpen] = useState(false)
  const [displayUnits, setDisplayUnits] = useState<Record<string, DisplayUnit>>({})
  const noticeTimer = useRef<number | null>(null)
  const selectedList = lists.find((list) => list.id === selectedId) ?? null
  const currentCards = useMemo(
    () => selectedId ? cards.filter((card) => card.listId === selectedId) : [],
    [cards, selectedId]
  )

  const showNotice = (message: string): void => {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3800)
  }

  const copyUnitPrice = async (text: string): Promise<void> => {
    try {
      await copyTextToClipboard(text)
      showNotice('已复制单价')
    } catch {
      showNotice('复制失败，请手动选择复制')
    }
  }

  useEffect(() => {
    let active = true
    window.compareApi.lists.getAll()
      .then((items) => {
        if (!active) return
        setLists(items)
        setSelectedId((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null))
      })
      .catch((error) => showNotice(errorMessage(error)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setCards([])
      return
    }
    let active = true
    setLoading(true)
    window.compareApi.cards.getAll(selectedId)
      .then((items) => active && setCards(items))
      .catch((error) => active && showNotice(errorMessage(error)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [selectedId])

  const handleListSaved = (saved: ComparisonList, created: boolean): void => {
    setLists((current) => {
      const withoutSaved = current.filter((item) => item.id !== saved.id)
      return created ? [...withoutSaved, saved] : current.map((item) => item.id === saved.id ? saved : item)
    })
    if (created) setCards([])
    setSelectedId(saved.id)
    setListDialog(null)
    showNotice(created ? '清单已创建' : '清单设置已保存')
  }

  const deleteCurrentList = async (): Promise<void> => {
    if (!selectedList || !window.confirm(`删除“${selectedList.name}”及其中全部卡片？此操作无法撤销。`)) return
    try {
      await window.compareApi.lists.delete(selectedList.id)
      const next = lists.filter((item) => item.id !== selectedList.id)
      setLists(next)
      setSelectedId(next[0]?.id ?? null)
      showNotice('清单已删除')
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const handleCardSaved = (saved: PriceCard, created: boolean): void => {
    setCards((current) => created ? [...current, saved] : current.map((item) => item.id === saved.id ? saved : item))
    setDrawerCard(null)
    showNotice(created ? '卡片已添加到最右侧' : '卡片已更新')
    if (created) {
      window.setTimeout(() => document.querySelector('.board-scroll')?.scrollTo({ left: 100000, behavior: 'smooth' }), 40)
    }
  }

  const deleteCard = async (card: PriceCard): Promise<void> => {
    if (!window.confirm(`删除“${card.name}”这张卡片？`)) return
    try {
      await window.compareApi.cards.delete(card.id)
      setCards((current) => current.filter((item) => item.id !== card.id).map((item, index) => ({ ...item, sortIndex: index })))
      showNotice('卡片已删除')
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const reorderCards = async (nextCards: PriceCard[]): Promise<void> => {
    if (!selectedList) return
    const previous = currentCards
    const optimistic = nextCards.map((card, index) => ({ ...card, sortIndex: index }))
    setCards(optimistic)
    try {
      const saved = await window.compareApi.cards.reorder(selectedList.id, optimistic.map((card) => card.id))
      setCards(saved)
    } catch (error) {
      setCards(previous)
      showNotice(errorMessage(error))
    }
  }

  const exportBackup = async (): Promise<void> => {
    setBackupMenuOpen(false)
    try {
      const result = await window.compareApi.backup.export()
      if (result.status === 'completed') showNotice(`已导出 ${result.listCount} 个清单、${result.cardCount} 张卡片`)
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  const restoreBackup = async (): Promise<void> => {
    setBackupMenuOpen(false)
    try {
      const result = await window.compareApi.backup.restore()
      if (result.status !== 'completed') return
      const restoredLists = await window.compareApi.lists.getAll()
      setLists(restoredLists)
      const firstList = restoredLists[0] ?? null
      const restoredCards = firstList ? await window.compareApi.cards.getAll(firstList.id) : []
      setSelectedId(firstList?.id ?? null)
      setCards(restoredCards)
      showNotice(`已恢复 ${result.listCount} 个清单、${result.cardCount} 张卡片`)
    } catch (error) {
      showNotice(errorMessage(error))
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="" />
          <div><strong>比价卡</strong><span>把单价摆明白</span></div>
        </div>
        <div className="sidebar-title">
          <span>对比清单</span>
          <button className="icon-button" aria-label="新建清单" title="新建清单" onClick={() => setListDialog('create')}>＋</button>
        </div>
        <nav className="list-nav" aria-label="对比清单">
          {lists.map((list) => (
            <button
              key={list.id}
              className={`list-nav-item ${selectedId === list.id ? 'active' : ''}`}
                  onClick={() => {
                    if (list.id !== selectedId) setLoading(true)
                    setDrawerCard(null)
                    setSelectedId(list.id)
                  }}
            >
              <span className="list-dot" />
              <span className="list-nav-copy"><strong>{list.name}</strong><small>{measureSummary(list)} · 人民币</small></span>
            </button>
          ))}
          {!loading && lists.length === 0 && <p className="sidebar-empty">还没有清单。<br />从一箱水开始也很好。</p>}
        </nav>
        <div className="sidebar-footer">
          <div className="backup-menu">
            <button className="quiet-button backup-menu-button" aria-expanded={backupMenuOpen} onClick={() => setBackupMenuOpen((open) => !open)}><Icon>⇅</Icon> 备份与恢复</button>
            {backupMenuOpen && (
              <div className="backup-menu-popover" role="menu">
                <button role="menuitem" onClick={exportBackup}><Icon>⇧</Icon> 导出备份</button>
                <button role="menuitem" onClick={restoreBackup}><Icon>⇩</Icon> 恢复备份</button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main-area">
        {selectedList ? (
          <>
            <header className="main-header">
              <div>
                <div className="eyebrow">当前清单</div>
                <h1>{selectedList.name}</h1>
                <div className="header-badges">
                  <span>{measureSummary(selectedList)}</span>
                  <span>人民币</span>
                  <span>{currentCards.length} 张卡片</span>
                </div>
              </div>
              <div className="header-actions">
                <button className="secondary-button" onClick={() => setListDialog('edit')}>清单设置</button>
                <button className="danger-quiet-button" onClick={deleteCurrentList}>删除清单</button>
                <button className="primary-button" onClick={() => setDrawerCard('new')}>＋ 新建卡片</button>
              </div>
            </header>
            <PriceBoard
              list={selectedList}
              cards={currentCards}
              loading={loading}
              displayUnit={displayUnitFor(activeMeasureKind(selectedList), displayUnits[selectedList.id])}
              onToggleDisplayUnit={() => setDisplayUnits((current) => {
                const measureKind = activeMeasureKind(selectedList)
                const next = nextDisplayUnit(measureKind, current[selectedList.id])
                return next ? { ...current, [selectedList.id]: next } : current
              })}
              onAdd={() => setDrawerCard('new')}
              onEdit={setDrawerCard}
              onDelete={deleteCard}
              onCopyUnitPrice={(text) => { void copyUnitPrice(text) }}
              onReorder={reorderCards}
            />
          </>
        ) : (
          <section className="welcome">
            <div className="welcome-art"><span>¥</span><span>÷</span><span>L</span></div>
            <div className="eyebrow">欢迎使用比价卡</div>
            <h1>价格不同，规格也不同？<br />先换成同一个单位再说。</h1>
            <p>建立一个对比清单，录入包装和价格。每瓶、每升或每千克的真实单价会自动算好。</p>
            <button className="primary-button large" onClick={() => setListDialog('create')}>创建第一个清单</button>
          </section>
        )}
      </main>

      {listDialog && (
        <ListDialog
          key={listDialog === 'edit' ? `edit-${selectedId}` : 'create'}
          list={listDialog === 'edit' ? selectedList : null}
          hasCards={listDialog === 'edit' && currentCards.length > 0}
          onClose={() => setListDialog(null)}
          onSaved={handleListSaved}
        />
      )}
      {drawerCard && selectedList && (
        <CardDrawer
          list={selectedList}
          card={drawerCard === 'new' ? null : drawerCard}
          onClose={() => setDrawerCard(null)}
          onSaved={handleCardSaved}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

interface PriceBoardProps {
  list: ComparisonList
  cards: PriceCard[]
  loading: boolean
  displayUnit: DisplayUnit | null
  onToggleDisplayUnit(): void
  onAdd(): void
  onEdit(card: PriceCard): void
  onDelete(card: PriceCard): void
  onCopyUnitPrice(text: string): void
  onReorder(cards: PriceCard[]): void
}

function PriceBoard({ list, cards, loading, displayUnit, onToggleDisplayUnit, onAdd, onEdit, onDelete, onCopyUnitPrice, onReorder }: PriceBoardProps): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const measureKind = activeMeasureKind(list)
  const lowestIds = useMemo(() => findLowestCardIds(cards, measureKind), [cards, measureKind])
  const activeCard = cards.find((card) => card.id === activeId) ?? null

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null)
    if (!event.over || event.active.id === event.over.id) return
    const oldIndex = cards.findIndex((card) => card.id === event.active.id)
    const newIndex = cards.findIndex((card) => card.id === event.over?.id)
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(cards, oldIndex, newIndex))
  }

  const handleWheel = (event: React.WheelEvent<HTMLElement>): void => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.currentTarget.scrollLeft += event.deltaY
    event.preventDefault()
  }

  return (
    <section className="board-scroll" aria-label={`${list.name}商品卡片`} onWheelCapture={handleWheel}>
      {loading && cards.length === 0 ? (
        <div className="loading-state">正在读取卡片…</div>
      ) : cards.length === 0 ? (
        <button className="empty-board" onClick={onAdd}>
          <span className="empty-plus">＋</span>
          <strong>添加第一张价格卡</strong>
          <small>总价、包装数量和规格都会换算成统一单价</small>
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={cards.map((card) => card.id)} strategy={horizontalListSortingStrategy}>
            {cards.map((card) => (
              <SortablePriceCard
                key={card.id}
                card={card}
                list={list}
                lowest={lowestIds.has(card.id)}
                displayUnit={displayUnit}
                onToggleDisplayUnit={onToggleDisplayUnit}
                onEdit={() => onEdit(card)}
                onDelete={() => onDelete(card)}
                onCopyUnitPrice={onCopyUnitPrice}
              />
            ))}
          </SortableContext>
          <DragOverlay>{activeCard && <PriceCardView card={activeCard} list={list} lowest={lowestIds.has(activeCard.id)} displayUnit={displayUnit} onToggleDisplayUnit={onToggleDisplayUnit} onCopyUnitPrice={onCopyUnitPrice} overlay />}</DragOverlay>
        </DndContext>
      )}
      {cards.length > 0 && (
        <button className="add-card-tile" onClick={onAdd}><span>＋</span><strong>新建卡片</strong><small>添加到最右侧</small></button>
      )}
    </section>
  )
}

function SortablePriceCard(props: Omit<PriceCardViewProps, 'dragHandle' | 'overlay'>): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.card.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'sortable dragging' : 'sortable'}>
      <PriceCardView {...props} dragHandle={{ ...attributes, ...listeners }} />
    </div>
  )
}

interface PriceCardViewProps {
  card: PriceCard
  list: ComparisonList
  lowest: boolean
  displayUnit: DisplayUnit | null
  onToggleDisplayUnit(): void
  onCopyUnitPrice(text: string): void
  overlay?: boolean
  dragHandle?: React.ButtonHTMLAttributes<HTMLButtonElement>
  onEdit?(): void
  onDelete?(): void
}

function PriceCardView({ card, list, lowest, displayUnit, onToggleDisplayUnit, onCopyUnitPrice, overlay, dragHandle, onEdit, onDelete }: PriceCardViewProps): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const measureKind = activeMeasureKind(list)
  const countResult = calculatePrice(card, 'count')
  const specs = contentSpec(card, list)
  const result = tryCalculatePrice(card, measureKind)
  const display = result ? displayUnitPrice(result.normalizedPrice, result.normalizedUnitLabel, result.adjusted, displayUnit) : null
  const switchLabel = result ? displayUnitSwitchLabel(measureKind) : null
  const formattedUnitPrice = display ? formatCurrency(display.value, list.currencyCode, true) : null
  const copyText = formattedUnitPrice && display ? `${formattedUnitPrice} / ${display.unitLabel}` : null
  const extraDetailCount = [
    card.activeIngredientPercent,
    card.absorptionMultiplier,
    card.merchant,
    card.note
  ].filter(Boolean).length
  const hasExtraDetails = extraDetailCount > 0
  return (
    <article className={`price-card ${lowest ? 'lowest' : ''} ${detailsExpanded ? 'expanded' : ''} ${overlay ? 'overlay-card' : ''}`}>
      <div className="card-topline">
        <button className="drag-handle" aria-label={`拖动${card.name}`} title="拖动改变位置" {...dragHandle}>⠿</button>
        {lowest ? <span className="lowest-badge">当前最低</span> : <span />}
        {!overlay && <button className="more-button" aria-label={`编辑${card.name}`} onClick={onEdit}>•••</button>}
      </div>
      <div className="card-title"><h2>{card.name}</h2><strong>{formatCurrency(card.totalPrice, list.currencyCode)}</strong></div>
      <div className="spec-box">
        <span>包装规格</span>
        <strong>{card.packageCount} 包 × {card.unitsPerPackage} 件</strong>
        {specs.map((spec) => <small key={spec}>{spec}</small>)}
      </div>
      <dl className="card-details">
        <div><dt>总件数</dt><dd>{formatDecimal(countResult.totalUnits)} 件</dd></div>
        <div><dt>基础每件价</dt><dd>{formatCurrency(countResult.pricePerUnit, list.currencyCode, true)}</dd></div>
        {detailsExpanded && (
          <>
            {card.activeIngredientPercent && <div><dt>有效成分</dt><dd>{formatPercent(card.activeIngredientPercent)}</dd></div>}
            {card.absorptionMultiplier && <div><dt>倍率</dt><dd>{formatMultiplier(card.absorptionMultiplier)}</dd></div>}
            {card.merchant && <div><dt>购买商家</dt><dd>{card.merchant}</dd></div>}
            {card.note && <div className="note-row"><dt>备注</dt><dd title={card.note}>{card.note}</dd></div>}
          </>
        )}
      </dl>
      {hasExtraDetails && !overlay && (
        <button
          type="button"
          className="details-toggle"
          aria-expanded={detailsExpanded}
          onClick={() => setDetailsExpanded((expanded) => !expanded)}
        >
          {detailsExpanded ? '收起详情' : `展开详情（${extraDetailCount}）`}
        </button>
      )}
      <div className="unit-price-list">
        <div className={`unit-price ${lowest ? 'lowest-unit' : ''}`}>
          <span>{result?.adjusted ? '有效单价' : unitPriceTitle(measureKind, displayUnit)}</span>
          {result && display ? (
            <>
              <button
                type="button"
                className="unit-copy-button"
                title="点击复制单价"
                aria-label={`复制单价 ${copyText}`}
                onClick={() => copyText && onCopyUnitPrice(copyText)}
              >
                <strong>{formattedUnitPrice}</strong>
                <small>/ {display.unitLabel}</small>
              </button>
              {switchLabel && (
                <button
                  type="button"
                  className="unit-switch-button"
                  title={`${switchLabel} 切换`}
                  aria-label={`切换 ${switchLabel} 显示`}
                  onClick={onToggleDisplayUnit}
                >
                  {switchLabel}
                </button>
              )}
            </>
          ) : (
            <>
              <strong>待补充</strong>
              <small>{measureKind === 'volume' ? '需要容量' : '需要重量'}</small>
            </>
          )}
        </div>
      </div>
      {!overlay && (
        <div className="card-actions single-action">
          <button className="delete-link" onClick={onDelete}>删除</button>
        </div>
      )}
    </article>
  )
}

interface ListDialogProps {
  list: ComparisonList | null
  hasCards: boolean
  onClose(): void
  onSaved(list: ComparisonList, created: boolean): void
}

function ListDialog({ list, hasCards, onClose, onSaved }: ListDialogProps): React.JSX.Element {
  const [name, setName] = useState(list?.name ?? '')
  const [selectedMeasure, setSelectedMeasure] = useState<MeasureKind>(list ? activeMeasureKind(list) : 'volume')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const draft: ComparisonListDraft = { name, measureKind: selectedMeasure, measureKinds: [selectedMeasure], currencyCode: fixedCurrencyCode }
    try {
      const saved = list
        ? await window.compareApi.lists.update(list.id, draft)
        : await window.compareApi.lists.create(draft)
      onSaved(saved, !list)
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="list-dialog-title">
        <div className="dialog-heading"><div><div className="eyebrow">{list ? '清单设置' : '新的对比'}</div><h2 id="list-dialog-title">{list ? '编辑清单' : '创建对比清单'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>
        <form onSubmit={submit}>
          <label className="field"><span>清单名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：矿泉水" required /></label>
          <fieldset className="field">
            <legend>比较基准</legend>
            <div className="segmented">
              {measureOrder.map((kind) => (
                <label key={kind} className={selectedMeasure === kind ? 'selected' : ''}>
                  <input type="radio" name="measure" value={kind} checked={selectedMeasure === kind} onChange={() => setSelectedMeasure(kind)} />
                  {SHORT_MEASURE_LABELS[kind]}
                </label>
              ))}
            </div>
            <small>每个清单只使用一种比较基准；需要另一种算法时，可以新建一个清单。</small>
          </fieldset>
          <p className="field-hint">暂时固定使用人民币（CNY），这里先不需要填写货币代码。</p>
          {hasCards && <p className="field-hint">提示：修改比较基准后，已有卡片可能需要编辑补充对应规格。</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存清单'}</button></div>
        </form>
      </section>
    </div>
  )
}

interface CardDrawerProps {
  list: ComparisonList
  card: PriceCard | null
  onClose(): void
  onSaved(card: PriceCard, created: boolean): void
}

interface CardFormState {
  name: string
  totalPrice: string
  packageCount: string
  unitsPerPackage: string
  volumePerUnit: string
  volumeUnit: VolumeUnit | ''
  weightPerUnit: string
  weightUnit: WeightUnit | ''
  useActiveIngredient: boolean
  activeIngredientPercent: string
  useAbsorptionMultiplier: boolean
  absorptionMultiplier: string
  merchant: string
  note: string
}

function CardDrawer({ list, card, onClose, onSaved }: CardDrawerProps): React.JSX.Element {
  const measureKind = activeMeasureKind(list)
  const defaultVolumeUnit: VolumeUnit | '' = hasMeasure(list, 'volume') ? 'ml' : ''
  const defaultWeightUnit: WeightUnit | '' = hasMeasure(list, 'weight') ? 'g' : ''
  const [form, setForm] = useState<CardFormState>({
    name: card?.name ?? '',
    totalPrice: card?.totalPrice ?? '',
    packageCount: String(card?.packageCount ?? 1),
    unitsPerPackage: String(card?.unitsPerPackage ?? 1),
    volumePerUnit: card?.volumePerUnit ?? ((card?.contentUnit === 'ml' || card?.contentUnit === 'L') ? card.contentPerUnit ?? '' : ''),
    volumeUnit: card?.volumeUnit ?? ((card?.contentUnit === 'ml' || card?.contentUnit === 'L') ? card.contentUnit : defaultVolumeUnit),
    weightPerUnit: card?.weightPerUnit ?? ((card?.contentUnit === 'g' || card?.contentUnit === 'kg') ? card.contentPerUnit ?? '' : ''),
    weightUnit: card?.weightUnit ?? ((card?.contentUnit === 'g' || card?.contentUnit === 'kg') ? card.contentUnit : defaultWeightUnit),
    useActiveIngredient: Boolean(card?.activeIngredientPercent),
    activeIngredientPercent: card?.activeIngredientPercent ?? '',
    useAbsorptionMultiplier: Boolean(card?.absorptionMultiplier),
    absorptionMultiplier: card?.absorptionMultiplier ?? '',
    merchant: card?.merchant ?? '',
    note: card?.note ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const update = <K extends keyof CardFormState>(key: K, value: CardFormState[K]): void => setForm((current) => ({ ...current, [key]: value }))
  const draft: CardDraft = {
    name: form.name,
    totalPrice: form.totalPrice,
    packageCount: Number(form.packageCount),
    unitsPerPackage: Number(form.unitsPerPackage),
    contentPerUnit: hasMeasure(list, 'volume') ? form.volumePerUnit : hasMeasure(list, 'weight') ? form.weightPerUnit : null,
    contentUnit: hasMeasure(list, 'volume') ? form.volumeUnit as ContentUnit : hasMeasure(list, 'weight') ? form.weightUnit as ContentUnit : null,
    volumePerUnit: hasMeasure(list, 'volume') ? form.volumePerUnit : null,
    volumeUnit: hasMeasure(list, 'volume') ? form.volumeUnit as VolumeUnit : null,
    weightPerUnit: hasMeasure(list, 'weight') ? form.weightPerUnit : null,
    weightUnit: hasMeasure(list, 'weight') ? form.weightUnit as WeightUnit : null,
    activeIngredientPercent: form.useActiveIngredient ? form.activeIngredientPercent : null,
    absorptionMultiplier: form.useAbsorptionMultiplier ? form.absorptionMultiplier : null,
    merchant: form.merchant || null,
    note: form.note || null,
    source: card?.source ?? 'manual'
  }
  const preview = tryCalculatePrice(draft, measureKind)
  const adjustmentInputsReady = (!form.useActiveIngredient || form.activeIngredientPercent.trim() !== '') &&
    (!form.useAbsorptionMultiplier || form.absorptionMultiplier.trim() !== '')
  const previewReady = Boolean(preview) && adjustmentInputsReady

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = card
        ? await window.compareApi.cards.update(card.id, draft)
        : await window.compareApi.cards.create(list.id, draft)
      onSaved(saved, !card)
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="card-drawer-title">
        <div className="drawer-heading"><div><div className="eyebrow">{card ? '更新报价' : '添加比较项'}</div><h2 id="card-drawer-title">{card ? '编辑价格卡' : '新建价格卡'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>
        <form onSubmit={submit} className="drawer-form">
          <label className="field"><span>商品名称</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：农夫山泉 550ml" required /></label>
          <label className="field"><span>总价</span><div className="input-with-prefix"><span>¥</span><input type="number" min="0" step="any" value={form.totalPrice} onChange={(event) => update('totalPrice', event.target.value)} placeholder="0.00" required /></div><small>这里填写以下全部包装合计的价格</small></label>
          <div className="field-row">
            <label className="field"><span>包装数量</span><input type="number" min="1" step="1" value={form.packageCount} onChange={(event) => update('packageCount', event.target.value)} required /><small>例如 2 箱</small></label>
            <label className="field"><span>每包装件数</span><input type="number" min="1" step="1" value={form.unitsPerPackage} onChange={(event) => update('unitsPerPackage', event.target.value)} required /><small>例如每箱 24 瓶</small></label>
          </div>
          {hasMeasure(list, 'volume') && (
            <label className="field"><span>每件容量</span><div className="input-with-select"><input type="number" min="0" step="any" value={form.volumePerUnit} onChange={(event) => update('volumePerUnit', event.target.value)} placeholder="550" required /><select value={form.volumeUnit} onChange={(event) => update('volumeUnit', event.target.value)}><option>ml</option><option>L</option></select></div><small>用于计算每升价格</small></label>
          )}
          {hasMeasure(list, 'weight') && (
            <label className="field"><span>每件重量</span><div className="input-with-select"><input type="number" min="0" step="any" value={form.weightPerUnit} onChange={(event) => update('weightPerUnit', event.target.value)} placeholder="500" required /><select value={form.weightUnit} onChange={(event) => update('weightUnit', event.target.value)}><option>g</option><option>kg</option></select></div><small>用于计算每千克价格</small></label>
          )}
          <div className="optional-adjustments">
            <label className="option-toggle"><input type="checkbox" checked={form.useActiveIngredient} onChange={(event) => update('useActiveIngredient', event.target.checked)} /> 启用有效成分占比</label>
            {form.useActiveIngredient && (
              <label className="field"><span>有效成分占比</span><div className="input-with-suffix"><input type="number" min="0" max="100" step="any" value={form.activeIngredientPercent} onChange={(event) => update('activeIngredientPercent', event.target.value)} placeholder="72" required /><span>%</span></div><small>例如鱼油 DHA+EPA 72%，就填 72</small></label>
            )}
            <label className="option-toggle"><input type="checkbox" checked={form.useAbsorptionMultiplier} onChange={(event) => update('useAbsorptionMultiplier', event.target.checked)} /> 启用倍率修正</label>
            {form.useAbsorptionMultiplier && (
              <label className="field"><span>倍率</span><input type="number" min="0" step="any" value={form.absorptionMultiplier} onChange={(event) => update('absorptionMultiplier', event.target.value)} placeholder="0.65" required /><small>例如 rTG 填 1，EE 可填 0.65</small></label>
            )}
          </div>
          <div className={`live-preview ${previewReady ? 'ready' : ''}`}>
            <span>实时计算</span>
            {preview ? (
              <div>
                <p><small>{unitPriceTitle(measureKind)}</small><strong>{formatCurrency(preview.baseNormalizedPrice, list.currencyCode, true)} / {preview.normalizedUnitLabel}</strong></p>
                <p><small>{preview.adjusted ? '有效单价' : '对比单价'}</small><strong>{formatCurrency(preview.normalizedPrice, list.currencyCode, true)} / {preview.adjusted ? `有效 ${preview.normalizedUnitLabel}` : preview.normalizedUnitLabel}</strong></p>
              </div>
            ) : <p>填写完整规格后，这里会自动显示单价。</p>}
          </div>
          <label className="field"><span>购买商家 <em>选填</em></span><input value={form.merchant} onChange={(event) => update('merchant', event.target.value)} placeholder="例如：京东自营" /></label>
          <label className="field"><span>备注 <em>选填</em></span><textarea rows={4} value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="促销条件、配送费用、口味等" /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="drawer-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving || !previewReady}>{saving ? '保存中…' : card ? '保存修改' : '添加到最右侧'}</button></div>
        </form>
      </aside>
    </div>
  )
}
