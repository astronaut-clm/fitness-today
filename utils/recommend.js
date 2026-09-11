// utils/recommend.js 个性化计划推荐
const plansData = require('../data/plans.js')
const actionsData = require('../data/actions.js')
const insights = require('./insights.js')
const customPlans = require('./custom-plans.js')

function planCategories(plan) {
  const out = {}
  ;(plan.exercises || []).forEach(function (exercise) {
    const action = actionsData.getAction(exercise.actionId)
    if (action) out[action.category] = true
  })
  return out
}

function score(plan, records, profile, recentMuscles) {
  let value = 0
  const reasons = []
  const p = profile || {}
  const scenes = p.scenes || []

  if (scenes.length) {
    if (scenes.indexOf(plan.scene) < 0) return { value: -9999, reasons: [] }
    value += 35
    reasons.push('匹配你的' + plansData.sceneName(plan.scene) + '训练地点')
  }

  const levels = { 初级: 1, 中级: 2, 高级: 3 }
  const levelGap = Math.abs((levels[plan.level] || 1) - (levels[p.experience] || 1))
  value += Math.max(0, 20 - levelGap * 12)

  const categories = planCategories(plan)
  if (p.goal === 'fat_loss' && (categories.有氧 || plan.duration <= 25)) value += 10
  if (p.goal === 'muscle_gain' && plan.scene === 'gym') value += 12

  const recent = recentMuscles || {}
  Object.keys(categories).forEach(function (category) {
    if (recent[category]) value -= 12
  })
  if (!Object.keys(categories).some(function (category) { return recent[category] })) {
    reasons.push('避开近期已重点训练的部位')
  }

  let lastDone = ''
  ;(records || []).forEach(function (record) {
    if (record.planId === plan.id && record.date > lastDone) lastDone = record.date
  })
  if (!lastDone) {
    value += 16
    reasons.push('这是你还没尝试过的计划')
  }

  return { value: value, reasons: reasons }
}

// 候选计划 = 内置计划 + 用户自定义计划（居家 / 健身房各一份），
// 让自定义计划也能进入推荐打分、成为当日推荐。
function candidates() {
  const list = plansData.plans.slice()
  ;['home', 'gym'].forEach(function (scene) {
    const plan = customPlans.get(scene)
    if (plan) list.push(plan)
  })
  return list
}

function pick(records, profile) {
  const recent = insights.recentMuscles(records, 2)
  const scored = candidates().map(function (plan) {
    const result = score(plan, records, profile, recent)
    return { plan: plan, score: result.value, reasons: result.reasons }
  }).filter(function (item) { return item.score > -9999 })

  scored.sort(function (a, b) { return b.score - a.score })
  const best = scored[0] || { plan: plansData.plans[0], reasons: ['从轻松的计划开始'] }
  const plan = {}
  Object.keys(best.plan).forEach(function (key) { plan[key] = best.plan[key] })
  plan.sceneName = plansData.sceneName(plan.scene)
  plan.reason = best.reasons[0] || '根据近期训练记录为你推荐'
  return plan
}

module.exports = { pick: pick }
