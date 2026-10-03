import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 主变检修与排期单两处共用的字段名：工期口径就守在这一处，页面不再各写各的。
export const F = {
  ledgerNo: '检修编号',
  name: '主变名称',
  station: '所属变电站',
  category: '检修类别',
  scope: '停电范围',
  crew: '检修班组',
  duration: '计划工期',
  approvedDuration: '调度批复工期',
  sheetNo: '排期单号',
  finishDate: '完成日期',
  startDate: '计划开工日期',
} as const

const LEDGER_KEY = 'transformermaint'
const SHEET_KEY = 'schedulesheet'
const PERMIT_KEY = 'workpermit'

const MISSING_DURATION = '待核定'

export type ScheduleSubmitItem = { id: number; planStartDate: string }

export type ScheduleSubmitReport = {
  ok: boolean
  created: number
  duplicated: string[]
  notReady: string[]
  sheets: { no: string; scope: string; count: number }[]
  message: string
}

export type ScheduleCluster = {
  key: string
  category: string
  duration: string
  missingDuration: boolean
  rows: EntryRow[]
  isolated: boolean
}

export type ScheduleGroup = {
  scope: string
  station: string
  clusters: ScheduleCluster[]
}

export type SheetGroup = {
  no: string
  scope: string
  station: string
  planStartDate: string
  rows: EntryRow[]
  status: string
  mixed: boolean
  statusCounts: Record<string, number>
  durationMissing: boolean
  conflict: boolean
  effectiveDuration: string
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}${month}${day}`
}

export function today(): string {
  return `${todayStamp().slice(0, 4)}-${todayStamp().slice(4, 6)}-${todayStamp().slice(6, 8)}`
}

// 既有检修口径：计划工期沿用班组核定值；调度批复一旦下达，两处读到的有效工期都以批复为准。
export function effectiveDuration(row: EntryRow): string {
  const approved = text(row, F.approvedDuration)
  if (approved) {
    return approved
  }
  const planned = text(row, F.duration)
  return planned || MISSING_DURATION
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 待开工且还没落过排期单的主变，才进批量排期候选。
export function schedulableRows(rows: EntryRow[]): EntryRow[] {
  const sheetNos = new Set(listRows(SHEET_KEY).map((row) => text(row, F.ledgerNo)))
  return rows.filter(
    (row) =>
      String(row.status) === '待开工' &&
      !text(row, F.sheetNo) &&
      !sheetNos.has(text(row, F.ledgerNo)),
  )
}

// 按停电范围分组；同组内再按「检修类别 + 有效工期」聚类，只有一台的那簇挑出来单独成栏。
export function buildScheduleGroups(rows: EntryRow[]): ScheduleGroup[] {
  const byScope = new Map<string, EntryRow[]>()
  for (const row of schedulableRows(rows)) {
    const scope = text(row, F.scope)
    const bucket = byScope.get(scope) ?? []
    bucket.push(row)
    byScope.set(scope, bucket)
  }

  return [...byScope.entries()].map(([scope, scopeRows]) => {
    const byCluster = new Map<string, EntryRow[]>()
    for (const row of scopeRows) {
      const duration = effectiveDuration(row)
      const key = `${text(row, F.category)}||${duration}`
      const bucket = byCluster.get(key) ?? []
      bucket.push(row)
      byCluster.set(key, bucket)
    }
    const clusters: ScheduleCluster[] = [...byCluster.entries()].map(([key, clusterRows]) => {
      const first = clusterRows[0]
      const duration = effectiveDuration(first)
      return {
        key,
        category: text(first, F.category),
        duration,
        missingDuration: duration === MISSING_DURATION,
        rows: clusterRows,
        isolated: clusterRows.length === 1,
      }
    })
    // 整批组在前，单独排期栏在后，页面按同一顺序渲染。
    clusters.sort((a, b) => Number(a.isolated) - Number(b.isolated))
    return { scope, station: text(scopeRows[0], F.station), clusters }
  })
}

function nextSheetNo(usedToday: Set<string>): string {
  const prefix = `PS-${todayStamp()}-`
  const existing = listRows(SHEET_KEY)
    .map((row) => text(row, F.sheetNo))
    .filter((no) => no.startsWith(prefix))
  let seq = existing.length
  let no = ''
  do {
    seq += 1
    no = `${prefix}${String(seq).padStart(2, '0')}`
  } while (existing.includes(no) || usedToday.has(no))
  usedToday.add(no)
  return no
}

// 批量提交：同一停电范围共用一张排期单；已落过单的主变只落一条，重复提交幂等跳过，不挡整批。
export function submitBatchSchedule(items: ScheduleSubmitItem[]): ScheduleSubmitReport {
  const ledger = listRows(LEDGER_KEY)
  const sheets = [...listRows(SHEET_KEY)]
  const duplicated: string[] = []
  const notReady: string[] = []
  const created: EntryRow[] = []
  const sheetSummary = new Map<string, { no: string; scope: string; count: number }>()

  const byScope = new Map<string, ScheduleSubmitItem[]>()
  for (const item of items) {
    const row = ledger.find((entry) => Number(entry.id) === item.id)
    if (!row) {
      continue
    }
    const name = `${text(row, F.station)}${text(row, F.name)}`
    if (text(row, F.sheetNo) || sheets.some((s) => text(s, F.ledgerNo) === text(row, F.ledgerNo))) {
      duplicated.push(name)
      continue
    }
    if (String(row.status) !== '待开工') {
      notReady.push(name)
      continue
    }
    const scope = text(row, F.scope)
    const bucket = byScope.get(scope) ?? []
    bucket.push(item)
    byScope.set(scope, bucket)
  }

  const usedToday = new Set<string>()
  const sheetNoByScope = new Map<string, string>()
  for (const scope of byScope.keys()) {
    sheetNoByScope.set(scope, nextSheetNo(usedToday))
  }

  for (const [scope, scopeItems] of byScope) {
    const no = sheetNoByScope.get(scope) as string
    let count = 0
    for (const item of scopeItems) {
      const row = ledger.find((entry) => Number(entry.id) === item.id)
      if (!row) {
        continue
      }
      sheets.push({
        id: nextId([...sheets, ...created]),
        status: '待开工',
        pending: true,
        abnormal: false,
        [F.sheetNo]: no,
        [F.scope]: text(row, F.scope),
        [F.station]: text(row, F.station),
        [F.ledgerNo]: text(row, F.ledgerNo),
        [F.name]: text(row, F.name),
        [F.category]: text(row, F.category),
        [F.crew]: text(row, F.crew),
        [F.startDate]: item.planStartDate || today(),
        [F.duration]: text(row, F.duration),
        [F.approvedDuration]: text(row, F.approvedDuration),
        排期状态: '待开工',
      })
      row[F.sheetNo] = no
      created.push(row)
      count += 1
    }
    sheetSummary.set(scope, { no, scope, count })
  }

  saveRows(LEDGER_KEY, [...ledger])
  saveRows(SHEET_KEY, sheets)

  const parts = [`已落排期明细 ${created.length} 条`]
  if (duplicated.length) {
    parts.push(`重复提交跳过 ${duplicated.length} 台（${duplicated.join('、')}）`)
  }
  if (notReady.length) {
    parts.push(`非待开工未排 ${notReady.length} 台`)
  }
  return {
    ok: created.length > 0,
    created: created.length,
    duplicated,
    notReady,
    sheets: [...sheetSummary.values()],
    message: parts.join('；'),
  }
}

export type BackfillReport = ActionResult & {
  conflict: boolean
  effectiveDuration: string
}

// 检修班组核定后回填：排期单与台账两处同步落值；与调度批复冲突时以批复为准，两处仍保持一致。
export function backfillDuration(
  sheetNo: string,
  teamDuration: string,
  approvedDuration = '',
): BackfillReport {
  const team = teamDuration.trim()
  const approved = approvedDuration.trim()
  const sheets = listRows(SHEET_KEY)
  const groupRows = sheets.filter((row) => text(row, F.sheetNo) === sheetNo)
  if (!groupRows.length) {
    return { ok: false, message: `没有找到排期单 ${sheetNo}`, conflict: false, effectiveDuration: '' }
  }

  const ledgerNos = new Set(groupRows.map((row) => text(row, F.ledgerNo)))
  const ledger = listRows(LEDGER_KEY)
  let conflict = false

  const applyTo = (row: EntryRow): void => {
    if (team) {
      row[F.duration] = team
    }
    if (approved) {
      row[F.approvedDuration] = approved
    }
    const planned = text(row, F.duration)
    const finalApproved = text(row, F.approvedDuration)
    if (finalApproved && planned && finalApproved !== planned) {
      conflict = true
    }
  }

  groupRows.forEach(applyTo)
  ledger.forEach((row) => {
    if (ledgerNos.has(text(row, F.ledgerNo))) {
      applyTo(row)
    }
  })

  saveRows(SHEET_KEY, [...sheets])
  saveRows(LEDGER_KEY, [...ledger])

  const effective = groupRows.map((row) => text(row, F.approvedDuration)).find(Boolean)
    || approved
    || team
    || effectiveDuration(groupRows[0])
  const message = conflict
    ? `班组核定工期与调度批复不一致，已按调度批复工期「${approved}」执行，台账与排期单两处已同步`
    : `工期已回填为「${effective}」，台账与排期单两处口径一致`
  return { ok: true, message, conflict, effectiveDuration: effective }
}

// 排期单状态推进后回写台账：两处状态始终同向，排期单推进到哪台主变就推进到哪。
export function syncLedgerStatus(sheetRow: EntryRow, target: string): void {
  const ledger = listRows(LEDGER_KEY)
  let changed = false
  for (const row of ledger) {
    if (text(row, F.ledgerNo) === text(sheetRow, F.ledgerNo) && String(row.status) !== target) {
      row.status = target
      row.检修状态 = target
      row.pending = target !== '已完工' && target !== '已延期'
      if (target === '已完工') {
        row[F.finishDate] = today()
      }
      changed = true
    }
  }
  if (changed) {
    saveRows(LEDGER_KEY, [...ledger])
  }
}

// 台账侧单台推进时同步对应排期明细。
export function syncSheetStatus(ledgerRow: EntryRow, target: string): void {
  const sheets = listRows(SHEET_KEY)
  let changed = false
  for (const row of sheets) {
    if (text(row, F.ledgerNo) === text(ledgerRow, F.ledgerNo) && String(row.status) !== target) {
      row.status = target
      row.排期状态 = target
      row.pending = target !== '已完工' && target !== '已延期'
      changed = true
    }
  }
  if (changed) {
    saveRows(SHEET_KEY, [...sheets])
  }
}

// 完工确认后，工作票许可的待办清单多出一条待签发工作票；同一台主变只出一条。
export function ensureCompletionPermit(maintenanceRow: EntryRow): boolean {
  const ledgerNo = text(maintenanceRow, F.ledgerNo)
  const permits = listRows(PERMIT_KEY)
  if (permits.some((row) => String(row['来源检修编号'] ?? '') === ledgerNo)) {
    return false
  }
  permits.push({
    id: nextId(permits),
    status: '待签发',
    pending: true,
    abnormal: false,
    工作票号: `WP-${ledgerNo}`,
    工作任务: `${text(maintenanceRow, F.station)}${text(maintenanceRow, F.name)}检修`,
    所属变电站: text(maintenanceRow, F.station),
    停电范围: text(maintenanceRow, F.scope),
    工作负责人: text(maintenanceRow, F.crew),
    来源检修编号: ledgerNo,
    许可时间: '',
    终结时间: '',
    许可状态: '待签发',
  })
  saveRows(PERMIT_KEY, permits)
  return true
}

export function sheetMeta() {
  const meta = MODULE_BY_KEY.get(SHEET_KEY)
  if (!meta) {
    throw new Error('排期单模块未登记')
  }
  return meta
}

// 排期单页：一张单号一栏，状态全一致才允许整组推进，混态只能逐台处理。
export function listSheetGroups(): SheetGroup[] {
  const rows = listRows(SHEET_KEY)
  const byNo = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const no = text(row, F.sheetNo)
    const bucket = byNo.get(no) ?? []
    bucket.push(row)
    byNo.set(no, bucket)
  }

  return [...byNo.entries()].map(([no, groupRows]) => {
    const statusCounts: Record<string, number> = {}
    for (const row of groupRows) {
      const status = String(row.status)
      statusCounts[status] = (statusCounts[status] ?? 0) + 1
    }
    const statuses = Object.keys(statusCounts)
    const approved = groupRows.map((row) => text(row, F.approvedDuration)).find(Boolean)
    const planned = [...new Set(groupRows.map((row) => text(row, F.duration)))].filter(Boolean)
    return {
      no,
      scope: text(groupRows[0], F.scope),
      station: text(groupRows[0], F.station),
      planStartDate: text(groupRows[0], F.startDate),
      rows: groupRows,
      status: statuses.length === 1 ? statuses[0] : '',
      mixed: statuses.length > 1,
      statusCounts,
      durationMissing: groupRows.some((row) => effectiveDuration(row) === MISSING_DURATION),
      conflict: groupRows.some(
        (row) => text(row, F.approvedDuration) && text(row, F.approvedDuration) !== text(row, F.duration),
      ),
      effectiveDuration: approved || planned.join(' / ') || MISSING_DURATION,
    }
  })
}
