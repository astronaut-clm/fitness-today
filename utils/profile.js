// 用户偏好配置与目标：本机存储，登录后按 openid 与云端双向同步，updatedAt 收敛
const cloud = require('./cloud.js')
const customPlans = require('./custom-plans.js')

const KEY = 'ft_user_profile_v1'

const defaults = {
  version: 1,
  goal: '',
  scenes: [],
  experience: '初级',
  equipment: [],
  weeklyTargetDays: 3,
  weeklyTargetMinutes: 90,
  updatedAt: 0
}

// 偏好选项与表单项：个人设置页与引导页共用
const goals = [
  { value: 'fat_loss', name: '减脂塑形', desc: '优先安排轻量高效训练' },
  { value: 'muscle_gain', name: '增肌增重', desc: '优先安排力量训练' }
]
const scenes = [
  { value: 'home', name: '居家' },
  { value: 'gym', name: '健身房' }
]
const experiences = ['初级', '中级', '高级']
const equipment = [
  { value: 'none', name: '徒手' },
  { value: 'dumbbell', name: '哑铃' },
  { value: 'gym', name: '健身房器械' }
]

function selectedMap(values) {
  const map = {}
  ;(values || []).forEach(function (value) { map[value] = true })
  return map
}

function withSelected(list, values) {
  const selected = selectedMap(values)
  return list.map(function (item) {
    return Object.assign({}, item, { selected: !!selected[item.value] })
  })
}

function buildView(current) {
  const p = current || {}
  return {
    goals: goals.map(function (item) { return Object.assign({}, item, { selected: p.goal === item.value }) }),
    scenes: withSelected(scenes, p.scenes),
    experiences: experiences.map(function (name) { return { name: name, selected: name === p.experience } }),
    equipment: withSelected(equipment, p.equipment),
    weeklyTargetDays: p.weeklyTargetDays,
    weeklyTargetMinutes: p.weeklyTargetMinutes
  }
}

function get() {
  let saved = {}
  try { saved = wx.getStorageSync(KEY) || {} } catch (e) {}
  const profile = {}
  Object.keys(defaults).forEach(function (key) {
    profile[key] = saved[key] == null ? defaults[key] : saved[key]
  })
  return profile
}

function save(patch) {
  const next = get()
  Object.keys(patch || {}).forEach(function (key) {
    if (key !== 'version' && key !== 'updatedAt') next[key] = patch[key]
  })
  next.updatedAt = Date.now()
  try { wx.setStorageSync(KEY, next) } catch (e) {}
  return next
}

function completed(profile) {
  const p = profile || get()
  return !!((p.scenes && p.scenes.length) || (p.equipment && p.equipment.length) || p.updatedAt)
}

// 从云端取回偏好（无记录时 updatedAt=0）
function pullFromCloud() {
  return cloud.call('prefsGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, prefs: null }
    const prefs = (res.prefs && typeof res.prefs === 'object') ? res.prefs : {}
    return { ok: true, prefs: prefs, updatedAt: Number(prefs.updatedAt || 0) }
  })
}

function pushToCloud() {
  const p = get()
  const payload = {
    goal: p.goal,
    scenes: p.scenes,
    equipment: p.equipment,
    experience: p.experience,
    weeklyTargetDays: p.weeklyTargetDays,
    weeklyTargetMinutes: p.weeklyTargetMinutes
  }
  return cloud.call('prefsSet', { prefs: payload }).then(function (res) {
    return !!(res && res.ok)
  })
}

function applyFromCloud(prefs) {
  const src = (prefs && typeof prefs === 'object') ? prefs : {}
  const next = {}
  Object.keys(defaults).forEach(function (key) {
    next[key] = src[key] == null ? defaults[key] : src[key]
  })
  try { wx.setStorageSync(KEY, next) } catch (e) {}
  return next
}

// 双向收敛（调用方需保证已登录）：云端较新则覆盖本地，本地较新则上传；changed 表示本地被云端覆盖
function syncFromCloud() {
  return pullFromCloud().then(function (remote) {
    if (!remote || !remote.ok) return { ok: false, changed: false }
    const local = get()
    const remoteTs = remote.updatedAt
    const localTs = Number(local.updatedAt || 0)
    if (remoteTs === 0 && localTs === 0) return { ok: true, changed: false }
    if (remoteTs > localTs) {
      applyFromCloud(remote.prefs)
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

// 偏好 + 自定义计划一次往返收敛（userGet 一次取回）；本机较新的一方各自补传。
// 注意：个人计划调整仅存本机，不参与同步。
function syncFromCloudAll() {
  return cloud.call('userGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, changed: false }
    let changed = false
    const pushTasks = []

    const remotePrefs = (res.prefs && typeof res.prefs === 'object') ? res.prefs : {}
    const remotePrefsTs = Number(remotePrefs.updatedAt || 0)
    const localPrefs = get()
    const localPrefsTs = Number(localPrefs.updatedAt || 0)
    if (remotePrefsTs !== 0 || localPrefsTs !== 0) {
      if (remotePrefsTs > localPrefsTs) {
        applyFromCloud(remotePrefs)
        changed = true
      } else if (localPrefsTs > remotePrefsTs) {
        pushTasks.push(pushToCloud())
      }
    }

    const remoteCustom = (res.customPlans && typeof res.customPlans === 'object') ? res.customPlans : {}
    const remoteCustomTs = Number(remoteCustom.updatedAt || 0)
    const localCustomTs = Number(customPlans.getStore().updatedAt || 0)
    if (remoteCustomTs !== 0 || localCustomTs !== 0) {
      if (remoteCustomTs > localCustomTs) {
        customPlans.applyFromCloud(remoteCustom)
        changed = true
      } else if (localCustomTs > remoteCustomTs) {
        pushTasks.push(customPlans.pushToCloud())
      }
    }

    return Promise.all(pushTasks).then(function (results) {
      const ok = pushTasks.length ? results.every(function (item) { return !!item }) : true
      return { ok: ok, changed: changed }
    })
  })
}

// 退出登录时清空本机偏好（云端保留，重新登录后按账号拉回）
function resetLocal() {
  const next = {}
  Object.keys(defaults).forEach(function (key) { next[key] = defaults[key] })
  next.updatedAt = 0
  try { wx.setStorageSync(KEY, next) } catch (e) {}
  return next
}

module.exports = {
  get: get,
  save: save,
  completed: completed,
  buildView: buildView,
  resetLocal: resetLocal,
  pushToCloud: pushToCloud,
  syncFromCloud: syncFromCloud,
  syncFromCloudAll: syncFromCloudAll
}
