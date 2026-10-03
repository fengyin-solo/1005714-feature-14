<template>
  <section class="page" data-module="transformermaint">
    <header class="page-head">
      <div>
        <h2>主变检修管理</h2>
        <p class="page-desc">同段停电范围的多台主变勾选后一次批量排期；类别或工期不合群的自动挑入差异栏，不挡住整批。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出检修台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <em v-if="tab.badge" class="tab-badge">{{ tab.badge }}</em>
      </button>
    </div>

    <form v-if="activeTab === 'ledger'" class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <span class="batch-tip">
        已勾 {{ selectedIds.length }} 台（可跨页按停电范围一起排），重复提交的不会重复落单
      </span>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="openBatch">
        批量排期
      </button>
    </form>

    <table v-if="activeTab === 'ledger'" class="data-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate.prop="someVisibleSelected"
              :disabled="!selectableRows.length"
              @change="toggleSelectAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>排期情况</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="col-check">
            <input
              type="checkbox"
              :checked="selectedIds.includes(Number(row.id))"
              :disabled="!canSelect(row)"
              @change="toggleOne(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="isScheduled(row)" class="tag tag-on">已排期</span>
            <span v-else class="tag tag-off">未排期</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runLedgerAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无主变检修数据</td>
        </tr>
      </tbody>
    </table>

    <footer v-if="activeTab === 'ledger'" class="page-foot">
      <span>共 {{ total }} 条主变检修记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <template v-if="activeTab === 'schedule'">
      <section v-for="group in scheduleGroups" :key="group.scope" class="scope-block">
        <h3 class="scope-title">停电范围：{{ group.scope }}（{{ group.rows.length }} 台）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>检修编号</th>
              <th>主变名称</th>
              <th>检修类别</th>
              <th>检修班组</th>
              <th>台账工期</th>
              <th>核定/批复</th>
              <th>计划工期（执行口径）</th>
              <th>工期核定</th>
              <th>排期状态</th>
              <th>推进 / 工期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="String(row.id)">
              <td>{{ row.检修编号 }}</td>
              <td>{{ row.主变名称 }}</td>
              <td>{{ row.检修类别 }}</td>
              <td>{{ row.检修班组 }}</td>
              <td>{{ row.台账工期 || row.计划工期 }}</td>
              <td>
                <span v-if="row.核定工期">班组 {{ row.核定工期 }}<br /></span>
                <span v-if="row.调度批复工期">调度 {{ row.调度批复工期 }}</span>
                <span v-if="!row.核定工期 && !row.调度批复工期">—</span>
              </td>
              <td><strong>{{ row.计划工期 }}</strong></td>
              <td>{{ row.工期核定状态 }}</td>
              <td>{{ row.排期状态 ?? row.status }}</td>
              <td class="row-actions wrap">
                <button class="link" type="button" @click="advance(row, '提交开工')">提交开工</button>
                <button class="link" type="button" @click="advance(row, '申请延期')">申请延期</button>
                <button class="link" type="button" @click="advance(row, '确认完工')">确认完工</button>
                <button class="link" type="button" @click="fillCrew(row)">班组核定回填</button>
                <button class="link" type="button" @click="approveDispatch(row)">调度批复</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <p v-if="!scheduleGroups.length" class="empty-state block-empty">暂无排期单，回检修台账勾选主变批量排期</p>
      <footer class="page-foot">
        <span>计划工期口径：调度批复 &gt; 班组核定 &gt; 台账口径；两处读到的工期始终一致</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-if="activeTab === 'diff'">
      <p class="diff-hint">
        以下主变在批量提交时检修类别或计划工期与同停电范围的多数不一致，已单独挑出，不影响整批排期。
        可单独成单推进，也可移出差异栏回到台账重新安排。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>主变名称</th>
            <th>检修类别</th>
            <th>停电范围</th>
            <th>计划工期</th>
            <th>差异原因</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in diffRows" :key="String(row.id)">
            <td>{{ row.检修编号 }}</td>
            <td>{{ row.主变名称 }}</td>
            <td>{{ row.检修类别 }}</td>
            <td>{{ row.停电范围 }}</td>
            <td>{{ row.计划工期 }}</td>
            <td class="diff-reason">{{ row.差异原因 }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="resolveDiff(row, true)">单独成单</button>
              <button class="link danger" type="button" @click="resolveDiff(row, false)">移出差异栏</button>
            </td>
          </tr>
          <tr v-if="!diffRows.length">
            <td colspan="7" class="empty-state">差异栏为空，批量排期的主变类别与工期都一致</td>
          </tr>
        </tbody>
      </table>
    </template>

    <div v-if="batchOpen" class="modal-mask" @click.self="batchOpen = false">
      <div class="modal">
        <header class="modal-head">
          <h3>批量排期预览（按停电范围分组）</h3>
          <button class="link" type="button" @click="batchOpen = false">关闭</button>
        </header>
        <div class="modal-body">
          <section v-for="group in previewGroups" :key="group.scope" class="preview-group">
            <h4>
              停电范围：{{ group.scope }}
              <em class="preview-meta">
                统一检修类别「{{ group.category }}」· 统一计划工期「{{ group.duration }}」
              </em>
            </h4>
            <table class="data-table">
              <thead>
                <tr><th>检修编号</th><th>主变名称</th><th>检修类别</th><th>计划工期</th><th>归属</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in group.rows" :key="`ok-${String(row.id)}`">
                  <td>{{ row['检修编号'] }}</td>
                  <td>{{ row['主变名称'] }}</td>
                  <td>{{ row['检修类别'] }}</td>
                  <td>{{ row['计划工期'] }}</td>
                  <td><span class="tag tag-on">随批排期</span></td>
                </tr>
                <tr v-for="row in group.diffRows" :key="`diff-${String(row.id)}`" class="diff-tr">
                  <td>{{ row['检修编号'] }}</td>
                  <td>{{ row['主变名称'] }}</td>
                  <td>{{ row['检修类别'] }}</td>
                  <td>{{ row['计划工期'] }}</td>
                  <td>
                    <span class="tag tag-warn">差异单栏</span>
                    <p class="cell-note">{{ group.diffReasons[Number(row.id)] }}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <p v-if="!previewGroups.length" class="empty-state">所选主变均已有排期单，无需重复提交</p>
        </div>
        <footer class="modal-foot">
          <span class="foot-note">工期先沿用台账口径，提交后由检修班组核定、调度批复回填。</span>
          <span>
            <button class="btn" type="button" @click="batchOpen = false">取消</button>
            <button class="btn primary" type="button" @click="confirmBatch">确认批量提交</button>
          </span>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import {
  advanceLedgerByCode,
  advanceSchedule,
  approveDispatchDuration,
  commitBatchSchedule,
  listDiffSchedules,
  previewBatchSchedule,
  resolveDiffSchedule,
  scheduleGroups as loadScheduleGroups,
  scheduledCodes,
  verifyCrewDuration,
} from '@/api/schedule'
import type { EntryRow, ScheduleGroup, ScheduleRow } from '@/data/types'

const MODULE_KEY = 'transformermaint'
const columns = ['检修编号', '主变名称', '检修类别', '停电范围', '检修班组', '计划工期', '完成日期', '检修状态']
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = ['待开工', '检修中', '已完工', '已延期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const activeTab = ref<'ledger' | 'schedule' | 'diff'>('ledger')
const selectedIds = ref<number[]>([])
const scheduled = ref<Set<string>>(new Set())
const groups = ref<{ scope: string; rows: ScheduleRow[] }[]>([])
const diffRows = ref<ScheduleRow[]>([])

const batchOpen = ref(false)
const previewGroups = ref<ScheduleGroup[]>([])

const stats = computed(() => [
  { label: '待开工主变', value: countStatus('待开工') },
  { label: '检修中主变', value: countStatus('检修中') },
  { label: '已完工主变', value: countStatus('已完工') },
  { label: '差异待处理', value: diffRows.value.length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: countStatus(status) })),
)

const tabs = computed(() => [
  { key: 'ledger' as const, label: '检修台账', badge: 0 },
  { key: 'schedule' as const, label: '排期单（按停电范围）', badge: 0 },
  { key: 'diff' as const, label: '差异待处理栏', badge: diffRows.value.length },
])

const selectableRows = computed(() => rows.value.filter((row) => canSelect(row)))
const allVisibleSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)
const someVisibleSelected = computed(
  () => !allVisibleSelected.value && selectableRows.value.some((row) => selectedIds.value.includes(Number(row.id))),
)

const scheduleGroups = computed(() => groups.value)

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function isScheduled(row: EntryRow): boolean {
  return scheduled.value.has(String(row['检修编号'] ?? '').trim())
}

// 已完工的不再参与新排期；已有正式排期单的不可重复勾选。
function canSelect(row: EntryRow): boolean {
  return String(row.status) !== '已完工' && !isScheduled(row)
}

function toggleOne(id: number) {
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const ids = selectableRows.value.map((row) => Number(row.id))
  if (checked) {
    const merged = new Set([...selectedIds.value, ...ids])
    selectedIds.value = [...merged]
  } else {
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  }
}

function openBatch() {
  errorMessage.value = ''
  previewGroups.value = previewBatchSchedule(selectedIds.value)
  batchOpen.value = true
}

function confirmBatch() {
  const result = commitBatchSchedule(selectedIds.value)
  selectedIds.value = []
  batchOpen.value = false
  reload()
  window.alert(result.messages.join('；'))
}

function askDuration(title: string, fallback = ''): string | null {
  const input = window.prompt(title, fallback)
  return input === null ? null : input.trim()
}

function fillCrew(row: ScheduleRow) {
  const duration = askDuration(`填写 ${row.检修编号} 经检修班组核定的计划工期`, row.核定工期 || row.计划工期)
  if (duration === null) {
    return
  }
  const result = verifyCrewDuration(Number(row.id), duration)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  if (result.ok) {
    window.alert(result.message)
  }
}

function approveDispatch(row: ScheduleRow) {
  const duration = askDuration(`填写 ${row.检修编号} 的调度批复工期（冲突时以批复为准）`, row.调度批复工期 || row.计划工期)
  if (duration === null) {
    return
  }
  const result = approveDispatchDuration(Number(row.id), duration)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  window.alert(result.message)
}

function advance(row: ScheduleRow, action: string) {
  const result = advanceSchedule(Number(row.id), action)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  if (result.ok) {
    window.alert(result.message)
  }
}

function resolveDiff(row: ScheduleRow, accept: boolean) {
  const result = resolveDiffSchedule(Number(row.id), accept)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  if (result.ok) {
    window.alert(result.message)
  }
}

function runLedgerAction(action: string, row: EntryRow) {
  const result = advanceLedgerByCode(String(row['检修编号'] ?? ''), action)
  errorMessage.value = result.ok ? '' : result.message
  reload()
  if (result.ok) {
    window.alert(result.message)
  }
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(MODULE_KEY, filters.value)
    rows.value = payload.items
    total.value = payload.total
    scheduled.value = scheduledCodes()
    // 跨筛选条件勾选：以全量台账为准清理已排期/已完工的勾选项，不被当前筛选清掉。
    const allLedger = listRows(MODULE_KEY)
    selectedIds.value = selectedIds.value.filter((id) => {
      const row = allLedger.find((item) => Number(item.id) === id)
      return row ? canSelect(row) : false
    })
    groups.value = loadScheduleGroups()
    diffRows.value = listDiffSchedules()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '主变检修数据读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-btn { position: relative; border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 8px 14px; cursor: pointer; font-size: 13px; }
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tab-badge { font-style: normal; margin-left: 6px; background: #b42318; color: #fff; border-radius: 999px; padding: 0 7px; font-size: 11px; }
.tab-btn.active .tab-badge { background: #fff; color: #b42318; }
.col-check { width: 38px; text-align: center; }
.batch-tip { font-size: 12px; color: var(--muted); margin-left: auto; align-self: center; }
.tag { display: inline-block; border-radius: 4px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.tag-on { background: #e7f0ff; color: #1f6feb; }
.tag-off { background: #f1f5f9; color: #94a3b8; }
.tag-warn { background: #fef3c7; color: #b45309; }
.scope-block { margin-bottom: 18px; }
.scope-title { font-size: 14px; margin: 0 0 6px; }
.block-empty { padding: 20px; background: #fff; border: 1px dashed var(--border); }
.row-actions.wrap { flex-wrap: wrap; gap: 4px 10px; max-width: 230px; }
.link.danger { color: #b42318; }
.diff-hint { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; border-radius: 6px; padding: 8px 12px; font-size: 13px; margin: 0 0 12px; }
.diff-reason { color: #b45309; font-size: 12px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { width: min(860px, 92vw); max-height: 86vh; background: #fff; border-radius: 10px; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-body { padding: 14px 18px; overflow: auto; }
.preview-group { margin-bottom: 16px; }
.preview-group h4 { margin: 0 0 6px; font-size: 13px; }
.preview-meta { font-style: normal; font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 8px; }
.diff-tr { background: #fffbeb; }
.cell-note { margin: 2px 0 0; color: #b45309; font-size: 12px; }
.batch-notes { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: #334155; }
.modal-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--border); }
.foot-note { font-size: 12px; color: var(--muted); }
</style>
