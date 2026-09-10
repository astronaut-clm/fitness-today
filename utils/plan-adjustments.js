// utils/plan-adjustments.js 个人计划调整，绝不修改内置计划数据。
// 调整按 openid 存于云端 ft_users 的 planAdjustments 字段，可与偏好、头像昵称互不覆盖，
// 登录后双向同步（updatedAt 收敛），换机/他端改动可恢复。
const cloud = require('./cloud.js')

const KEY = 'ft_plan_adjustments_v1'

function emptyStore() {
  return { plans: {}, updatedAt: 0 }
}

// 兼容旧版本直接存储「planId -> adjustment」的结构，自动包裹成 { plans, updatedAt }。
function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore()
  if (raw.plans && typeof raw.plans === 'object') {
    return { plans: raw.plans, updatedAt: Number(raw.updatedAt || 0) }
  }
  return { plans: raw, updatedAt: 0 }
}

function getStore() {
  try { return normalizeStore(wx.getStorageSync(KEY)) } catch (e) { return emptyStore() }
}

function saveStore(store) {
  const safe = {
    plans: (store && store.plans) || {},
    updatedAt: Number((store && store.updatedAt) || 0)
  }
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
  store.updatedAt = Date.now()
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
  store.updatedAt = Date.now()
  saveStore(store)
}

function apply(plan) {
  const adjustment = get(plan.id)
  const copy = Object.assign({}, plan)
  copy.exercises = (plan.exercises || []).map(function (exercise) {
    const patch = (adjustment.exercises && adjustment.exercises[exercise.actionId]) || {}
    return Object.assign({}, exercise, patch)
  })
  return copy
}

// 从云端取回个人计划调整（云端无记录时返回空，updatedAt = 0）。
function pullFromCloud() {
  return cloud.call('adjGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, data: null }
    const data = (res.planAdjustments && typeof res.planAdjustments === 'object') ? res.planAdjustments : {}
    return { ok: true, data: data, updatedAt: Number(data.updatedAt || 0) }
  })
}

// 把本机个人计划调整上传云端（login 云函数落库并刷新 updatedAt）。
function pushToCloud() {
  const store = getStore()
  return cloud.call('adjSet', { planAdjustments: { plans: store.plans, updatedAt: store.updatedAt } }).then(function (res) {
    return !!(res && res.ok)
  })
}

// 用云端内容整体覆盖本地（不存在的字段保持为空）。
function applyFromCloud(data) {
  const src = (data && typeof data === 'object') ? data : {}
  const store = {
    plans: (src.plans && typeof src.plans === 'object') ? src.plans : {},
    updatedAt: Number(src.updatedAt || 0)
  }
  saveStore(store)
  return store
}

// 双向收敛（调用方需保证已登录）：
// - 云端较新：拉取覆盖本地（换机 / 他端改动恢复）
// - 本地较新：本地上传（首次启用云端 / 刚改过未同步）
// 返回 { ok, changed }，changed 表示本次本机调整被云端覆盖。
function syncFromCloud() {
  return pullFromCloud().then(function (remote) {
    if (!remote || !remote.ok) return { ok: false, changed: false }
    const localTs = Number(getStore().updatedAt || 0)
    const remoteTs = remote.updatedAt
    if (remoteTs === 0 && localTs === 0) return { ok: true, changed: false }
    if (remoteTs > localTs) {
      applyFromCloud(remote.data)
      return { ok: true, changed: true }
    }
    if (localTs > remoteTs) {
      return pushToCloud().then(function (ok) {
        return { ok: ok, changed: false }
      })
    }
    return { ok: true, changed: false }
  })
}

// 退出登录时清空本机调整（云端保留，重新登录后按账号拉回），避免下一账号误用/误推上一账号的数据。
function resetLocal() {
  saveStore(emptyStore())
}

module.exports = {
  getStore: getStore,
  get: get,
  setExercise: setExercise,
  clear: clear,
  apply: apply,
  pushToCloud: pushToCloud,
  applyFromCloud: applyFromCloud,
  syncFromCloud: syncFromCloud,
  resetLocal: resetLocal
}
