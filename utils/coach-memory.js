// 教练记忆：从训练记录派生的长期画像，规则计算、不消耗模型额度
// 设计要点：画像是派生数据，训练记录本身已云端同步，任意设备都可重建，
// 因此只本机缓存（指纹失效即重算），不参与同步、不占云函数往返
const dateUtil = require('./date.js')
const insights = require('./insights.js')
const storage = require('./storage.js')
const safeStr = require('./ai-client.js').safeStr

const KEY = 'ft_coach_memory_v1'
const RECENT_DAYS = 14 // 近期完成率窗口
const MUSCLE_DAYS = 30 // 肌群分布窗口
const RHYTHM_DAYS = 56 // 星期节奏窗口（近 8 周）
const TREND_THRESHOLD = 10 // 完成率变化 ≥10pp 判定趋势升/降

let cache = null // { fp, memory }：进程内缓存，避免同页多次 get 重算

// 输入指纹：记录数、最新更新时间、当天日期；任一变化则画像过期
function fingerprint(records) {
  let maxTs = 0
  ;(records || []).forEach(function (r) {
    const ts = Number(r.updatedAt || 0)
    if (ts > maxTs) maxTs = ts
  })
  return (records || []).length + '|' + maxTs + '|' + dateUtil.today()
}

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

// records：store.getAllRecords() 的全量列表（日期倒序）
function build(records) {
  const list = (records || []).filter(function (r) { return r.type === 'plan' })
  if (!list.length) return { totalSessions: 0 }

  const today = dateUtil.today()
  const rhythmCutoff = dateUtil.addDays(today, -RHYTHM_DAYS)
  const recentCutoff = dateUtil.addDays(today, -RECENT_DAYS)
  const prevCutoff = dateUtil.addDays(today, -RECENT_DAYS * 2)

  let totalMinutes = 0
  const planCount = {}
  const sceneCount = {}
  // 下标对齐 getDay()：0=周日 … 6=周六，AI 可据此识别用户的训练节奏
  const weekdayRhythm = [0, 0, 0, 0, 0, 0, 0]
  const recent = []
  const previous = []

  list.forEach(function (r) {
    totalMinutes += Number(r.actualMinutes || 0)
    const name = safeStr(r.planName, 20)
    if (name) planCount[name] = (planCount[name] || 0) + 1
    const scene = safeStr(r.sceneName, 10)
    if (scene) sceneCount[scene] = (sceneCount[scene] || 0) + 1
    if (r.date >= rhythmCutoff) weekdayRhythm[dateUtil.parse(r.date).getDay()]++
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
    // 近 30 天肌群组数分布，与规则推荐/疲劳口径一致（insights.recentMuscles）
    muscles30d: insights.recentMuscles(list, MUSCLE_DAYS)
  }
}

// 主入口：传入全量记录，命中缓存直接返回，否则重算并落本机
function get(records) {
  const fp = fingerprint(records)
  if (cache && cache.fp === fp) return cache.memory
  const stored = storage.read(KEY)
  if (stored && stored.fp === fp && stored.memory) {
    cache = stored
    return stored.memory
  }
  const memory = build(records)
  cache = { fp: fp, memory: memory }
  storage.write(KEY, cache)
  return memory
}

// 登出清空本机数据时调用，避免画像跨账号残留
function resetLocal() {
  cache = null
  storage.remove(KEY)
}

module.exports = {
  get: get,
  resetLocal: resetLocal
}
