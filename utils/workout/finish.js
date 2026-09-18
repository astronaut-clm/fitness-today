// 训练完成后的收尾：落库、完成页那一屏的文案与统计。
// 这里不读页面的 data，只吃一个 summary 对象；要不要把结果写回界面由页面决定。
// summary = { planName, total, skipped, seconds, costText }
const plansData = require('../../databases/plans.js')
const records = require('../records.js')
const sessionStore = require('./session.js')
const dateUtil = require('../date.js')
const insights = require('../insights.js')
const profile = require('../profile.js')
const toast = require('../toast.js')
const copy = require('./lines.js')

// 秒 → '45 秒' / '3 分' / '3 分 20 秒'
function costText(seconds) {
  if (seconds < 60) return seconds + ' 秒'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? minutes + ' 分 ' + rest + ' 秒' : minutes + ' 分钟'
}

// 落库并清掉断点续训的进度。失败时自己弹提示并返回 null（完成页照常展示）
function save(plan, summary) {
  // addRecord 写本地失败（多半是 storage 配额溢出）会返回 null，
  // 必须明确提示，不能让用户以为这条训练已经记下来了
  let saved = null
  try {
    saved = records.addRecord({
      date: dateUtil.today(),
      type: records.TYPE_PLAN,
      planId: plan.id,
      planName: plan.name,
      scene: plan.scene,
      sceneName: plansData.sceneName(plan.scene),
      duration: plan.duration,
      actualSeconds: summary.seconds,
      actualMinutes: Math.max(1, Math.round(summary.seconds / 60)),
      completedGroups: Math.max(0, summary.total - summary.skipped),
      totalGroups: summary.total,
      skippedGroups: summary.skipped
    })
  } catch (e) {
    saved = null
  }
  if (!saved) {
    toast.show('保存失败，本地存储空间可能已满')
    return null
  }
  sessionStore.clear()
  return saved
}

// 完成页那一屏。必须在 save() 之后调用：连续打卡、本周训练要算上刚落库的这一条
function feedback(summary) {
  const total = summary.total || 1
  const all = records.getAll()
  const stats = records.computeStatsFrom(all)
  const insight = insights.weekProgress(all, profile.get())
  const titles = summary.skipped === 0 ? copy.PRAISE.perfect : copy.PRAISE.partial
  return {
    doneTitle: copy.pickOne(titles),
    doneCheer: copy.pickOne(copy.CHEER_LINES),
    doneStats: [
      { label: '完成组数', value: Math.max(0, total - summary.skipped) + '/' + total },
      { label: '用时', value: summary.costText },
      { label: '连续打卡', value: stats.streak + ' 天' },
      { label: '本周训练', value: insight.weekDays + ' 次' }
    ]
  }
}

module.exports = {
  costText: costText,
  save: save,
  feedback: feedback
}
