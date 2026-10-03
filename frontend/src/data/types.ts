/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 主变检修排期单：排期单是台账之外单独落的一类记录，按停电范围分组推进。
export type ScheduleRow = EntryRow & {
  检修编号: string
  主变名称: string
  检修类别: string
  停电范围: string
  检修班组: string
  计划工期: string
  台账工期?: string
  核定工期?: string
  调度批复工期?: string
  工期核定状态: string
  排期状态: string
  差异原因?: string
  排期提交时间: string
}

// 批量提交时按停电范围聚合的预览/结果结构；类别或工期不合群的那几台单独挑出。
export type ScheduleGroup = {
  scope: string
  category: string
  duration: string
  rows: EntryRow[]
  diffRows: EntryRow[]
  diffReasons: Record<number, string>
}

export type BatchScheduleResult = {
  groups: ScheduleGroup[]
  scheduledCount: number
  diffCount: number
  duplicateCount: number
  messages: string[]
}
