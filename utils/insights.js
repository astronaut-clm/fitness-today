// 训练记录 → 首页的数字：本周目标达成度、本周练了哪些肌群、近几天练了哪些肌群。
// 入参一律是 records.getAll() 的结果，本文件只读不写
const dateUtil = require('./date.js')
const actionsData = require('../databases/actions.js')
const customPlans = require('./custom-plans.js')
const profile = require('./profile.js')
const recordStore = require('./records.js')

const RECENT_MUSCLE_DAYS = 3 // 「近期疲劳」窗口，规则打分与 AI 推荐同口径

// to 一律传今天，未来日期（设备时钟被改过）不参与统计
function inRange(records, from, to) {
  return (records || []).filter(function (record) {
    return record.date >= from && record.date <= to
  })
}

// 同一个 plan 在一次 onShow / 一次 AI 请求里会被反复折算，按引用记忆。
// WeakMap 不额外持有引用，plan 释放时缓存自动回收
const categoryMemo = new WeakMap()

// 计划 → 肌群组数 { 核心: 6, 腿部: 4 }，全项目唯一实现
function categoriesOf(plan) {
  if (!plan) return null
  const hit = categoryMemo.get(plan)
  if (hit) return hit
  const out = {}
  const loop = Number(plan.loop || 1)
  ;(plan.exercises || []).forEach(function (exercise) {
    const action = actionsData.getAction(exercise.actionId)
    const name = (action && action.category) || '其他'
    out[name] = (out[name] || 0) + Number(exercise.sets || 1) * loop
  })
  categoryMemo.set(plan, out)
  return out
}

// 把一条记录的肌群组数累加进 map
function addCategories(map, planId) {
  const src = categoriesOf(customPlans.resolvePlan(planId))
  if (!src) return
  Object.keys(src).forEach(function (name) {
    map[name] = (map[name] || 0) + src[name]
  })
}

// 训练天数（同日多次算一天）、总时长、目标完成度
function weekProgress(records, prefs) {
  const today = dateUtil.today()
  const week = inRange(records, dateUtil.weekStart(today), today)

  const dateSet = {}
  let minutes = 0
  week.forEach(function (record) {
    dateSet[record.date] = true
    minutes += Number(record.actualMinutes || 0)
  })
  const days = Object.keys(dateSet).length

  const targetDays = Number((prefs && prefs.weeklyTargetDays) || profile.DEFAULT_WEEKLY_TARGET.days)
  const targetMinutes = Number((prefs && prefs.weeklyTargetMinutes) || profile.DEFAULT_WEEKLY_TARGET.minutes)

  return {
    weekDays: days,
    weekMinutes: minutes,
    targetDays: targetDays,
    targetMinutes: targetMinutes,
    dayPercent: Math.min(100, Math.round(days / Math.max(1, targetDays) * 100)),
    minutePercent: Math.min(100, Math.round(minutes / Math.max(1, targetMinutes) * 100))
  }
}

// 按组数累加，练两次算两次（与训练天数不同，这里不去重）
function weekCoverage(records) {
  const today = dateUtil.today()
  const coverage = {}
  inRange(records, dateUtil.weekStart(today), today).forEach(function (record) {
    if (record.type === recordStore.TYPE_PLAN) addCategories(coverage, record.planId)
  })
  return Object.keys(coverage).map(function (name) {
    return { name: name, count: coverage[name] }
  })
}

// 进度条宽度在产出视图时算好，调用方不再各写一份
function withBars(view) {
  view.dayBar = 'width:' + Math.max(0, Number(view.dayPercent) || 0) + '%;'
  view.minuteBar = 'width:' + Math.max(0, Number(view.minutePercent) || 0) + '%;'
  return view
}

// 本周卡片 = 进度 + 肌群覆盖；只要进度的直接用 weekProgress
function build(records, prefs) {
  const view = weekProgress(records, prefs)
  view.coverage = weekCoverage(records)
  return withBars(view)
}

// 字段与 build 完全一致（含进度条样式），供未登录/重置用
function empty() {
  return withBars({
    weekDays: 0,
    weekMinutes: 0,
    targetDays: profile.DEFAULT_WEEKLY_TARGET.days,
    targetMinutes: profile.DEFAULT_WEEKLY_TARGET.minutes,
    dayPercent: 0,
    minutePercent: 0,
    coverage: []
  })
}

// 近 days 天的肌群组数分布
function computeRecentMuscles(records, span) {
  const today = dateUtil.today()
  const cutoff = dateUtil.addDays(today, -span)
  const categories = {}
  inRange(records, cutoff, today).forEach(function (record) {
    if (record.type === recordStore.TYPE_PLAN) addCategories(categories, record.planId)
  })
  return categories
}

// 一次 AI 请求里 rank() 与疲劳判断会各要一次，且传入的恒为同一个数组引用，
// 按引用记忆即可去重，不必改调用方签名
const recentMuscleMemo = new WeakMap()

function recentMuscles(records, days) {
  const span = Number(days) || RECENT_MUSCLE_DAYS
  if (!records) return computeRecentMuscles(records, span)
  let perSpan = recentMuscleMemo.get(records)
  if (!perSpan) {
    perSpan = {}
    recentMuscleMemo.set(records, perSpan)
  }
  if (!perSpan[span]) perSpan[span] = computeRecentMuscles(records, span)
  // 返回副本：调用方会直接改返回值，别让它们写到缓存上
  return Object.assign({}, perSpan[span])
}

module.exports = {
  build: build,
  empty: empty,
  weekProgress: weekProgress,
  recentMuscles: recentMuscles,
  categoriesOf: categoriesOf
}
