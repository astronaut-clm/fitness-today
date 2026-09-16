// 自定义训练计划：每个场景各一份，读取时装饰成与内置计划一致的结构供各页面复用；
// 登录后按 openid 与云端双向同步（按场景 updatedAt 收敛），换机可恢复。
// 删除借用训练记录的墓碑机制：本地留 deleted 墓碑直到推送云端成功，
// 推送失败的删除不会被云端旧数据拉回（下轮同步自动补推删除）。
const cloud = require('./cloud.js')
const actionsData = require('../data/actions.js')
const plansData = require('../data/plans.js')
const levelUtil = require('./level.js')
const storage = require('./storage.js')

const KEY = 'ft_custom_plans_v1'
// 自定义动作默认次数文案：编辑页表单与 normalizeExercises 兜底共用
const DEFAULT_REPS = '12次'

function emptyStore() {
  return { plans: {}, deleted: {}, updatedAt: 0 }
}

function getStore() {
  const raw = storage.read(KEY)
  if (!raw || typeof raw !== 'object') return emptyStore()
  return {
    plans: (raw.plans && typeof raw.plans === 'object') ? raw.plans : {},
    deleted: (raw.deleted && typeof raw.deleted === 'object') ? raw.deleted : {},
    updatedAt: Number(raw.updatedAt || 0)
  }
}

function saveStore(store) {
  const safe = {
    plans: (store && store.plans) || {},
    deleted: (store && store.deleted) || {},
    updatedAt: Number((store && store.updatedAt) || 0)
  }
  storage.write(KEY, safe)
  return safe
}

// 组数钳制在 1-9：计划编辑页/详情页步进与计划归一化统一口径
function clampSets(v) {
  return Math.max(1, Math.min(9, Number(v) || 1))
}

// '30秒' → 30；非秒数文案（如 '12次'）返回 fallback
function parseSeconds(text, fallback) {
  const match = /^(\d+)\s*秒/.exec(String(text || '').trim())
  return match ? Number(match[1]) : fallback
}

// 动作列表归一化（组数/次数兜底），读取装饰与保存入口共用
function normalizeExercises(list) {
  return (list || []).map(function (ex) {
    return {
      actionId: ex.actionId,
      sets: clampSets(ex.sets),
      reps: String(ex.reps || '').trim() || DEFAULT_REPS,
      rest: ex.rest || ''
    }
  })
}

function estimate(exercises, scene) {
  const gym = scene === 'gym'
  const restPerSet = gym ? 60 : 30
  let workSeconds = 0
  let totalSets = 0
  let level = 1
  ;(exercises || []).forEach(function (ex) {
    const action = actionsData.getAction(ex.actionId)
    const sets = clampSets(ex.sets)
    totalSets += sets
    workSeconds += sets * parseSeconds(ex.reps, 40)
    if (action && levelUtil.LEVEL_MAP[action.level]) level = Math.max(level, levelUtil.LEVEL_MAP[action.level])
  })
  const restSeconds = Math.max(0, totalSets - 1) * restPerSet
  const duration = Math.max(5, Math.round((workSeconds + restSeconds) / 60))
  const calories = Math.round(duration * (gym ? 6 : 5))
  return { duration: duration, calories: calories, level: levelUtil.LEVEL_NAME[level] }
}

function planId(scene) {
  return 'custom_' + scene
}

// 自定义计划默认名：编辑页表单与 decorate 兜底共用
function defaultName(scene) {
  return scene === 'gym' ? '健身房专属' : '居家专属'
}

function decorate(stored) {
  if (!stored || !stored.scene) return null
  const exercises = normalizeExercises(stored.exercises)
    .filter(function (ex) { return !!actionsData.getAction(ex.actionId) })
  if (!exercises.length) return null

  const est = estimate(exercises, stored.scene)
  const categories = []
  exercises.forEach(function (ex) {
    const action = actionsData.getAction(ex.actionId)
    if (action && categories.indexOf(action.category) < 0) categories.push(action.category)
  })

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

// 统一计划解析：自定义优先，回落内置计划库
function resolvePlan(id) {
  return getById(id) || plansData.getPlan(id)
}

function has(scene) {
  return !!get(scene)
}

// 已设置自定义计划的场景名列表（如 ['居家', '健身房']），设置页/引导页提示文案共用
function customSceneNames() {
  const names = []
  if (has('home')) names.push('居家')
  if (has('gym')) names.push('健身房')
  return names
}

// 某场景的自定义计划列表（0 或 1 个）
function listByScene(scene) {
  const plan = get(scene)
  return plan ? [plan] : []
}

function save(scene, data) {
  if (scene !== 'home' && scene !== 'gym') return null
  const store = getStore()
  store.plans[scene] = {
    name: String((data && data.name) || '').trim(),
    scene: scene,
    exercises: normalizeExercises(data && data.exercises),
    updatedAt: Date.now()
  }
  delete store.deleted[scene] // 重新创建：对应场景的删除墓碑失效
  store.updatedAt = Date.now()
  saveStore(store)
  return get(scene)
}

function remove(scene) {
  const store = getStore()
  delete store.plans[scene]
  // 墓碑（同 records 的 deletedAt）：推送成功前保留，云端旧数据不得把它拉回
  store.deleted[scene] = Date.now()
  store.updatedAt = Date.now()
  saveStore(store)
}

// 删除并推送云端（删除入口仅登录后可达，调用方保证已登录），编辑页/计划列表共用同一删除规则；
// resolve 表示云端是否已同步：false 时本地删除已生效，墓碑留待下轮同步补推
function removeAndSync(scene) {
  remove(scene)
  return pushToCloud().then(function (ok) { return !!ok })
}

// 登出清空本机数据（含墓碑，与训练记录同一语义）：云端数据保留，重新登录按账号拉回
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

// 推送成功后以服务器时间回写本地 updatedAt：云函数 cpSet 用服务器时钟覆盖时间戳，
// 本地若保留客户端时钟，两端偏差会导致「云端较新」误判，已删除的计划可能被拉回。
// 推送成功同时清除删除墓碑（同 records 的 purgeDeleted：删除已同步，无需再防拉回）。
function pushToCloud() {
  const store = getStore()
  return cloud.call('cpSet', { customPlans: { plans: store.plans, updatedAt: store.updatedAt } }).then(function (res) {
    if (!res || !res.ok) return false
    const serverTs = Number(res.updatedAt || 0)
    const current = getStore()
    // 推送期间产生了新的本地改动时跳过回写，留待下一轮推送收敛
    if (Number(current.updatedAt || 0) === Number(store.updatedAt || 0)) {
      current.deleted = {}
      if (serverTs > 0) current.updatedAt = serverTs
      saveStore(current)
    }
    return true
  })
}

// 与云端数据按场景逐条收敛（训练记录同款：逐条比较 updatedAt，较新者胜，删除墓碑参与比较）。
// 逐场景用客户端保存的 plan.updatedAt 与墓碑比较，规避整体时间戳的服务器/客户端时钟偏差。
// remoteCustom: { plans, updatedAt }；resolve { ok, changed }，changed 表示本地可见数据被云端覆盖
function mergeFromCloud(remoteCustom) {
  const remotePlans = (remoteCustom && typeof remoteCustom.plans === 'object') ? remoteCustom.plans : {}
  const store = getStore()
  const next = { plans: {}, deleted: {}, updatedAt: store.updatedAt }
  let changed = false // 本地可见数据被云端覆盖（页面据此刷新）
  let dirty = false   // 本地存储需落盘（含墓碑失效清理）
  let needPush = false
  ;['home', 'gym'].forEach(function (scene) {
    const localPlan = store.plans[scene] || null
    const remotePlan = remotePlans[scene] || null
    const localTs = localPlan ? Number(localPlan.updatedAt || 0) : 0
    const remoteTs = remotePlan ? Number(remotePlan.updatedAt || 0) : 0
    const tombTs = Number(store.deleted[scene] || 0)

    if (remotePlan && remoteTs > localTs && remoteTs > tombTs) {
      // 云端较新（含本地删除后他端重新创建）：以云端为准，本地墓碑失效
      next.plans[scene] = remotePlan
      changed = true
      dirty = true
      return
    }
    if (localPlan) {
      next.plans[scene] = localPlan
      if (localTs > remoteTs) needPush = true
      return
    }
    // 删除墓碑：云端还有副本则保留墓碑并推送清除；云端已无副本则删除已生效，墓碑清账
    if (tombTs > 0) {
      if (remotePlan) {
        next.deleted[scene] = tombTs
        needPush = true
      } else {
        dirty = true
      }
    }
  })
  if (dirty) saveStore(next)
  if (!needPush) return Promise.resolve({ ok: true, changed: changed })
  return pushToCloud().then(function (ok) { return { ok: ok, changed: changed } })
}

// 双向收敛（调用方需保证已登录）：拉取后按场景合并，本地较新的场景（含删除墓碑）自动补推
function syncFromCloud() {
  return pullFromCloud().then(function (remote) {
    if (!remote || !remote.ok) return { ok: false, changed: false }
    return mergeFromCloud(remote.data)
  })
}

module.exports = {
  DEFAULT_REPS: DEFAULT_REPS,
  get: get,
  defaultName: defaultName,
  getById: getById,
  resolvePlan: resolvePlan,
  has: has,
  customSceneNames: customSceneNames,
  listByScene: listByScene,
  save: save,
  clampSets: clampSets,
  parseSeconds: parseSeconds,
  removeAndSync: removeAndSync,
  resetLocal: resetLocal,
  pushToCloud: pushToCloud,
  mergeFromCloud: mergeFromCloud,
  syncFromCloud: syncFromCloud
}
