// utils/plan-adjustments.js 个人计划调整，绝不修改内置计划数据。
// 调整仅保存于本机，所有计划（内置与自定义）都不参与云端同步。
const KEY = 'ft_plan_adjustments_v1'

function emptyStore() {
  return { plans: {} }
}

// 兼容旧版本 { plans, updatedAt } 与直接存储「planId -> adjustment」的结构。
function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore()
  if (raw.plans && typeof raw.plans === 'object') return { plans: raw.plans }
  return { plans: raw }
}

function getStore() {
  try { return normalizeStore(wx.getStorageSync(KEY)) } catch (e) { return emptyStore() }
}

function saveStore(store) {
  const safe = { plans: (store && store.plans) || {} }
  try { wx.setStorageSync(KEY, safe) } catch (e) {}
  return safe
}

function getAll() {
  return getStore().plans
}

function get(planId) {
  return getAll()[planId] || { exercises: {} }
}

function save(planId, adjustment) {
  const store = getStore()
  store.plans[planId] = adjustment || { exercises: {} }
  saveStore(store)
  return store.plans[planId]
}

function setExercise(planId, actionId, patch) {
  const adjustment = get(planId)
  if (!adjustment.exercises) adjustment.exercises = {}
  const current = adjustment.exercises[actionId] || {}
  const next = Object.assign({}, current, patch || {})
  if (Object.keys(next).length) adjustment.exercises[actionId] = next
  return save(planId, adjustment)
}

function clear(planId) {
  const store = getStore()
  delete store.plans[planId]
  saveStore(store)
}

// 应用本机调整：覆盖各动作组数；组数变化时按总组数比例重算时长与热量，
// 让计划详情、跟练记录跟随个人调整（未调整时保持内置计划的原始数值）。
function apply(plan) {
  const adjustment = get(plan.id)
  const copy = Object.assign({}, plan)
  let originalSets = 0
  let adjustedSets = 0
  copy.exercises = (plan.exercises || []).map(function (exercise) {
    const patch = (adjustment.exercises && adjustment.exercises[exercise.actionId]) || {}
    const merged = Object.assign({}, exercise, patch)
    originalSets += Math.max(1, Number(exercise.sets) || 1)
    adjustedSets += Math.max(1, Number(merged.sets) || 1)
    return merged
  })
  if (originalSets > 0 && adjustedSets > 0 && adjustedSets !== originalSets) {
    const factor = adjustedSets / originalSets
    copy.duration = Math.max(1, Math.round(Number(plan.duration || 0) * factor))
    copy.calories = Math.max(1, Math.round(Number(plan.calories || 0) * factor))
  }
  return copy
}

// 退出登录时清空本机调整（纯本机数据，重新登录不会拉回）。
function resetLocal() {
  saveStore(emptyStore())
}

module.exports = {
  get: get,
  setExercise: setExercise,
  clear: clear,
  apply: apply,
  resetLocal: resetLocal
}
