// 教练记忆：从训练记录算出的长期画像，纯规则计算，只在拼 AI 提问时用。
// 完全由记录派生，所以不存本机也不参与同步，每次现算
const dateUtil = require('../date.js')
const insights = require('../insights.js')
const recordStore = require('../records.js')
const safeStr = require('./client.js').safeStr

const RECENT_DAYS = 14 // 近期完成率窗口
const MUSCLE_DAYS = 30 // 肌群分布窗口
const RHYTHM_DAYS = 56 // 星期节奏窗口（近 8 周）
const TREND_THRESHOLD = 10 // 完成率变化 ≥10pp 判定趋势升/降

function completionOf(list) {
  let done = 0
  let total = 0
  list.forEach(function (r) {
    done += Number(r.completedGroups || 0)
    total += Number(r.totalGroups || 0)
  })
  return total > 0 ? Math.round(done / total * 100) : 0
}

function topKeys(map, limit) {
  return Object.keys(map).sort(function (a, b) { return map[b] - map[a] }).slice(0, limit)
}

function build(records) {
  const list = (records || []).filter(function (r) { return r.type === recordStore.TYPE_PLAN })
  if (!list.length) return { totalSessions: 0 }

  const today = dateUtil.today()
  const rhythmCutoff = dateUtil.addDays(today, -RHYTHM_DAYS)
  const recentCutoff = dateUtil.addDays(today, -RECENT_DAYS)
  const prevCutoff = dateUtil.addDays(today, -RECENT_DAYS * 2)

  let totalMinutes = 0
  const planCount = {}
  const sceneCount = {}
  // 下标对齐 getDay()，0=周日；AI 据此识别训练节奏
  const weekdayRhythm = [0, 0, 0, 0, 0, 0, 0]
  const recent = []
  const previous = []

  list.forEach(function (r) {
    totalMinutes += Number(r.actualMinutes || 0)
    const name = safeStr(r.planName, 20)
    if (name) planCount[name] = (planCount[name] || 0) + 1
    const scene = safeStr(r.sceneName, 10)
    if (scene) sceneCount[scene] = (sceneCount[scene] || 0) + 1
    const d = r.date && dateUtil.parse(r.date)
    if (d && r.date >= rhythmCutoff) weekdayRhythm[d.getDay()]++
    if (r.date >= recentCutoff) recent.push(r)
    else if (r.date >= prevCutoff) previous.push(r)
  })

  const recentRate = completionOf(recent)
  const prevRate = completionOf(previous)
  let trend = 'flat'
  if (recent.length && previous.length) {
    if (recentRate >= prevRate + TREND_THRESHOLD) trend = 'up'
    else if (recentRate <= prevRate - TREND_THRESHOLD) trend = 'down'
  } else if (recent.length) {
    trend = 'new' // 刚起步，无对比基线
  }

  return {
    since: list[list.length - 1].date, // 列表倒序，末尾即首训日期
    totalSessions: list.length,
    totalMinutes: totalMinutes,
    avgMinutes: Math.round(totalMinutes / list.length),
    completionRate: completionOf(list),
    recentCompletionRate: recentRate,
    trend: trend,
    topPlans: topKeys(planCount, 3),
    scenes: topKeys(sceneCount, 2),
    weekdayRhythm: weekdayRhythm,
    // 与规则推荐的疲劳口径同源
    muscles30d: insights.recentMuscles(list, MUSCLE_DAYS)
  }
}

// 自己去取全量记录，调用方不传参
function get() {
  return build(recordStore.getAll())
}

module.exports = {
  get: get
}
