// 个人计划调整：仅存本机，不参与云端同步，不改内置计划数据
const storage = require('./storage.js')

const KEY = 'ft_plan_adjustments_v1'

function emptyStore() {
  return { plans: {} }
}

function getStore() {
  const raw = storage.read(KEY)
  if (!raw || typeof raw !== 'object') return emptyStore()
  return { plans: (raw.plans && typeof raw.plans === 'object') ? raw.plans : {} }
}

function saveStore(store) {
  const safe = { plans: (store && store.plans) || {} }
  storage.write(KEY, safe)
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

// 应用本机调整：覆盖各动作组数，组数变化时按比例重算时长与热量
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
