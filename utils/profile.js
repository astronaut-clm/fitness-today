// utils/profile.js 用户偏好配置与目标
// 偏好平时保存在本机；登录后可与云端（login 云函数写 ft_users 的 prefs 字段）按 openid 双向同步，
// 换设备登录可自动恢复，多端以 updatedAt 时间戳收敛。
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

// 从云端取回偏好配置（云端无记录时返回默认值，updatedAt = 0）。
function pullFromCloud() {
  return cloud.call('prefsGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, prefs: null }
    const prefs = (res.prefs && typeof res.prefs === 'object') ? res.prefs : {}
    return { ok: true, prefs: prefs, updatedAt: Number(prefs.updatedAt || 0) }
  })
}

// 把本机偏好上传云端（由 login 云函数落库并刷新 updatedAt）。
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

// 用云端内容整体覆盖本地偏好（字段缺失回落到默认值）。
function applyFromCloud(prefs) {
  const src = (prefs && typeof prefs === 'object') ? prefs : {}
  const next = {}
  Object.keys(defaults).forEach(function (key) {
    next[key] = src[key] == null ? defaults[key] : src[key]
  })
  try { wx.setStorageSync(KEY, next) } catch (e) {}
  return next
}

// 双向收敛（调用方需保证已登录）：
// - 云端无记录且本地也未保存过：什么都不做
// - 云端较新：拉取覆盖本地（换机 / 他端改动恢复）
// - 本地较新：本地上传（首次启用云端 / 刚改过未同步）
// 返回 { ok, changed }，changed 表示本次本机偏好被云端覆盖。
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

// 偏好 + 自定义计划的一次往返收敛（checkin 页 onShow / 登录成功后调用）。
// 两字段同存于 ft_users，userGet 一次返回，比分别 syncFromCloud 少云函数请求；
// 本机较新的一方仍各自 push 补传，两端同为空或相同时不产生写入。
// 注意：个人计划调整仅存本机，不参与云端同步。
function syncFromCloudAll() {
  return cloud.call('userGet').then(function (res) {
    if (!res || !res.ok) return { ok: false, changed: false }
    let changed = false
    const pushTasks = []

    // —— 训练偏好 ——
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

    // —— 自定义计划 ——
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

// 退出登录时清空本机偏好（云端保留，重新登录后按账号拉回），避免下一账号误用/误推上一账号的配置。
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
  resetLocal: resetLocal,
  pushToCloud: pushToCloud,
  syncFromCloud: syncFromCloud,
  syncFromCloudAll: syncFromCloudAll
}
