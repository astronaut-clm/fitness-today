// 规则推荐：给每个计划打分，挑出「今日推荐」。AI 重排见 ai/recommend.js
const plansData = require('../databases/plans.js')
const insights = require('./insights.js')
const customPlans = require('./custom-plans.js')
const dateUtil = require('./date.js')
const storage = require('./storage.js')

// 淘汰分，远低于任何正常得分，排序时据此过滤
const SCENE_MISMATCH = -9999
const store = storage.scoped('ft_recommend_v1')

// donePlanIds 由 rank 先算一次传进来，免得每个候选都自己扫一遍记录
function score(plan, donePlanIds, profile, recentMuscles) {
  const p = profile || {}
  const scenes = p.scenes || []
  const reasons = []
  let value = 0

  if (scenes.length) {
    if (scenes.indexOf(plan.scene) < 0) return { value: SCENE_MISMATCH, reasons: [] }
    value += 35
    reasons.push('匹配你的' + plansData.sceneName(plan.scene) + '训练地点')
  }

  const levelGap = Math.abs((plansData.LEVEL_MAP[plan.level] || 1) - (plansData.LEVEL_MAP[p.experience] || 1))
  value += Math.max(0, 20 - levelGap * 12)

  // 疲劳扣分与首页统计共用 insights 这一份口径
  const categories = insights.categoriesOf(plan) || {}
  if (p.goal === 'fat_loss' && (categories.有氧 > 0 || plan.duration <= 25)) value += 10
  if (p.goal === 'muscle_gain' && plan.scene === 'gym') value += 12

  const recent = recentMuscles || {}
  let hitRecent = false
  Object.keys(categories).forEach(function (category) {
    if (!recent[category]) return
    hitRecent = true
    value -= 12
  })
  if (!hitRecent) reasons.push('避开近期已重点训练的部位')

  if (!donePlanIds[plan.id]) {
    value += 16
    reasons.push('这是你还没尝试过的计划')
  }

  return { value: value, reasons: reasons }
}

// 内置计划 + 各场景自定义计划
function candidates() {
  const list = plansData.plans.slice()
  plansData.SCENES.forEach(function (scene) {
    const plan = customPlans.get(scene)
    if (plan) list.push(plan)
  })
  return list
}

function decorate(rawPlan, reason) {
  const plan = Object.assign({}, rawPlan)
  plan.sceneName = plansData.sceneName(plan.scene)
  plan.reason = reason || '根据近期训练记录为你推荐'
  return plan
}

function rank(records, profile, n) {
  const recent = insights.recentMuscles(records)
  const done = {}
  ;(records || []).forEach(function (record) {
    if (record.planId) done[record.planId] = true
  })
  return candidates().map(function (plan) {
    const result = score(plan, done, profile, recent)
    return { plan: plan, score: result.value, reasons: result.reasons }
  }).filter(function (item) { return item.score > SCENE_MISMATCH })
    .sort(function (a, b) { return b.score - a.score })
    .slice(0, n || 5)
}

// 按偏好内容取签名。不能用 updatedAt：云端同步会刷新它，导致误判重选
function prefsSignature(profile) {
  const p = profile || {}
  const scenes = (p.scenes || []).slice().sort()
  const equipment = (p.equipment || []).slice().sort()
  return [p.goal || '', scenes.join(','), p.experience || '', equipment.join(',')].join('|')
}

function compute(records, profile) {
  const best = rank(records, profile, 1)[0] || { plan: plansData.plans[0], reasons: ['从轻松的计划开始'] }
  return decorate(best.plan, best.reasons[0])
}

// 缓存是为了「今天推荐哪个」当天不变——否则练完一次记录一变，推荐就换一个，看着像随机。
// 只有改了偏好或到第二天才重挑。opts.noCache 只算不存，用于云端数据还没拉回的过渡态
function pick(records, profile, opts) {
  const today = dateUtil.today()
  const sig = prefsSignature(profile)
  const cache = store.read()
  if (cache && cache.date === today && cache.sig === sig && cache.planId) {
    const cached = customPlans.resolvePlan(cache.planId)
    if (cached) return decorate(cached, cache.reason)
  }
  const plan = compute(records, profile)
  if (!(opts && opts.noCache)) {
    store.write({ date: today, sig: sig, planId: plan.id, reason: plan.reason })
  }
  return plan
}

function resetCache() {
  store.remove()
}

module.exports = {
  pick: pick,
  rank: rank,
  decorate: decorate,
  resetCache: resetCache
}
