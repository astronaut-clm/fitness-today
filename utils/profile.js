// 训练偏好：本机存储，登录后与云端按 updatedAt 收敛（userGet 一次往返含自定义计划）
const cloud = require('./cloud.js')
const account = require('./account.js')
const customPlans = require('./custom-plans.js')
const plansData = require('../databases/plans.js')
const storage = require('./storage.js')
const throttle = require('./throttle.js')

// 引导已完成标记在 utils/login.js 里管（同一 key 只在那里定义一次）
const store = storage.scoped('ft_user_profile_v1')

// 周目标默认值：insights / 表单页等共用一份，避免同一数字散落多处
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
    // 数组默认值拷一份，别把模块级 defaults 的引用暴露给调用方（外部 slice 后修改会污染默认值）
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
    // 时间戳回写的理由与边界见 cloud.adoptServerTs；没带回服务器时间戳也算推送成功
    cloud.adoptServerTs(res, p.updatedAt, localTs, writeTs)
    return true
  })
}

function applyFromCloud(prefs) {
  const next = fillDefaults(prefs)
  store.write(next)
  return next
}

// 双向收敛（需已登录）：偏好与自定义计划各按 updatedAt 较新者胜，本机较新的一方补传；
// changed 表示本地被云端覆盖。计划调整（plan-adjustments）仅存本机，不参与同步。
// 走 account.readCloud 的 userGet 单飞：打卡页会同时触发资料刷新与偏好同步，合并成一次云调用
function syncFromCloud() {
  return account.readCloud().then(function (res) {
    if (!res) return { ok: false, changed: false }
    // fetchProfile 与本函数共享同一次 userGet：可能已被判定「账号不存在」并登出，
    // 此时禁止回填或补推，否则会在删号后把本机数据重新写回云端
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
    // 网络/存储异常不应冒泡为未处理 rejection；按失败处理，下一轮 onShow 再收敛
    console.error('[profile] syncFromCloud', err)
    return { ok: false, changed: false }
  })
}

// 页面级同步入口：一次 userGet 拉回偏好与自定义计划，云端有变更回调 onChange 刷新本页。
// 限频窗口与失败重试策略收在这里，避免每个调用页各写一份 30 秒水位。
// pull(page, opts)
//   opts.key      限频基准点挂在 page 上的属性名（每个页面各自一个，互不干扰）
//   opts.force    忽略限频，常用于下拉刷新
//   opts.interval 覆盖默认窗口（默认 30 秒，避免频繁切页重复请求）
//   opts.onChange(res) 云端确实有变更（res.changed）时回调刷新本页视图
// 返回 Promise<boolean>：本次是否同步成功；未登录 / 被限频都按「未同步」返回 false，不是错误
const SYNC_INTERVAL = 30000

function syncPull(page, opts) {
  const options = opts || {}
  const key = options.key || '_lastPrefsSyncAt'
  if (!account.isLoggedIn()) return Promise.resolve(false)
  if (!options.force && !throttle.pass(page, key, options.interval || SYNC_INTERVAL)) return Promise.resolve(false)
  return syncFromCloud().then(function (res) {
    if (!res || !res.ok) {
      // 失败不留水位，下次 onShow 可以立即重试
      throttle.reset(page, key)
      return false
    }
    if (res.changed && typeof options.onChange === 'function') options.onChange(res)
    return true
  })
}

// 退出登录时清空本机偏好（云端保留，重新登录后按账号拉回）
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
