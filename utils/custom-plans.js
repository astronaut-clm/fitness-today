// utils/custom-plans.js 自定义训练计划
// 每个场景各一份，读取时装饰成与内置计划一致的结构供各页面复用；
// 登录后按 openid 与云端双向同步（updatedAt 收敛），换机可恢复。
const cloud = require('./cloud.js')
const actionsData = require('../data/actions.js')
const plansData = require('../data/plans.js')

const KEY = 'ft_custom_plans_v1'
const LEVELS = { 初级: 1, 中级: 2, 高级: 3 }
const LEVEL_NAME = { 1: '初级', 2: '中级', 3: '高级' }

function emptyStore() {
  return { plans: {}, updatedAt: 0 }
}

function getStore() {
  let raw = null
  try { raw = wx.getStorageSync(KEY) } catch (e) { raw = null }
  if (!raw || typeof raw !== 'object') return emptyStore()
  return {
    plans: (raw.plans && typeof raw.plans === 'object') ? raw.plans : {},
    updatedAt: Number(raw.updatedAt || 0)
  }
}

function saveStore(store) {
  const safe = {
    plans: (store && store.plans) || {},
    updatedAt: Number((store && store.updatedAt) || 0)
  }
  try { wx.setStorageSync(KEY, safe) } catch (e) {}
  return safe
}

// 依据所选动作估算时长/消耗/难度，免去用户填写
function estimate(exercises, scene) {
  const gym = scene === 'gym'
  const restPerSet = gym ? 60 : 30
  let workSeconds = 0
  let totalSets = 0
  let level = 1
  ;(exercises || []).forEach(function (ex) {
    const action = actionsData.getAction(ex.actionId)
    const sets = Math.max(1, Number(ex.sets) || 1)
    totalSets += sets
    const match = /^(\d+)\s*秒/.exec(String(ex.reps || '').trim())
    workSeconds += sets * (match ? Number(match[1]) : 40)
    if (action && LEVELS[action.level]) level = Math.max(level, LEVELS[action.level])
  })
  const restSeconds = Math.max(0, totalSets - 1) * restPerSet
  const duration = Math.max(5, Math.round((workSeconds + restSeconds) / 60))
  const calories = Math.round(duration * (gym ? 6 : 5))
  return { duration: duration, calories: calories, level: LEVEL_NAME[level] }
}

function planId(scene) {
  return 'custom_' + scene
}

// 把本地原始计划补全为可渲染的完整结构
function decorate(stored) {
  if (!stored || !stored.scene) return null
  const exercises = (stored.exercises || []).map(function (ex) {
    return {
      actionId: ex.actionId,
      sets: Math.max(1, Math.min(9, Number(ex.sets) || 1)),
      reps: String(ex.reps || '').trim() || '12次',
      rest: ex.rest || ''
    }
  }).filter(function (ex) { return !!actionsData.getAction(ex.actionId) })
  if (!exercises.length) return null

  const est = estimate(exercises, stored.scene)
  const categories = []
  exercises.forEach(function (ex) {
    const action = actionsData.getAction(ex.actionId)
    if (action && categories.indexOf(action.category) < 0) categories.push(action.category)
  })

  return {
    id: planId(stored.scene),
    name: String(stored.name || '').trim() || (stored.scene === 'gym' ? '健身房专属' : '居家专属'),
    scene: stored.scene,
    sceneName: plansData.sceneName(stored.scene),
    custom: true,
    level: est.level,
    duration: est.duration,
    calories: est.calories,
    tags: categories,
    summary: '自定义动作组合：' + exercises.length + ' 个动作，按自己的节奏完成。',
    notice: stored.scene === 'gym'
      ? '自定义计划：从轻重量开始热身，组间注意休息，动作标准优先于重量。'
      : '自定义计划：动作间保持均匀呼吸，注意核心收紧，量力而行。',
    loop: 1,
    exercises: exercises,
    updatedAt: Number(stored.updatedAt || 0)
  }
}

// 读取某场景的自定义计划（无则 null）
function get(scene) {
  return decorate(getStore().plans[scene])
}

// 按 id 读取（'custom_home'/'custom_gym'），供详情页/跟练页统一解析
function getById(id) {
  if (typeof id !== 'string' || id.indexOf('custom_') !== 0) return null
  return get(id.slice(7))
}

// 某场景是否有自定义计划
function has(scene) {
  return !!get(scene)
}

// 某场景的自定义计划列表（0 或 1 个）
function listByScene(scene) {
  const plan = get(scene)
  return plan ? [plan] : []
}

// 保存（新增或覆盖）某场景自定义计划
function save(scene, data) {
  if (scene !== 'home' && scene !== 'gym') return null
  const store = getStore()
  store.plans[scene] = {
    name: String((data && data.name) || '').trim(),
    scene: scene,
    exercises: ((data && data.exercises) || []).map(function (ex) {
      return {
        actionId: ex.actionId,
        sets: Math.max(1, Math.min(9, Number(ex.sets) || 1)),
        reps: String(ex.reps || '').trim() || '12次',
        rest: ex.rest || ''
      }
    }),
    updatedAt: Date.now()
  }
  store.updatedAt = Date.now()
  saveStore(store)
  return get(scene)
}

function remove(scene) {
  const store = getStore()
  delete store.plans[scene]
  store.updatedAt = Date.now()
  saveStore(store)
}

// 退出登录时清空本机自定义计划
function resetLocal() {
  saveStore(emptyStore())
}

// 从云端取回自定义计划（无记录时 updatedAt=0）
function pullFromCloud() {
  return cloud.call('cpGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, data: null }
    const data = (res.customPlans && typeof res.customPlans === 'object') ? res.customPlans : {}
    return { ok: true, data: data, updatedAt: Number(data.updatedAt || 0) }
  })
}

// 上传本机自定义计划到云端
function pushToCloud() {
  const store = getStore()
  return cloud.call('cpSet', { customPlans: { plans: store.plans, updatedAt: store.updatedAt } }).then(function (res) {
    return !!(res && res.ok)
  })
}

// 用云端内容整体覆盖本地
function applyFromCloud(data) {
  const src = (data && typeof data === 'object') ? data : {}
  const store = {
    plans: (src.plans && typeof src.plans === 'object') ? src.plans : {},
    updatedAt: Number(src.updatedAt || 0)
  }
  saveStore(store)
  return store
}

// 双向收敛（调用方需保证已登录）：云端较新则覆盖本地，本地较新则上传；changed 表示本地被云端覆盖
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

module.exports = {
  get: get,
  getById: getById,
  has: has,
  listByScene: listByScene,
  save: save,
  remove: remove,
  resetLocal: resetLocal,
  getStore: getStore,
  pushToCloud: pushToCloud,
  applyFromCloud: applyFromCloud,
  syncFromCloud: syncFromCloud
}
