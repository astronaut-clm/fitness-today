// 个人计划调整：仅存本机，不参与云端同步，不改内置计划数据。
// 只调组数——每组做什么（计时 / 力竭 / 次数）属于计划本身，本机调整不碰，
// 否则一个 { reps } 补丁盖到计时组上会造出 seconds 与 reps 并存的条目，谁生效要看读取顺序
const exerciseItem = require('./exercise-item.js')
const storage = require('./storage.js')

const store = storage.scoped('ft_plan_adjustments_v1')

function emptyStore() {
  return { plans: {} }
}

function getStore() {
  const raw = store.read()
  if (!raw || typeof raw !== 'object') return emptyStore()
  return { plans: (raw.plans && typeof raw.plans === 'object') ? raw.plans : {} }
}

function saveStore(next) {
  const safe = { plans: (next && next.plans) || {} }
  store.write(safe)
  return safe
}

function getAll() {
  return getStore().plans
}

function get(planId) {
  return getAll()[planId] || { exercises: {} }
}

function save(planId, adjustment) {
  const next = getStore()
  next.plans[planId] = adjustment || { exercises: {} }
  saveStore(next)
  return next.plans[planId]
}

function setSets(planId, actionId, sets) {
  const adjustment = get(planId)
  if (!adjustment.exercises) adjustment.exercises = {}
  adjustment.exercises[actionId] = { sets: exerciseItem.clampSets(sets) }
  return save(planId, adjustment)
}

function clear(planId) {
  const next = getStore()
  delete next.plans[planId]
  saveStore(next)
}

// 应用本机调整：覆盖各动作组数，组数变化时按比例重算时长与热量。
// 读取时同样只认 sets，历史数据里的其它键一律忽略
function apply(plan) {
  if (!plan) return plan
  const patches = (get(plan.id) || {}).exercises || {}
  const copy = Object.assign({}, plan)
  let originalSets = 0
  let adjustedSets = 0
  copy.exercises = (plan.exercises || []).map(function (exercise) {
    const patch = patches[exercise.actionId]
    const original = Math.max(1, Number(exercise.sets) || 1)
    const adjusted = (patch && patch.sets) ? exerciseItem.clampSets(patch.sets) : original
    originalSets += original
    adjustedSets += adjusted
    return Object.assign({}, exercise, { sets: adjusted })
  })
  if (originalSets > 0 && adjustedSets !== originalSets) {
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
  setSets: setSets,
  clear: clear,
  apply: apply,
  resetLocal: resetLocal
}
