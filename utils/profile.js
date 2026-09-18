// 训练偏好：本机存储，登录后与云端按 updatedAt 收敛（一次 userGet 连自定义计划一起拉回）
const cloud = require('./cloud.js')
const account = require('./account.js')
const customPlans = require('./custom-plans.js')
const plansData = require('../databases/plans.js')
const storage = require('./storage.js')
const throttle = require('./throttle.js')

// 引导「已看过」标记在 utils/login.js 里管
const store = storage.scoped('ft_user_profile_v1')

// insights 与表单页共用一份，避免同一数字散落多处
const DEFAULT_WEEKLY_TARGET = { days: 3, minutes: 90 }

const defaults = {
  goal: '',
  scenes: [],
  experience: plansData.LEVELS[0],
  equipment: [],
  weeklyTargetDays: DEFAULT_WEEKLY_TARGET.days,
  weeklyTargetMinutes: DEFAULT_WEEKLY_TARGET.minutes,
  updatedAt: 0
}

const goals = [
  { value: 'fat_loss', name: '减脂塑形', desc: '优先安排轻量高效训练' },
  { value: 'muscle_gain', name: '增肌增重', desc: '优先安排力量训练' }
]
const equipment = [
  { value: 'none', name: '徒手' },
  { value: 'dumbbell', name: '哑铃' },
  { value: 'gym', name: '健身房器械' }
]

function withSelected(list, values) {
  const selected = {}
  ;(values || []).forEach(function (value) { selected[value] = true })
  return list.map(function (item) {
    return Object.assign({}, item, { selected: !!selected[item.value] })
  })
}

function buildView(current) {
  const p = current || {}
  return {
    goals: goals.map(function (item) { return Object.assign({}, item, { selected: p.goal === item.value }) }),
    scenes: withSelected(plansData.scenes, p.scenes),
    experiences: plansData.LEVELS.map(function (name) { return { name: name, selected: name === p.experience } }),
    equipment: withSelected(equipment, p.equipment),
    weeklyTargetDays: p.weeklyTargetDays,
    weeklyTargetMinutes: p.weeklyTargetMinutes
  }
}

function fillDefaults(src) {
  const saved = (src && typeof src === 'object') ? src : {}
  const profile = {}
  Object.keys(defaults).forEach(function (key) {
    const value = saved[key] == null ? defaults[key] : saved[key]
    // 数组要拷一份，否则调用方改返回值会污染模块级 defaults
    profile[key] = Array.isArray(value) ? value.slice() : value
  })
  return profile
}

function get() {
  return fillDefaults(store.read({}))
}

function save(patch) {
  const next = get()
  Object.keys(patch || {}).forEach(function (key) {
    if (key !== 'updatedAt') next[key] = patch[key]
  })
  next.updatedAt = Date.now()
  store.write(next)
  return next
}

function completed(profile) {
  const p = profile || get()
  return !!((p.scenes && p.scenes.length) || (p.equipment && p.equipment.length) || p.updatedAt)
}

function localTs() {
  return Number(get().updatedAt || 0)
}

function writeTs(ts) {
  const current = get()
  current.updatedAt = ts
  store.write(current)
}

function pushToCloud() {
  const p = get()
  return cloud.call('login', 'prefsSet', {
    prefs: {
      goal: p.goal,
      scenes: p.scenes,
      equipment: p.equipment,
      experience: p.experience,
      weeklyTargetDays: p.weeklyTargetDays,
      weeklyTargetMinutes: p.weeklyTargetMinutes
    }
  }).then(function (res) {
    if (!res.ok) return false
    // 回写理由见 cloud.adoptServerTs；没带回服务器时间戳也算推送成功
    cloud.adoptServerTs(res, p.updatedAt, localTs, writeTs)
    return true
  })
}

function applyFromCloud(prefs) {
  const next = fillDefaults(prefs)
  store.write(next)
  return next
}

// 双向收敛（需已登录）：偏好与自定义计划各按 updatedAt 较新者胜，本机较新的补传。
// changed 表示本地被云端覆盖。plan-adjustments 只存本机，不参与同步
function syncFromCloud() {
  return account.readCloud().then(function (res) {
    if (!res) return { ok: false, changed: false }
    // 与 fetchProfile 共享同一次 userGet，那边可能已判定「账号不存在」并登出。
    // 此时禁止回填或补推，否则删号后又把本机数据写回云端
    if (!account.isLoggedIn()) return { ok: false, changed: false }
    let changed = false
    const pushTasks = []

    const remotePrefs = (res.prefs && typeof res.prefs === 'object') ? res.prefs : {}
    const remotePrefsTs = Number(remotePrefs.updatedAt || 0)
    const ts = localTs()
    if (remotePrefsTs !== 0 || ts !== 0) {
      if (remotePrefsTs > ts) {
        applyFromCloud(remotePrefs)
        changed = true
      } else if (ts > remotePrefsTs) {
        pushTasks.push(pushToCloud())
      }
    }

    const remoteCustom = (res.customPlans && typeof res.customPlans === 'object') ? res.customPlans : {}
    const customTask = customPlans.mergeFromCloud(remoteCustom).then(function (r) {
      if (r && r.changed) changed = true
      return !!(r && r.ok)
    })

    return Promise.all(pushTasks.concat([customTask])).then(function (results) {
      const ok = results.every(function (item) { return !!item })
      return { ok: ok, changed: changed }
    })
  }).catch(function (err) {
    // 别冒泡成未处理 rejection，按失败处理、下一轮 onShow 再收敛
    console.error('[profile] syncFromCloud', err)
    return { ok: false, changed: false }
  })
}

// 页面级同步入口，限频与失败重试都收在这里，免得每个调用页各写一份水位。
// opts: key（限频基准点挂在 page 上的属性名）/ force / interval / onChange(res)
// resolve 本次是否同步成功；未登录与被限频都返回 false，不算错误
const SYNC_INTERVAL = 30000

function syncPull(page, opts) {
  const options = opts || {}
  const key = options.key || '_lastPrefsSyncAt'
  if (!account.isLoggedIn()) return Promise.resolve(false)
  if (!options.force && !throttle.pass(page, key, options.interval || SYNC_INTERVAL)) return Promise.resolve(false)
  return syncFromCloud().then(function (res) {
    if (!res || !res.ok) {
      // 失败不留水位，下次 onShow 可立即重试
      throttle.reset(page, key)
      return false
    }
    if (res.changed && typeof options.onChange === 'function') options.onChange(res)
    return true
  })
}

// 登出清空本机偏好；云端保留，重登后按账号拉回
function resetLocal() {
  const next = fillDefaults(null)
  next.updatedAt = 0
  store.write(next)
  return next
}

module.exports = {
  DEFAULT_WEEKLY_TARGET: DEFAULT_WEEKLY_TARGET,
  get: get,
  save: save,
  completed: completed,
  buildView: buildView,
  resetLocal: resetLocal,
  pushToCloud: pushToCloud,
  syncFromCloud: syncFromCloud,
  syncPull: syncPull
}
