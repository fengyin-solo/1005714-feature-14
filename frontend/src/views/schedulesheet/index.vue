<template>
  <section class="page" data-module="schedulesheet">
    <header class="page-head">
      <div>
        <h2>主变检修排期单</h2>
        <p class="page-desc">按停电范围分组的批量排期。工期由检修班组核定后回填，与调度批复冲突时以批复为准；状态按 待开工 → 检修中 → 已完工 / 已延期 推进，越级挡回。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出排期单清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    <p v-if="okMessage" class="ok-text">{{ okMessage }}</p>

    <div v-if="!groups.length" class="empty-state" style="background: #fff; padding: 24px; border: 1px solid var(--border)">
      还没有排期单，请先到
      <RouterLink class="link" to="/transformermaint">主变检修</RouterLink>
      勾选多台主变批量提交排期。
    </div>

    <article v-for="group in groups" :key="group.no" class="sheet-card">
      <header class="sheet-head">
        <div>
          <strong class="sheet-no">{{ group.no }}</strong>
          <span class="scope-chip">{{ group.scope }}</span>
          <span class="muted-check">{{ group.station }}</span>
          <span class="muted-check">· 计划开工 {{ group.planStartDate || '—' }}</span>
          <span v-if="group.mixed" class="tag tag-solo">状态不一致（{{ statusText(group) }}）</span>
        </div>
        <div class="sheet-actions">
          <span :class="['status-tag', group.mixed ? '' : `st-${group.status}`]">
            {{ group.mixed ? '混态' : group.status }}
          </span>
          <button
            v-for="action in groupActions(group)"
            :key="action"
            class="btn"
            type="button"
            :disabled="group.mixed"
            :title="group.mixed ? '组内状态不一致，只能逐台推进' : `整组${action}`"
            @click="advanceGroup(group, action)"
          >
            整组{{ action }}
          </button>
        </div>
      </header>

      <div class="duration-bar">
        <span class="duration-label">计划工期：</span>
        <strong>{{ group.effectiveDuration }}</strong>
        <span v-if="group.durationMissing" class="tag tag-solo">待检修班组核定</span>
        <span v-if="group.conflict" class="tag tag-approved">与调度批复不一致 · 已按批复执行</span>
        <span class="duration-form">
          <input v-model="backfill[group.no].team" placeholder="班组核定工期，如 5天" />
          <input v-model="backfill[group.no].approved" placeholder="调度批复工期（有则填）" />
          <button class="btn primary" type="button" @click="submitBackfill(group.no)">核定回填</button>
        </span>
      </div>

      <table class="data-table inner-table">
        <thead>
          <tr>
            <th v-for="column in detailColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="String(row.id)">
            <td v-for="column in detailColumns" :key="column">
              <template v-if="column === '计划工期'">
                {{ effectiveDuration(row) }}
                <span v-if="String(row['调度批复工期'] ?? '')" class="tag tag-approved">批复</span>
              </template>
              <template v-else>{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</template>
            </td>
            <td>
              <span :class="['status-tag', `st-${String(row.status)}`]">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in detailActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="advanceDetail(row, action)"
              >
                {{ action }}
              </button>
              <span v-if="!detailActions(row).length" class="muted-check">终态</span>
            </td>
          </tr>
        </tbody>
      </table>
    </article>

    <footer class="page-foot">
      <span>共 {{ groups.length }} 张排期单 · 台账与排期单的计划工期同口径读取，冲突时以调度批复工期为准</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  backfillDuration,
  effectiveDuration,
  listSheetGroups,
  type SheetGroup,
} from '@/api/schedule-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('schedulesheet')
const detailColumns = ['检修编号', '主变名称', '检修类别', '检修班组', '计划开工日期', '计划工期', '调度批复工期']

const groups = ref<SheetGroup[]>([])
const errorMessage = ref('')
const okMessage = ref('')
const backfill = reactive<Record<string, { team: string; approved: string }>>({})
const stats = ref([
  { label: '待开工排期组', value: 0 },
  { label: '检修中排期组', value: 0 },
  { label: '待回填工期明细', value: 0 },
])

function statusText(group: SheetGroup): string {
  return Object.entries(group.statusCounts)
    .map(([status, count]) => `${status}×${count}`)
    .join('，')
}

function groupActions(group: SheetGroup): string[] {
  if (group.mixed) {
    return ['提交开工', '确认完工', '申请延期']
  }
  if (group.status === '待开工') {
    return ['提交开工']
  }
  if (group.status === '检修中') {
    return ['确认完工', '申请延期']
  }
  return []
}

function detailActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待开工') {
    return ['提交开工']
  }
  if (status === '检修中') {
    return ['确认完工', '申请延期']
  }
  return []
}

function advanceGroup(group: SheetGroup, action: string): void {
  errorMessage.value = ''
  okMessage.value = ''
  let blocked = 0
  let completed = 0
  for (const row of group.rows) {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      blocked += 1
      errorMessage.value = result.message
    } else if (action === '确认完工') {
      completed += 1
    }
  }
  if (blocked && !completed) {
    // 全部被越级规则挡回，保留错误提示。
  } else if (action === '确认完工') {
    okMessage.value = `排期单 ${group.no} 已整组完工，工作票许可待办清单对应新增 ${completed} 条待签发工作票`
  } else {
    okMessage.value = `排期单 ${group.no} 已整组${action}`
  }
  reload()
}

function advanceDetail(row: EntryRow, action: string): void {
  errorMessage.value = ''
  okMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value =
    action === '确认完工'
      ? `${String(row['主变名称'])}已完工，工作票许可待办清单已新增一条待签发工作票`
      : result.message
  reload()
}

function submitBackfill(no: string): void {
  errorMessage.value = ''
  okMessage.value = ''
  const form = backfill[no]
  if (!form.team.trim() && !form.approved.trim()) {
    errorMessage.value = '请先填写班组核定工期或调度批复工期'
    return
  }
  const result = backfillDuration(no, form.team, form.approved)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  form.team = ''
  form.approved = ''
  reload()
}

function exportRows(): void {
  downloadEntries(meta.key)
}

function reload(): void {
  groups.value = listSheetGroups()
  for (const group of groups.value) {
    if (!backfill[group.no]) {
      backfill[group.no] = { team: '', approved: '' }
    }
  }
  stats.value = [
    { label: '待开工排期组', value: groups.value.filter((group) => !group.mixed && group.status === '待开工').length },
    { label: '检修中排期组', value: groups.value.filter((group) => !group.mixed && group.status === '检修中').length },
    { label: '待回填工期明细', value: groups.value.reduce((sum, group) => sum + (group.durationMissing ? group.rows.length : 0), 0) },
  ]
}

onMounted(reload)
</script>
