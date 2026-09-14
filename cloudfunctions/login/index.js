// 云函数 login：返回 openid，并维护个人设置（头像昵称+训练偏好）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COL_USERS = 'ft_users'

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function cleanList(value) {
  const list = Array.isArray(value) ? value : []
  return list.map(function (item) { return cleanText(item, 30) }).filter(Boolean).slice(0, 10)
}

function clampNum(value, min, max, fallback) {
  const num = Number(value)
  if (isNaN(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function cleanPrefs(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {}
  return {
    goal: cleanText(p.goal, 30),
    scenes: cleanList(p.scenes),
    experience: cleanText(p.experience, 10),
    equipment: cleanList(p.equipment),
    weeklyTargetDays: clampNum(p.weeklyTargetDays, 1, 7, 3),
    weeklyTargetMinutes: clampNum(p.weeklyTargetMinutes, 10, 1200, 90),
    updatedAt: Number(p.updatedAt || 0)
  }
}

// 清洗自定义计划：仅 home / gym 场景，各限 30 个动作。
function cleanCustomPlans(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {}
  const srcPlans = (src.plans && typeof src.plans === 'object') ? src.plans : {}
  const plans = {}
  Object.keys(srcPlans).forEach(function (scene) {
    if (scene !== 'home' && scene !== 'gym') return
    const plan = (srcPlans[scene] && typeof srcPlans[scene] === 'object') ? srcPlans[scene] : {}
    const srcEx = Array.isArray(plan.exercises) ? plan.exercises : []
    const exercises = []
    srcEx.forEach(function (ex) {
      if (exercises.length >= 30) return
      const item = (ex && typeof ex === 'object') ? ex : {}
      const actionId = cleanText(item.actionId, 40)
      if (!actionId) return
      exercises.push({
        actionId: actionId,
        sets: clampNum(item.sets, 1, 9, 1),
        reps: cleanText(item.reps, 20) || '12次',
        rest: cleanText(item.rest, 20)
      })
    })
    if (!exercises.length) return
    plans[scene] = {
      name: cleanText(plan.name, 30),
      scene: scene,
      exercises: exercises,
      updatedAt: Number(plan.updatedAt || 0)
    }
  })
  return { plans: plans, updatedAt: Number(src.updatedAt || 0) }
}

// 字段级写入：只更新指定字段，避免并发整篇覆盖；文档不存在时补建最小文档，已存在则保守跳过。
async function writeFields(openid, fields) {
  const col = db.collection(COL_USERS)
  const res = await col.doc(openid).update({ data: fields }).catch(function () { return null })
  if (res && res.stats && res.stats.updated > 0) return
  const found = await col.where({ openid: openid }).limit(1).get().catch(function () { return null })
  if (!found || (found.data && found.data.length)) return
  await col.doc(openid).set({
    data: Object.assign({
      openid: openid,
      nickname: '',
      avatar: '',
      prefs: cleanPrefs({}),
      customPlans: cleanCustomPlans({}),
      updatedAt: Date.now()
    }, fields)
  }).catch(function () {})
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID || ''
  const action = event && event.action

  if (!action || action === 'openid') return { openid: OPENID }

  // 换取云存储临时 https 链接：服务端管理员 token 可绕过「仅创建者可读写」规则，
  // 供用户头像等云端资源使用；入参 fileList，返回每项 tempFileURL，限 20 个
  if (action === 'fileUrl') {
    const list = Array.isArray(event.fileList) ? event.fileList.slice(0, 20) : []
    const r = await cloud.getTempFileURL({ fileList: list }).catch(function () { return { fileList: [] } })
    return {
      openid: OPENID,
      fileList: ((r && r.fileList) || []).map(function (item) {
        return {
          fileID: (item && item.fileID) || '',
          tempFileURL: (item && item.tempFileURL) || '',
          status: item && item.status
        }
      })
    }
  }

  if (!OPENID) return { openid: '' }

  // 个人设置按 openid 精确读写，天然按用户隔离。
  if (action === 'profile') {
    const r = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: null } })
    const doc = (r && r.data) || {}
    return {
      openid: OPENID,
      nickname: cleanText(doc.nickname, 30),
      avatar: cleanText(doc.avatar, 200),
      prefs: cleanPrefs(doc.prefs),
      updatedAt: Number(doc.updatedAt || 0)
    }
  }

  if (action === 'profileSet') {
    const incoming = (event && event.profile) || {}
    const now = Date.now()
    // 先读旧文档以在返回中保留偏好，写入只作用于昵称/头像字段。
    const old = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: {} } })
    const oldDoc = (old && old.data) || {}
    const nextAvatar = cleanText(incoming.avatar, 200)
    const nickname = cleanText(incoming.nickname, 30)
    await writeFields(OPENID, { nickname: nickname, avatar: nextAvatar, updatedAt: now })
    return { openid: OPENID, nickname: nickname, avatar: nextAvatar, prefs: cleanPrefs(oldDoc.prefs), updatedAt: now }
  }

  // 偏好 + 自定义计划一次取回，供 checkin 页一次往返完成双向收敛。
  if (action === 'userGet') {
    const r = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: null } })
    const doc = (r && r.data) || {}
    return {
      openid: OPENID,
      prefs: cleanPrefs(doc.prefs),
      customPlans: cleanCustomPlans(doc.customPlans)
    }
  }

  // 训练偏好云端读写：独立动作，互不覆盖头像昵称。
  if (action === 'prefsGet') {
    const r = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: null } })
    const doc = (r && r.data) || {}
    return { openid: OPENID, prefs: cleanPrefs(doc.prefs) }
  }

  if (action === 'prefsSet') {
    const now = Date.now()
    const prefs = cleanPrefs((event && event.prefs) || {})
    prefs.updatedAt = now
    // 只写偏好字段，保留头像昵称与自定义计划，避免并发整篇覆盖。
    await writeFields(OPENID, { prefs: prefs, updatedAt: now })
    return { openid: OPENID, prefs: prefs, updatedAt: now }
  }

  // 自定义计划云端读写：独立动作，与头像昵称、训练偏好互不覆盖。
  if (action === 'cpGet') {
    const r = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: null } })
    const doc = (r && r.data) || {}
    return { openid: OPENID, customPlans: cleanCustomPlans(doc.customPlans) }
  }

  if (action === 'cpSet') {
    const now = Date.now()
    const cp = cleanCustomPlans((event && event.customPlans) || {})
    cp.updatedAt = now
    // 只写自定义计划字段，保留头像昵称与偏好，避免并发整篇覆盖。
    await writeFields(OPENID, { customPlans: cp, updatedAt: now })
    return { openid: OPENID, customPlans: cp, updatedAt: now }
  }

  return { openid: OPENID }
}
