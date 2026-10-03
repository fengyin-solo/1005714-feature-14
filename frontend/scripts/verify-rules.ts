// 业务规则端到端校验（开发脚本）：由 esbuild 打包后在 Node 中执行，用内存版 localStorage 驱动纯前端数据层。
class MemoryStore {
  map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}
;(globalThis as unknown as { window: { localStorage: MemoryStore } }).window = {
  localStorage: new MemoryStore(),
}

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

import * as store from '../src/data/local-store'
import * as service from '../src/api/local-service'
import * as schedule from '../src/api/schedule-service'

const F = schedule.F
const ledgerKey = 'transformermaint'
const sheetKey = 'schedulesheet'
const permitKey = 'workpermit'

// 1. 分组：待开工未排期按停电范围分组；类别/工期不同的进孤立簇（单独栏）。
console.log('\n[1] 批量分组与单独排期栏')
store.resetRows(ledgerKey)
store.resetRows(sheetKey)
store.resetRows(permitKey)
const groups = schedule.buildScheduleGroups(store.listRows(ledgerKey))
const dongjiao = groups.find((g) => g.scope === '全站停电')
check('东郊全站停电成一组', !!dongjiao)
const batchClusters = dongjiao!.clusters.filter((c) => !c.isolated)
const soloClusters = dongjiao!.clusters.filter((c) => c.isolated)
check('A类检修7天×2 台进整批簇', batchClusters.length === 1 && batchClusters[0].rows.length === 2,
  JSON.stringify(batchClusters.map((c) => [c.category, c.duration, c.rows.length])))
check('B类检修5天×1 台被挑到单独栏',
  soloClusters.length === 1 && soloClusters[0].rows[0][F.ledgerNo] === 'TRAN-0003')
const nanjiao = groups.find((g) => g.scope === '10kV母线停电')
check('工期待核定的南郊2号主变也进单独栏',
  nanjiao!.clusters.some((c) => c.isolated && c.missingDuration))

// 2. 整批提交：东郊两台 A 类 + 单独栏 3 号主变一起提交，各按范围成单。
console.log('\n[2] 一次提交排期')
let report = schedule.submitBatchSchedule([
  { id: 1, planStartDate: '2026-10-08' },
  { id: 2, planStartDate: '2026-10-08' },
  { id: 3, planStartDate: '2026-10-08' },
])
check('落明细 3 条', report.created === 3, report.message)
const sheetsAfter = store.listRows(sheetKey)
check('同范围两台共用一张单号',
  sheetsAfter.find((r) => r[F.ledgerNo] === 'TRAN-0001')![F.sheetNo]
  === sheetsAfter.find((r) => r[F.ledgerNo] === 'TRAN-0002')![F.sheetNo])
check('单独栏 3 号主变有独立单号',
  new Set(sheetsAfter.map((r) => String(r[F.sheetNo]))).size >= 3)
check('台账回写排期单号',
  String(store.listRows(ledgerKey).find((r) => Number(r.id) === 1)![F.sheetNo]).startsWith('PS-'))

// 3. 重复提交：同一台主变再提交只落一条。
console.log('\n[3] 重复提交幂等')
const beforeCount = store.listRows(sheetKey).length
report = schedule.submitBatchSchedule([
  { id: 1, planStartDate: '2026-10-08' },
  { id: 2, planStartDate: '2026-10-08' },
])
check('重复提交 0 新增', report.created === 0 && store.listRows(sheetKey).length === beforeCount)
check('两台都记为重复跳过', report.duplicated.length === 2, JSON.stringify(report.duplicated))

// 4. 越级挡回：待开工不能直接确认完工/申请延期。
console.log('\n[4] 状态线性推进，越级挡回')
let r1 = service.runAction(ledgerKey, 1, '确认完工')
check('待开工直接确认完工被挡回', !r1.ok && r1.message.includes('越级'))
let r2 = service.runAction(ledgerKey, 1, '申请延期')
check('待开工直接申请延期被挡回', !r2.ok && r2.message.includes('越级'))
r1 = service.runAction(ledgerKey, 1, '提交开工')
check('待开工提交开工成功', r1.ok)
const s1Id = Number(store.listRows(sheetKey).find((r) => r[F.ledgerNo] === 'TRAN-0001')!.id)
r2 = service.runAction(sheetKey, s1Id, '提交开工')
check('已开工的明细重复提交开工被挡', !r2.ok)
r2 = service.runAction(ledgerKey, 1, '确认完工')
check('检修中确认完工成功', r2.ok)
r1 = service.runAction(ledgerKey, 1, '申请延期')
check('已完工再申请延期被挡回', !r1.ok && r1.message.includes('越级'))

// 5. 状态双向同步。
console.log('\n[5] 台账与排期单状态同步')
const s1 = store.listRows(sheetKey).find((r) => r[F.ledgerNo] === 'TRAN-0001')!
check('TRAN-0001 排期明细同步为已完工', String(s1.status) === '已完工', String(s1.status))
check('TRAN-0001 台账完成日期回填',
  !!store.listRows(ledgerKey).find((r) => Number(r.id) === 1)![F.finishDate])
const id2 = Number(store.listRows(sheetKey).find((r) => r[F.ledgerNo] === 'TRAN-0002')!.id)
check('排期单 TRAN-0002 开工', service.runAction(sheetKey, id2, '提交开工').ok)
check('排期单 TRAN-0002 完工', service.runAction(sheetKey, id2, '确认完工').ok)
check('台账 TRAN-0002 同步为已完工',
  String(store.listRows(ledgerKey).find((r) => Number(r.id) === 2)!.status) === '已完工')

// 6. 完工联动工作票待办。
console.log('\n[6] 完工确认联动工作票待办')
const permitsFor = (no: string) =>
  store.listRows(permitKey).filter((p) => String(p['来源检修编号'] ?? '') === no)
check('TRAN-0001 生成一条待签发工作票',
  permitsFor('TRAN-0001').length === 1 && permitsFor('TRAN-0001')[0].status === '待签发')
check('TRAN-0002 生成一条待签发工作票', permitsFor('TRAN-0002').length === 1)
const createdAgain = schedule.ensureCompletionPermit(
  store.listRows(ledgerKey).find((r) => r[F.ledgerNo] === 'TRAN-0001')!)
check('重复触发不产生第二条', !createdAgain && permitsFor('TRAN-0001').length === 1)
check('播种的 TRAN-0009 待办存在', permitsFor('TRAN-0009').length === 1)

// 7. 工期回填与口径一致。
console.log('\n[7] 班组核定回填 & 调度批复优先')
const ps02 = 'PS-20261003-02' // 西郊：TRAN-0005 批复 8天
let bf = schedule.backfillDuration(ps02, '9天')
check('班组回填成功', bf.ok)
check('回填后两处计划工期均为9天',
  store.listRows(sheetKey).filter((r) => r[F.sheetNo] === ps02).every((r) => r[F.duration] === '9天')
  && store.listRows(ledgerKey).filter((r) => ['TRAN-0004', 'TRAN-0005'].includes(String(r[F.ledgerNo])))
    .every((r) => r[F.duration] === '9天'))
check('组内含批复8天与班组9天 -> 冲突标记', bf.conflict === true, bf.message)
check('冲突时有效工期以调度批复8天为准', bf.effectiveDuration === '8天')
check('台账侧 effectiveDuration 读到批复值',
  schedule.effectiveDuration(store.listRows(ledgerKey).find((r) => r[F.ledgerNo] === 'TRAN-0005')!) === '8天')
check('排期单侧 effectiveDuration 同样读到批复值',
  schedule.effectiveDuration(store.listRows(sheetKey).find((r) => r[F.ledgerNo] === 'TRAN-0005')!) === '8天')
bf = schedule.backfillDuration(ps02, '9天', '7天')
check('批复更新后有效工期为7天', bf.effectiveDuration === '7天')

// 8. 非待开工不允许排期。
console.log('\n[8] 非待开工/已排期不重复排期')
report = schedule.submitBatchSchedule([{ id: 8, planStartDate: '2026-10-08' }]) // TRAN-0008 检修中且已排
check('检修中且已排期被跳过', report.created === 0
  && report.notReady.length + report.duplicated.length >= 1)

// 9. 排期单分组与混态。
console.log('\n[9] 排期单分组与混态识别')
const sheetGroups = schedule.listSheetGroups()
const g01 = sheetGroups.find((g) => g.no === 'PS-20261003-01')
check('北郊组状态混合（检修中+已完工）被识别', !!g01 && g01.mixed, JSON.stringify(g01?.statusCounts))
const g02 = sheetGroups.find((g) => g.no === ps02)
check('西郊组整组待开工', !!g02 && !g02.mixed && g02.status === '待开工')

console.log(failures === 0 ? '\n全部规则校验通过 ✅' : `\n${failures} 条校验失败 ❌`)
if (failures > 0) {
  process.exit(1)
}
