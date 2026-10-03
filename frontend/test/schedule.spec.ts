import * as s from '@/api/schedule'
import { listRows } from '@/data/local-store'

const fail: string[] = []
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) fail.push(name)
}

// 1. 云岭全站三台：#1/#2 A级7天同组，#3 B级3天 → 差异栏；青山两台 C级2天同组
const preview = s.previewBatchSchedule([1, 2, 3, 4, 5])
const yunling = preview.find((g) => g.scope.includes('云岭'))!
const qingshan = preview.find((g) => g.scope.includes('青山'))!
check('云岭组2台随批', yunling.rows.length === 2)
check('云岭组#3挑为差异', yunling.diffRows.length === 1 && yunling.diffRows[0].id === 3, yunling.diffReasons[3])
check('青山组2台随批无差异', qingshan.rows.length === 2 && qingshan.diffRows.length === 0)
check('差异原因含类别与工期', yunling.diffReasons[3].includes('B级检修') && yunling.diffReasons[3].includes('3天'))

const r1 = s.commitBatchSchedule([1, 2, 3, 4, 5])
check('批量落单4台', r1.scheduledCount === 4, `scheduled=${r1.scheduledCount}`)
check('差异1台不拦整批', r1.diffCount === 1)

// 2. 台账侧动作：未排期先排期（008 尚未提交）
const noSchedule = s.advanceLedgerByCode('TRAN-2026-008', '提交开工')
check('未排期台账动作被引导', !noSchedule.ok && noSchedule.message.includes('排期单'), noSchedule.message)

// 3. 单台一组不进差异栏
const r8 = s.commitBatchSchedule([8])
check('单台一组直接排期', r8.scheduledCount === 1 && s.listDiffSchedules().length === 1)

// 4. 同一台主变重复提交只落一条
const r2 = s.commitBatchSchedule([1, 2, 8])
check('重复提交全部跳过', r2.duplicateCount === 3 && r2.scheduledCount === 0, r2.messages.join('；'))

// 5. 越级挡回：待开工直接确认完工
const id1 = s.listSchedules().find((x) => x.检修编号 === 'TRAN-2026-001')!.id
const jump = s.advanceSchedule(id1, '确认完工')
check('待开工→已完工越级挡回', !jump.ok && jump.message.includes('越级'), jump.message)
const go = s.advanceSchedule(id1, '提交开工')
check('待开工→检修中放行', go.ok, go.message)
const back = s.advanceSchedule(id1, '确认完工')
check('检修中→已完工放行并挂工作票待办', back.ok && back.message.includes('工作票'), back.message)
const ledger1 = listRows('transformermaint').find((x) => x.检修编号 === 'TRAN-2026-001')!
check('完工同步台账状态与完成日期', ledger1.status === '已完工' && !!ledger1.完成日期)
const permits1 = listRows('workpermit').filter((p) => String(p.工作票号) === 'WP-TRAN-2026-001')
check('完工生成待签发工作票', permits1.length === 1 && permits1[0].status === '待签发', permits1[0]?.工作任务)
const done = s.advanceSchedule(id1, '申请延期')
check('已完工不可再操作', !done.ok)

// 6. 完工待办幂等
const id2 = s.listSchedules().find((x) => x.检修编号 === 'TRAN-2026-002')!.id
s.advanceSchedule(id2, '提交开工')
const again = s.advanceSchedule(id2, '确认完工')
const p2 = listRows('workpermit').filter((p) => String(p.工作票号) === 'WP-TRAN-2026-002')
check('完工待办只生成一次', p2.length === 1, again.message)
// seed 自带的 007 完工票仍只有一条
const p7 = listRows('workpermit').filter((p) => String(p.工作票号) === 'WP-TRAN-2026-007')
check('种子完工票不重复补', p7.length === 1)

// 7. 工期口径：班组核定 → 调度批复冲突以批复为准，两处对齐
const id4 = s.listSchedules().find((x) => x.检修编号 === 'TRAN-2026-004')!.id
const crew = s.verifyCrewDuration(id4, '3天')
let row4 = s.listSchedules().find((x) => x.id === id4)!
let led4 = listRows('transformermaint').find((x) => x.检修编号 === 'TRAN-2026-004')!
check('班组核定回填并同步台账', row4.计划工期 === '3天' && String(led4.计划工期) === '3天', crew.message)
const disp = s.approveDispatchDuration(id4, '2天')
row4 = s.listSchedules().find((x) => x.id === id4)!
led4 = listRows('transformermaint').find((x) => x.检修编号 === 'TRAN-2026-004')!
check('冲突以调度批复为准', row4.计划工期 === '2天' && String(led4.计划工期) === '2天' && row4.工期核定状态 === '调度已批复', disp.message)
const crew2 = s.verifyCrewDuration(id4, '4天')
row4 = s.listSchedules().find((x) => x.id === id4)!
check('批复后班组再改仍按批复', row4.计划工期 === '2天', crew2.message)

// 8. 差异栏：单独成单
const diff = s.listDiffSchedules()
check('差异栏1台(#3)', diff.length === 1 && diff[0].检修编号 === 'TRAN-2026-003')
const acc = s.resolveDiffSchedule(diff[0].id, true)
const d2 = s.listDiffSchedules()
const formal3 = s.listSchedules().find((x) => x.检修编号 === 'TRAN-2026-003')!
check('差异单独成单', acc.ok && d2.length === 0 && formal3.排期状态 === '待开工', acc.message)

// 9. 按停电范围分组
const groups = s.scheduleGroups().map((g) => g.scope)
check('按停电范围分组', groups.includes('220kV云岭变全站') && groups.includes('110kV青山变#1主变间隔'), groups.join(' / '))

// 10. 延期与复工
const id5 = s.listSchedules().find((x) => x.检修编号 === 'TRAN-2026-005')!.id
s.advanceSchedule(id5, '提交开工')
const delay = s.advanceSchedule(id5, '申请延期')
check('检修中→已延期', delay.ok, delay.message)
const resume = s.advanceSchedule(id5, '提交开工')
check('延期复工→检修中', resume.ok, resume.message)

console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASSED')
if (fail.length) process.exit(1)
