const plansData = require('../data/plans.js')
const actionsData = require('../data/actions.js')
const insights = require('./insights.js')
const customPlans = require('./custom-plans.js')
const dateUtil = require('./date.js')
const levelUtil = require('./level.js')

// 场景不匹配的淘汰分：远低于任何正常得分，排序时据此过滤
const SCENE_MISMATCH = -9999

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
    if (scenes.indexOf(plan.scene) < 0) return { value: SCENE_MISMATCH, reasons: [] }
    value += 35
    reasons.push('匹配你的' + plansData.sceneName(plan.scene) + '训练地点')
  }

  const levelGap = Math.abs((levelUtil.LEVEL_MAP[plan.level] || 1) - (levelUtil.LEVEL_MAP[p.experience] || 1))
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

// 候选 = 内置计划 + 用户自定义计划（各场景一份）
function candidates() {
  const list = plansData.plans.slice()
  ;['home', 'gym'].forEach(function (scene) {
    const plan = customPlans.get(scene)
    if (plan) list.push(plan)
  })
  return list
}

// 补展示字段（场景名/推荐理由），不改原始数据
function decorate(rawPlan, reason) {
  const plan = Object.assign({}, rawPlan)
  plan.sceneName = plansData.sceneName(plan.scene)
  plan.reason = reason || '根据近期训练记录为你推荐'
  return plan
}

// 打分排序后的前 n 个候选（已过滤场景不符），供 AI 重排使用
function rank(records, profile, n) {
  const recent = insights.recentMuscles(records)
  return candidates().map(function (plan) {
    const result = score(plan, records, profile, recent)
    return { plan: plan, score: result.value, reasons: result.reasons }
  }).filter(function (item) { return item.score > SCENE_MISMATCH })
    .sort(function (a, b) { return b.score - a.score })
    .slice(0, n || 5)
}

function findById(id) {
  const list = candidates()
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

// 当日推荐缓存：{ date, sig, planId, reason }
const CACHE_KEY = 'ft_recommend_v1'

function readCache() {
  try { return wx.getStorageSync(CACHE_KEY) || null } catch (e) { return null }
}

function writeCache(data) {
  try { wx.setStorageSync(CACHE_KEY, data) } catch (e) {}
}

// 影响打分的偏好内容签名（场景/经验/目标/器械）；不能用 updatedAt 当键，云端同步会刷新它导致误判重选
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

// 当日推荐：当天内稳定，命中缓存（同日且偏好未变）直接返回，改偏好才重选。
// opts.noCache：只算不写，用于登录后数据尚未同步的过渡态，避免污染缓存
function pick(records, profile, opts) {
  const today = dateUtil.today()
  const sig = prefsSignature(profile)
  const cache = readCache()
  if (cache && cache.date === today && cache.sig === sig && cache.planId) {
    const cached = findById(cache.planId)
    if (cached) return decorate(cached, cache.reason)
  }
  const plan = compute(records, profile)
  if (!(opts && opts.noCache)) {
    writeCache({ date: today, sig: sig, planId: plan.id, reason: plan.reason })
  }
  return plan
}

// 退出登录时清空当日推荐缓存，避免旧缓存与新账号数据错配
function resetCache() {
  try { wx.removeStorageSync(CACHE_KEY) } catch (e) {}
}

module.exports = {
  pick: pick,
  rank: rank,
  findById: findById,
  decorate: decorate,
  resetCache: resetCache
}
