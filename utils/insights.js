// 训练目标达成度、趋势与肌群覆盖
const dateUtil = require('./date.js')
const plansData = require('../data/plans.js')
const actionsData = require('../data/actions.js')
const customPlans = require('./custom-plans.js')

function weekStart(date) {
  const d = dateUtil.parse(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return dateUtil.format(d)
}

function addCategory(map, planId) {
  const plan = customPlans.getById(planId) || plansData.getPlan(planId)
  if (!plan) return
  plan.exercises.forEach(function (exercise) {
    const action = actionsData.getAction(exercise.actionId)
    const key = (action && action.category) || '其他'
    map[key] = (map[key] || 0) + Number(exercise.sets || 1) * Number(plan.loop || 1)
  })
}

function build(records, profile) {
  const list = records || []
  const today = dateUtil.today()
  const start = weekStart(today)
  const weekRecords = list.filter(function (record) { return record.date >= start && record.date <= today })
  const dateSet = {}
  let minutes = 0
  const coverage = {}
  weekRecords.forEach(function (record) {
    dateSet[record.date] = true
    minutes += Number(record.actualMinutes || 0)
    if (record.type === 'plan') addCategory(coverage, record.planId)
  })

  const targetDays = Number((profile && profile.weeklyTargetDays) || 3)
  const targetMinutes = Number((profile && profile.weeklyTargetMinutes) || 90)
  const days = Object.keys(dateSet).length

  return {
    weekDays: days,
    weekMinutes: minutes,
    targetDays: targetDays,
    targetMinutes: targetMinutes,
    dayPercent: Math.min(100, Math.round(days / Math.max(1, targetDays) * 100)),
    minutePercent: Math.min(100, Math.round(minutes / Math.max(1, targetMinutes) * 100)),
    coverage: Object.keys(coverage).map(function (name) { return { name: name, count: coverage[name] } })
  }
}

function recentMuscles(records, days) {
  const cutoff = dateUtil.addDays(dateUtil.today(), -(Number(days) || 2))
  const categories = {}
  ;(records || []).forEach(function (record) {
    if (record.date >= cutoff && record.type === 'plan') addCategory(categories, record.planId)
  })
  return categories
}

module.exports = {
  build: build,
  recentMuscles: recentMuscles
}
