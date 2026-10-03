import { moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BatchScheduleResult,
  EntryRow,
  ScheduleGroup,
  ScheduleRow,
} from '@/data/types'

// 主变检修排期单：批量排期、分组推进、工期核定/批复都走这里，台账页面不直接改状态。
const LEDGER_KEY = 'transformermaint'
const SCHEDULE_KEY = 'transformerschedule'
const WORKPERMIT_KEY = 'workpermit'

const LEDGER_FIELDS = {
  code: '检修编号',
  name: '主变名称',
  category: '检修类别',
  scope: '停电范围',
  crew: '检修班组',
  duration: '计划工期',
  finishDate: '完成日期',
  ledgerStatus: '检修状态',
} as const

// 状态只能按「待开工 → 检修中 → 已完工」推进；已延期是检修中的分支（延期后复工回检修中），越级一律挡回。
const NEXT_STATUS: Record<string, string[]> = {
  待开工: ['检修中'],
  检修中: ['已完工', '已延期'],
  已延期: ['检修中'],
  已完工: [],
}

const FORMAL_ACTIONS = new Set(['提交开工', '确认完工', '申请延期'])

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayText(): string {
  return nowText().slice(0, 10)
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

// 已落过正式排期单的检修编号：同一台主变重复提交只落一条。
export function scheduledCodes(): Set<string> {
  return new Set(
    listRows(SCHEDULE_KEY)
      .filter((row) => String(row.status) !== '差异待处理')
      .map((row) => text(row, LEDGER_FIELDS.code)),
  )
}

function formalSchedules(): ScheduleRow[] {
  return listRows(SCHEDULE_KEY).filter(
    (row) => String(row.status) !== '差异待处理',
  ) as ScheduleRow[]
}

export function listSchedules(): ScheduleRow[] {
  return listRows(SCHEDULE_KEY) as ScheduleRow[]
}

export function listDiffSchedules(): ScheduleRow[] {
  return listRows(SCHEDULE_KEY).filter(
    (row) => String(row.status) === '差异待处理',
  ) as ScheduleRow[]
}

// 排期单按停电范围分组展示，组内保持台账原有先后。
export function scheduleGroups(): { scope: string; rows: ScheduleRow[] }[] {
  const buckets = new Map<string, ScheduleRow[]>()
  for (const row of formalSchedules()) {
    const scope = text(row, LEDGER_FIELDS.scope)
    const bucket = buckets.get(scope) ?? []
    bucket.push(row)
    buckets.set(scope, bucket)
  }
  return [...buckets.entries()].map(([scope, rows]) => ({ scope, rows }))
}

function modeValue(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best = values[0]
  let bestCount = 0
  for (const value of values) {
    const count = counts.get(value) ?? 0
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

// 提交前预览：按停电范围聚合，检修类别或计划工期与同组多数不一致的那几台挑为差异。
export function previewBatchSchedule(ids: number[]): ScheduleGroup[] {
  const already = scheduledCodes()
  const picked = listRows(LEDGER_KEY).filter(
    (row) => ids.includes(Number(row.id)) && !already.has(text(row, LEDGER_FIELDS.code)),
  )
  const byScope = new Map<string, EntryRow[]>()
  for (const row of picked) {
    const scope = text(row, LEDGER_FIELDS.scope)
    const bucket = byScope.get(scope) ?? []
    bucket.push(row)
    byScope.set(scope, bucket)
  }
  return [...byScope.entries()].map(([scope, rows]) => {
    const categories = rows.map((row) => text(row, LEDGER_FIELDS.category))
    const durations = rows.map((row) => text(row, LEDGER_FIELDS.duration))
    // 同组只有一台时没有参照，直接作为一组排期，不会进差异栏。
    const category = rows.length > 1 ? modeValue(categories) : categories[0]
    const duration = rows.length > 1 ? modeValue(durations) : durations[0]
    const diffRows: EntryRow[] = []
    const diffReasons: Record<number, string> = {}
    const uniform: EntryRow[] = []
    for (const row of rows) {
      const reasons: string[] = []
      if (text(row, LEDGER_FIELDS.category) !== category) {
        reasons.push(`检修类别为「${text(row, LEDGER_FIELDS.category)}」，与本组「${category}」不一致`)
      }
      if (text(row, LEDGER_FIELDS.duration) !== duration) {
        reasons.push(`计划工期为「${text(row, LEDGER_FIELDS.duration)}」，与本组「${duration}」不一致`)
      }
      if (reasons.length > 0) {
        diffRows.push(row)
        diffReasons[Number(row.id)] = reasons.join('；')
      } else {
        uniform.push(row)
      }
    }
    return { scope, category, duration, rows: uniform, diffRows, diffReasons }
  })
}

function nextScheduleId(): number {
  const rows = listRows(SCHEDULE_KEY)
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function buildScheduleRow(row: EntryRow, isDiff: boolean, reason = ''): ScheduleRow {
  const status = isDiff ? '差异待处理' : '待开工'
  return {
    id: nextScheduleId(),
    status,
    pending: true,
    abnormal: false,
    检修编号: text(row, LEDGER_FIELDS.code),
    主变名称: text(row, LEDGER_FIELDS.name),
    检修类别: text(row, LEDGER_FIELDS.category),
    停电范围: text(row, LEDGER_FIELDS.scope),
    检修班组: text(row, LEDGER_FIELDS.crew),
    // 沿用既有检修口径：未核定前，排期单计划工期取台账口径。
    计划工期: text(row, LEDGER_FIELDS.duration),
    台账工期: text(row, LEDGER_FIELDS.duration),
    工期核定状态: '待班组核定',
    排期状态: status,
    ...(isDiff ? { 差异原因: reason } : {}),
    排期提交时间: nowText(),
  }
}

// 批量提交排期：同组合规的一次落单；类别/工期不同的进差异栏，不挡住整批；重复提交的跳过。
export function commitBatchSchedule(ids: number[]): BatchScheduleResult {
  const already = scheduledCodes()
  const picked = listRows(LEDGER_KEY).filter((row) =>
    ids.includes(Number(row.id)),
  )
  const duplicateRows = picked.filter((row) =>
    already.has(text(row, LEDGER_FIELDS.code)),
  )
  const messages: string[] = []
  if (duplicateRows.length > 0) {
    messages.push(
      `${duplicateRows.length} 台已在排期单中，未重复落单：${duplicateRows
        .map((row) => text(row, LEDGER_FIELDS.code))
        .join('、')}`,
    )
  }

  const groups = previewBatchSchedule(ids.filter((id) =>
    !duplicateRows.some((row) => Number(row.id) === id),
  ))
  const schedules = listRows(SCHEDULE_KEY)
  let scheduledCount = 0
  let diffCount = 0
  for (const group of groups) {
    for (const row of group.rows) {
      schedules.push(buildScheduleRow(row, false))
      scheduledCount += 1
    }
    for (const row of group.diffRows) {
      schedules.push(
        buildScheduleRow(row, true, group.diffReasons[Number(row.id)] ?? '检修类别或计划工期与同组不一致'),
      )
      diffCount += 1
    }
  }
  saveRows(SCHEDULE_KEY, schedules)
  if (scheduledCount > 0) {
    messages.push(`已按停电范围批量排期 ${scheduledCount} 台`)
  }
  if (diffCount > 0) {
    messages.push(`${diffCount} 台类别/工期与同组不一致，已挑入差异待处理栏，不影响整批`)
  }
  return { groups, scheduledCount, diffCount, duplicateCount: duplicateRows.length, messages }
}

function findSchedule(id: number): { row?: ScheduleRow; index: number; rows: EntryRow[] } {
  const rows = listRows(SCHEDULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return { row: index >= 0 ? (rows[index] as ScheduleRow) : undefined, index, rows }
}

// 差异栏中的单台可单独成单（不拖累同批），也可移出差异栏。
export function resolveDiffSchedule(id: number, accept: boolean): ActionResult {
  const { row, index, rows } = findSchedule(id)
  if (!row) {
    return { ok: false, message: '没有找到该差异排期记录' }
  }
  if (String(row.status) !== '差异待处理') {
    return { ok: false, message: '该排期单已不在差异栏，无需处理' }
  }
  if (!accept) {
    rows.splice(index, 1)
    saveRows(SCHEDULE_KEY, rows)
    return { ok: true, message: `已将 ${row.检修编号} 移出差异待处理栏` }
  }
  rows[index] = {
    ...row,
    status: '待开工',
    排期状态: '待开工',
    pending: true,
    差异原因: '',
  }
  saveRows(SCHEDULE_KEY, rows)
  return { ok: true, message: `${row.检修编号} 已单独成单，进入待开工排期` }
}

// 统一工期口径：调度批复优先，其次检修班组核定，最后沿用台账检修口径。
function effectiveDuration(row: ScheduleRow): string {
  return (
    row.调度批复工期?.trim() ||
    row.核定工期?.trim() ||
    row.台账工期?.trim() ||
    text(row, LEDGER_FIELDS.duration)
  )
}

function syncLedgerDuration(code: string, duration: string) {
  const ledger = listRows(LEDGER_KEY)
  const index = ledger.findIndex((row) => text(row, LEDGER_FIELDS.code) === code)
  if (index >= 0) {
    ledger[index] = { ...ledger[index], [LEDGER_FIELDS.duration]: duration }
    saveRows(LEDGER_KEY, ledger)
  }
}

// 检修班组核定工期后回填排期单；若调度已有批复，以调度批复为准。
export function verifyCrewDuration(id: number, duration: string): ActionResult {
  const value = duration.trim()
  if (!value) {
    return { ok: false, message: '请填写班组核定的计划工期' }
  }
  const { row, index, rows } = findSchedule(id)
  if (!row) {
    return { ok: false, message: '没有找到该排期单' }
  }
  if (String(row.status) === '差异待处理') {
    return { ok: false, message: '差异待处理栏的主变请先单独成单，再核定工期' }
  }
  const updated: ScheduleRow = {
    ...row,
    核定工期: value,
    工期核定状态: row.调度批复工期?.trim() ? '调度已批复' : '班组已核定',
  }
  updated.计划工期 = effectiveDuration(updated)
  rows[index] = updated
  saveRows(SCHEDULE_KEY, rows)
  syncLedgerDuration(updated.检修编号, updated.计划工期)
  if (row.调度批复工期?.trim() && row.调度批复工期.trim() !== value) {
    return { ok: true, message: `班组核定 ${value} 已登记；与调度批复冲突，按调度批复工期 ${updated.计划工期} 执行并回填台账` }
  }
  return { ok: true, message: `班组已核定工期 ${updated.计划工期}，并同步回填检修台账` }
}

// 调度批复工期：冲突时以批复为准，台账与排期单两处读到的计划工期就此对齐。
export function approveDispatchDuration(id: number, duration: string): ActionResult {
  const value = duration.trim()
  if (!value) {
    return { ok: false, message: '请填写调度批复的计划工期' }
  }
  const { row, index, rows } = findSchedule(id)
  if (!row) {
    return { ok: false, message: '没有找到该排期单' }
  }
  if (String(row.status) === '差异待处理') {
    return { ok: false, message: '差异待处理栏的主变请先单独成单，再走调度批复' }
  }
  const conflict =
    (row.核定工期?.trim() || row.台账工期?.trim()) &&
    (row.核定工期?.trim() || row.台账工期?.trim()) !== value
  const updated: ScheduleRow = {
    ...row,
    调度批复工期: value,
    工期核定状态: '调度已批复',
  }
  updated.计划工期 = effectiveDuration(updated)
  rows[index] = updated
  saveRows(SCHEDULE_KEY, rows)
  syncLedgerDuration(updated.检修编号, updated.计划工期)
  return {
    ok: true,
    message: conflict
      ? `调度批复工期 ${value} 与${row.核定工期?.trim() ? '班组核定' : '台账'}口径不一致，已按调度批复 ${updated.计划工期} 同步两处`
      : `调度已批复工期 ${updated.计划工期}，台账与排期单已对齐`,
  }
}

function canAdvance(from: string, to: string): boolean {
  if (!(from in NEXT_STATUS) || !(to in NEXT_STATUS)) {
    return false
  }
  return NEXT_STATUS[from].includes(to)
}

function syncLedgerStatus(code: string, status: string) {
  const ledger = listRows(LEDGER_KEY)
  const index = ledger.findIndex((row) => text(row, LEDGER_FIELDS.code) === code)
  if (index < 0) {
    return
  }
  const patch: EntryRow = {
    ...ledger[index],
    status,
    [LEDGER_FIELDS.ledgerStatus]: status,
    pending: status !== '已完工',
  }
  if (status === '已完工') {
    patch[LEDGER_FIELDS.finishDate] = todayText()
  }
  ledger[index] = patch
  saveRows(LEDGER_KEY, ledger)
}

function stationOf(row: ScheduleRow): string {
  const matched = text(row, LEDGER_FIELDS.scope).match(/^\d+kV.*?变/)
  if (matched) {
    return matched[0]
  }
  return row.主变名称.replace(/#\d+主变$/, '')
}

// 完工确认后，工作票许可那边的待办清单（待签发）自动多出一条；同一检修只补一条。
function ensureCompletionPermit(row: ScheduleRow): boolean {
  const permits = listRows(WORKPERMIT_KEY)
  const ticketNo = `WP-${row.检修编号}`
  if (permits.some((permit) => text(permit, '工作票号') === ticketNo)) {
    return false
  }
  const id = permits.reduce((max, permit) => Math.max(max, Number(permit.id)), 0) + 1
  permits.push({
    id,
    status: '待签发',
    pending: true,
    abnormal: false,
    工作票号: ticketNo,
    工作任务: `${row.主变名称}${row.检修类别}完工复役许可`,
    所属变电站: stationOf(row),
    停电范围: row.停电范围,
    工作负责人: row.检修班组,
    许可时间: '',
    终结时间: '',
    许可状态: '待签发',
  })
  saveRows(WORKPERMIT_KEY, permits)
  return true
}

// 排期单推进：校验越级、同步台账状态；完工时给工作票许可挂待办。
export function advanceSchedule(id: number, action: string): ActionResult {
  const meta = moduleMeta(SCHEDULE_KEY)
  const target = meta.actionTargets[action]
  if (!target || !FORMAL_ACTIONS.has(action)) {
    return { ok: false, message: `排期单没有登记「${action}」这个动作` }
  }
  const { row, index, rows } = findSchedule(id)
  if (!row) {
    return { ok: false, message: '没有找到该排期单' }
  }
  const from = String(row.排期状态 ?? row.status)
  if (from === '差异待处理') {
    return { ok: false, message: '差异待处理栏的主变不能直接推进，请先单独成单' }
  }
  if (!canAdvance(from, target)) {
    return { ok: false, message: `排期状态不能从「${from}」越级到「${target}」，已挡回` }
  }
  const updated: ScheduleRow = {
    ...row,
    status: target,
    排期状态: target,
    pending: target !== '已完工',
  }
  rows[index] = updated
  saveRows(SCHEDULE_KEY, rows)
  syncLedgerStatus(row.检修编号, target)
  let message = `${row.检修编号}已${action}，排期与台账状态同步为「${target}」`
  if (target === '已完工' && ensureCompletionPermit(updated)) {
    message += '；工作票许可待办已新增一条复役许可（待签发）'
  }
  return { ok: true, message }
}

// 台账侧的动作入口：必须先有排期单，推进统一走排期单口径（含越级校验与完工待办）。
export function advanceLedgerByCode(code: string, action: string): ActionResult {
  const schedule = formalSchedules().find((row) => row.检修编号 === code.trim())
  if (!schedule) {
    return { ok: false, message: `${code} 还没有排期单，请先勾选主变批量提交排期` }
  }
  return advanceSchedule(Number(schedule.id), action)
}
