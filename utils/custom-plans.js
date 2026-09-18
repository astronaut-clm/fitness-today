// 自定义训练计划：每场景各一份，只能覆盖不能删；读取时装饰成与内置计划一致的结构；
// 云端同步由 profile.syncFromCloud 驱动（按场景比较 updatedAt，较新者胜）
const cloud = require('./cloud.js')
const actionsData = require('../databases/actions.js')
const plansData = require('../databases/plans.js')
const exerciseItem = require('./exercise-item.js')
const storage = require('./storage.js')
const workoutGroups = require('./workout/groups.js')

const store = storage.scoped('ft_custom_plans_v1')
const ID_PREFIX = 'custom_'
// 有哪些场景由 databases/plans.js 定义，这里不再自带一份
const SCENES = plansData.SCENES

function emptyStore() {
  return { plans: {}, updatedAt: 0 }
}

// 本机存的是「用户选了哪些动作」，读出来时再装饰成完整计划（补时长、难度、卡路里等）
function getStore() {
  const raw = store.read()
  if (!raw || typeof raw !== 'object') return emptyStore()
  return {
    plans: (raw.plans && typeof raw.plans === 'object') ? raw.plans : {},
    updatedAt: Number(raw.updatedAt || 0)
  }
}

function saveStore(next) {
  const safe = {
    plans: (next && next.plans) || {},
    updatedAt: Number((next && next.updatedAt) || 0)
  }
  store.write(safe)
  return safe
}

// 条目字段与上下限统一由 exercise-item 收敛；云端原样存收到的内容，不再清洗一遍
function normalizeExercises(list) {
  return (list || []).map(function (ex) {
    return exerciseItem.normalizeItem(ex)
  })
}

// items: [{ exercise, action }]，动作已解析，避免重复查表
function estimate(items, scene) {
  const gym = scene === 'gym'
  // 与真实训练（workout/groups）共用同一份组间休息缺省值，避免估算与实际两套数值
  const restPerSet = workoutGroups.DEFAULT_REST[scene] || 20
  let workSeconds = 0
  let totalSets = 0
  let level = 1
  items.forEach(function (item) {
    const sets = item.exercise.sets
    totalSets += sets
    workSeconds += sets * exerciseItem.workSeconds(item.exercise)
    const actionLevel = plansData.LEVEL_MAP[item.action.level]
    if (actionLevel) level = Math.max(level, actionLevel)
  })
  const restSeconds = Math.max(0, totalSets - 1) * restPerSet
  const duration = Math.max(5, Math.round((workSeconds + restSeconds) / 60))
  return {
    duration: duration,
    calories: Math.round(duration * (gym ? 6 : 5)),
    level: plansData.LEVEL_NAME[level]
  }
}

function planId(scene) {
  return ID_PREFIX + scene
}

function defaultName(scene) {
  return plansData.sceneName(scene) + '专属'
}

// 装饰成与内置计划一致的结构；动作已下架（不在动作库）的条目直接丢弃
function decorate(stored) {
  if (!stored || !stored.scene) return null
  const items = []
  const categories = []
  normalizeExercises(stored.exercises).forEach(function (exercise) {
    const action = actionsData.getAction(exercise.actionId)
    if (!action) return
    items.push({ exercise: exercise, action: action })
    if (categories.indexOf(action.category) < 0) categories.push(action.category)
  })
  if (!items.length) return null

  const est = estimate(items, stored.scene)
  return {
    id: planId(stored.scene),
    name: String(stored.name || '').trim() || defaultName(stored.scene),
    scene: stored.scene,
    sceneName: plansData.sceneName(stored.scene),
    custom: true,
    level: est.level,
    duration: est.duration,
    calories: est.calories,
    tags: categories,
    summary: '自定义动作组合：' + items.length + ' 个动作，按自己的节奏完成。',
    notice: stored.scene === 'gym'
      ? '自定义计划：从轻重量开始热身，组间注意休息，动作标准优先于重量。'
      : '自定义计划：动作间保持均匀呼吸，注意核心收紧，量力而行。',
    loop: 1,
    exercises: items.map(function (item) { return item.exercise }),
    updatedAt: Number(stored.updatedAt || 0)
  }
}

// 某场景的自定义计划，没有（或动作全下架了）返回 null
function get(scene) {
  return decorate(getStore().plans[scene])
}

// 只认 custom_ 开头的 id，其余交给内置计划库
function getById(id) {
  if (typeof id !== 'string' || id.indexOf(ID_PREFIX) !== 0) return null
  return get(id.slice(ID_PREFIX.length))
}

// 统一计划解析：自定义优先，回落内置计划库
function resolvePlan(id) {
  return getById(id) || plansData.getPlan(id)
}

function has(scene) {
  return !!get(scene)
}

function customSceneNames() {
  return SCENES.filter(function (scene) { return has(scene) })
    .map(function (scene) { return plansData.sceneName(scene) })
}

function listByScene(scene) {
  const plan = get(scene)
  return plan ? [plan] : []
}

function save(scene, data) {
  if (SCENES.indexOf(scene) < 0) return null
  const next = getStore()
  const now = Date.now()
  next.plans[scene] = {
    name: String((data && data.name) || '').trim(),
    scene: scene,
    exercises: normalizeExercises(data && data.exercises),
    updatedAt: now
  }
  next.updatedAt = now
  saveStore(next)
  return get(scene)
}

// 登出清空本机数据：云端保留，重新登录按账号拉回
function resetLocal() {
  saveStore(emptyStore())
}

function localTs() {
  return getStore().updatedAt
}

function writeTs(ts) {
  const current = getStore()
  current.updatedAt = ts
  saveStore(current)
}

function pushToCloud() {
  const pushed = getStore()
  return cloud.call('login', 'cpSet', { customPlans: { plans: pushed.plans, updatedAt: pushed.updatedAt } }).then(function (res) {
    if (!res.ok || !res.customPlans) return false
    // 时间戳回写的理由与边界见 cloud.adoptServerTs；没带回服务器时间戳视为推送未生效
    return cloud.adoptServerTs(res, pushed.updatedAt, localTs, writeTs)
  })
}

// 按场景逐条比较 updatedAt（较新者胜），本地较新的场景自动补推；
// resolve { ok, changed }，changed 表示本地被云端覆盖
function mergeFromCloud(remoteCustom) {
  const remotePlans = (remoteCustom && typeof remoteCustom.plans === 'object') ? remoteCustom.plans : {}
  const current = getStore()
  const next = { plans: {}, updatedAt: current.updatedAt }
  let changed = false
  let dirty = false
  let needPush = false
  SCENES.forEach(function (scene) {
    const localPlan = current.plans[scene] || null
    const remotePlan = remotePlans[scene] || null
    const localPlanTs = localPlan ? Number(localPlan.updatedAt || 0) : 0
    const remoteTs = remotePlan ? Number(remotePlan.updatedAt || 0) : 0

    if (remotePlan && remoteTs > localPlanTs) {
      next.plans[scene] = remotePlan
      changed = true
      dirty = true
      return
    }
    if (localPlan) {
      next.plans[scene] = localPlan
      if (localPlanTs > remoteTs) needPush = true
    }
  })
  if (dirty) saveStore(next)
  if (!needPush) return Promise.resolve({ ok: true, changed: changed })
  return pushToCloud().then(function (ok) { return { ok: ok, changed: changed } })
}

module.exports = {
  get: get,
  defaultName: defaultName,
  resolvePlan: resolvePlan,
  customSceneNames: customSceneNames,
  listByScene: listByScene,
  save: save,
  resetLocal: resetLocal,
  pushToCloud: pushToCloud,
  mergeFromCloud: mergeFromCloud
}
