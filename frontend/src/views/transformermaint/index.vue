<template>
  <section class="page" data-module="transformermaint">
    <header class="page-head">
      <div>
        <h2>主变检修管理</h2>
        <p class="page-desc">勾选同一段停电范围内的多台主变一次提交排期；检修类别或计划工期不同的主变自动挑到「单独排期」栏，不挡整批。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!selectedIds.size" @click="openBatch">
          批量排期{{ selectedIds.size ? `（已选 ${selectedIds.size} 台）` : '' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出主变检修清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <label class="filter-item" style="margin-left: auto">
        <span>批量勾选</span>
        <span class="bulk-pick">
          <button class="link" type="button" @click="selectAllSchedulable">全选待开工未排期</button>
          <button class="link" type="button" @click="selectedIds.clear()">清空</button>
        </span>
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">勾选</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="col-check">
            <input
              v-if="isSchedulable(row)"
              type="checkbox"
              :checked="selectedIds.has(Number(row.id))"
              @change="toggleRow(Number(row.id))"
            />
            <span v-else class="muted-check" title="仅待开工且未排期的主变可批量排期">—</span>
          </td>
          <td v-for="column in columns" :key="column">
            <template v-if="column === '计划工期'">
              <span :title="durationTitle(row)">{{ effectiveDurationText(row) }}</span>
              <span v-if="String(row['调度批复工期'] ?? '')" class="tag tag-approved" title="以调度批复工期为准">批复</span>
            </template>
            <template v-else-if="column === '排期单号'">
              <RouterLink v-if="String(row[column] ?? '')" class="link" to="/schedulesheet">
                {{ row[column] }}
              </RouterLink>
              <span v-else>—</span>
            </template>
            <template v-else>{{ row[column] === '' || row[column] == null ? '—' : row[column] }}</template>
          </td>
          <td>
            <span :class="['status-tag', `st-${String(row.status)}`]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted-check">无可推进动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无主变检修数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条主变检修记录 · 计划工期沿用既有检修口径，冲突时以调度批复为准</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="batchOpen" class="modal-mask" @click.self="batchOpen = false">
      <section class="modal">
        <header class="modal-head">
          <h3>批量排期 · 按停电范围分组</h3>
          <button class="btn ghost" type="button" @click="batchOpen = false">关闭</button>
        </header>
        <p class="page-desc">
          同一停电范围共用一张排期单；检修类别或计划工期与本组不同的主变已挑到下方「单独排期」栏，不会挡住整批提交。
        </p>

        <div v-if="!batchGroups.length" class="empty-state" style="padding: 20px">
          勾选的主变都已排过期或不在待开工状态，没有可提交的排期。
        </div>

        <div v-for="group in batchGroups" :key="group.scope" class="scope-block">
          <div class="scope-title">
            <strong>{{ group.scope }}</strong>
            <span class="muted-check">（{{ group.station }}）</span>
          </div>

          <div v-for="cluster in group.batchClusters" :key="cluster.key" class="cluster-row">
            <label class="cluster-head">
              <input
                type="checkbox"
                :checked="isClusterChecked(group, cluster)"
                @change="toggleCluster(group, cluster)"
              />
              <span class="tag tag-batch">整批</span>
              <span>{{ cluster.category }} · 工期 {{ cluster.duration }} · {{ cluster.rows.length }} 台</span>
            </label>
            <label class="date-field">
              计划开工
              <input type="date" v-model="dateByScope[group.scope]" />
            </label>
            <div class="cluster-members">
              <span v-for="row in cluster.rows" :key="String(row.id)" class="member-chip">
                {{ row['主变名称'] }}
              </span>
            </div>
          </div>

          <div v-if="group.isolatedClusters.length" class="solo-block">
            <div class="solo-title">单独排期（类别/工期不同，不并入整批）</div>
            <div v-for="cluster in group.isolatedClusters" :key="cluster.key" class="cluster-row solo-row">
              <label class="cluster-head">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(Number(cluster.rows[0].id))"
                  @change="toggleRow(Number(cluster.rows[0].id))"
                />
                <span class="tag tag-solo">单独</span>
                <span>{{ cluster.rows[0]['主变名称'] }} · {{ cluster.category }} · 工期 {{ cluster.duration }}</span>
              </label>
              <label class="date-field">
                计划开工
                <input type="date" :value="soloDate(cluster.rows[0].id)" @input="setSoloDate(Number(cluster.rows[0].id), ($event.target as HTMLInputElement).value)" />
              </label>
            </div>
          </div>
        </div>

        <footer class="modal-foot">
          <span v-if="submitMessage" :class="submitOk ? 'ok-text' : 'error-text'">{{ submitMessage }}</span>
          <span class="modal-foot-spacer"></span>
          <button class="btn" type="button" @click="batchOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitBatch">
            一次提交排期（{{ submitCount }} 台）
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  buildScheduleGroups,
  effectiveDuration,
  schedulableRows,
  submitBatchSchedule,
  today,
  type ScheduleCluster,
  type ScheduleGroup,
} from '@/api/schedule-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('transformermaint')
const columns = ["检修编号", "主变名称", "所属变电站", "检修类别", "停电范围", "检修班组", "计划工期", "调度批复工期", "排期单号", "完成日期", "检修状态"]
const actions = ["提交开工", "确认完工", "申请延期"]
const statuses = ["待开工", "检修中", "已完工", "已延期"]
const stats = ref([{ label: "待开工检修", value: 0 }, { label: "检修中主变", value: 0 }, { label: "本月完工数", value: 0 }])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["检修编号", "主变名称", "停电范围"]

// 批量排期勾选与弹层状态。
const selectedIds = ref<Set<number>>(new Set())
const batchOpen = ref(false)
const submitting = ref(false)
const submitMessage = ref('')
const submitOk = ref(false)
const dateByScope = reactive<Record<string, string>>({})
const soloDates = reactive<Record<number, string>>({})

type PanelGroup = ScheduleGroup & { batchClusters: ScheduleCluster[]; isolatedClusters: ScheduleCluster[] }

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function effectiveDurationText(row: EntryRow): string {
  return effectiveDuration(row)
}

function durationTitle(row: EntryRow): string {
  const approved = String(row['调度批复工期'] ?? '')
  const planned = String(row['计划工期'] ?? '')
  if (approved) {
    return `班组核定 ${planned || '未填'}，调度批复 ${approved}，以批复为准`
  }
  return planned ? `班组核定工期：${planned}` : '班组尚未核定回填'
}

function isSchedulable(row: EntryRow): boolean {
  return schedulableRows(rows.value).some((entry) => Number(entry.id) === Number(row.id))
}

function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待开工') {
    return ['提交开工']
  }
  if (status === '检修中') {
    return ['确认完工', '申请延期']
  }
  return []
}

function toggleRow(id: number): void {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectedIds.value = new Set(selectedIds.value)
}

function selectAllSchedulable(): void {
  selectedIds.value = new Set(schedulableRows(rows.value).map((row) => Number(row.id)))
}

const batchGroups = computed<PanelGroup[]>(() => {
  const selected = new Set(selectedIds.value)
  return buildScheduleGroups(rows.value)
    .map((group) => {
      const pickedClusters = group.clusters.filter((cluster) =>
        cluster.rows.some((row) => selected.has(Number(row.id))),
      )
      return {
        ...group,
        clusters: pickedClusters,
        batchClusters: pickedClusters.filter((cluster) => !cluster.isolated),
        isolatedClusters: pickedClusters.filter((cluster) => cluster.isolated),
      }
    })
    .filter((group) => group.clusters.length > 0)
})

function isClusterChecked(group: PanelGroup, cluster: ScheduleCluster): boolean {
  return cluster.rows.every((row) => selectedIds.value.has(Number(row.id)))
}

function toggleCluster(group: PanelGroup, cluster: ScheduleCluster): void {
  const checked = isClusterChecked(group, cluster)
  for (const row of cluster.rows) {
    if (checked) {
      selectedIds.value.delete(Number(row.id))
    } else {
      selectedIds.value.add(Number(row.id))
    }
  }
  selectedIds.value = new Set(selectedIds.value)
}

function soloDate(id: number | string): string {
  return soloDates[Number(id)] ?? today()
}

function setSoloDate(id: number, value: string): void {
  soloDates[id] = value
}

const submitCount = computed(() => {
  let count = 0
  for (const group of batchGroups.value) {
    for (const cluster of group.clusters) {
      count += cluster.rows.length
    }
  }
  return count
})

function openBatch(): void {
  submitMessage.value = ''
  for (const group of buildScheduleGroups(rows.value)) {
    if (!dateByScope[group.scope]) {
      dateByScope[group.scope] = today()
    }
  }
  batchOpen.value = true
}

function submitBatch(): void {
  if (!submitCount.value) {
    return
  }
  submitting.value = true
  try {
    const items = []
    for (const group of batchGroups.value) {
      for (const cluster of group.clusters) {
        for (const row of cluster.rows) {
          const id = Number(row.id)
          items.push({
            id,
            planStartDate: cluster.isolated ? soloDate(id) : dateByScope[group.scope] || today(),
          })
        }
      }
    }
    const report = submitBatchSchedule(items)
    submitOk.value = report.ok
    submitMessage.value = report.message
    reload()
    if (report.ok) {
      selectedIds.value = new Set()
      setTimeout(() => {
        batchOpen.value = false
      }, 800)
    }
  } catch (error) {
    submitOk.value = false
    submitMessage.value = error instanceof Error ? error.message : '批量排期提交失败'
  } finally {
    submitting.value = false
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.ok && action === '确认完工'
    ? '已完工，工作票许可待办清单已新增一条待签发工作票'
    : ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: "待开工检修", value: payload.items.filter((row) => String(row.status) === '待开工').length },
      { label: "检修中主变", value: payload.items.filter((row) => String(row.status) === '检修中').length },
      { label: "本月完工数", value: payload.items.filter((row) => String(row.status) === '已完工').length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '主变检修列表读取失败'
  }
}

onMounted(reload)
</script>
