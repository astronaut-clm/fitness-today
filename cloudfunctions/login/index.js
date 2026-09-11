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

// 训练偏好清洗：字段齐全、类型收敛，缺失时回落到默认值。
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

// 自定义计划清洗：仅允许 home / gym 两个场景，各限 30 个动作与 sets 取值范围。
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

// 是否属于当前用户的云头像文件：按 avatars/{openid}/ 目录前缀判定，避免误删他人或其他用途文件。
function isOwnAvatar(fileID, openid) {
  if (typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) return false
  return fileID.indexOf('/avatars/' + openid + '/') >= 0
}

// 字段级写入：只更新指定字段，避免并发整篇覆盖导致其他字段丢失。
// doc.update 对不存在的文档不抛错（stats.updated 为 0），此时补建一份最小文档；
// 若确认已存在（或读取失败）则保守跳过，绝不整篇覆盖已有数据。
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
  if (!OPENID) return { openid: '' }

  // 个人设置（头像昵称）：按 openid 精确读写，天然按用户隔离。
  // 训练偏好随资料同文档存储（prefs 字段），读写都只作用于自己的账号。
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
    // 先取旧头像用于替换清理；写入只作用于昵称/头像字段，保留训练偏好等其他字段，
    // 避免与并发的偏好写入互相整篇覆盖。
    const old = await db.collection(COL_USERS).doc(OPENID).get().catch(function () { return { data: {} } })
    const oldDoc = (old && old.data) || {}
    const prevAvatar = cleanText(oldDoc.avatar, 200)
    const nextAvatar = cleanText(incoming.avatar, 200)
    const nickname = cleanText(incoming.nickname, 30)
    await writeFields(OPENID, { nickname: nickname, avatar: nextAvatar, updatedAt: now })
    // 头像硬约束：同一 openid 只保留一个头像文件。
    // 新头像落库成功后删除被替换的旧头像文件；即使客户端没删 / 老版本客户端，服务端也会兜底清理。
    if (prevAvatar && nextAvatar && prevAvatar !== nextAvatar && isOwnAvatar(prevAvatar, OPENID)) {
      await cloud.deleteFile({ fileList: [prevAvatar] }).catch(function () {})
    }
    return { openid: OPENID, nickname: nickname, avatar: nextAvatar, prefs: cleanPrefs(oldDoc.prefs), updatedAt: now }
  }

  // 偏好 + 自定义计划一次取回：同存于 ft_users，供 checkin 页一次往返完成双向收敛。
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

  // 数据自愈（幂等兜底）：把当前 openid 的历史遗留重复文档收敛为唯一一份。
  // 正常写入路径都使用 doc(_id = openid) 定点写入，不会产生重复；
  // 此动作仅用于修复早期控制台/调试误建的多余文档：头像昵称取整篇最新，
  // 偏好与自定义计划各自取最新一份，多余文档及其引用的头像文件一并清理。
  if (action === 'selfRepair') {
    const summary = { openid: OPENID, userDocs: 0, avatarCleaned: 0 }

    const removeAvatar = async function (fileID) {
      if (!isOwnAvatar(fileID, OPENID)) return
      try {
        await cloud.deleteFile({ fileList: [fileID] })
        summary.avatarCleaned++
      } catch (e) {}
    }

    const newestOf = function (rows, field) {
      let best = null
      rows.forEach(function (row) {
        const val = row && row[field]
        if (val && (!best || Number(val.updatedAt || 0) > Number(best.updatedAt || 0))) best = val
      })
      return best
    }

    // —— ft_users：同一 openid 仅保留 doc(openid) 这一份 ——
    const usersRes = await db.collection(COL_USERS).where({ openid: OPENID }).limit(100).get().catch(function () { return { data: [] } })
    const users = (usersRes && usersRes.data) || []
    const needUserFix = users.length > 0 && (users.length !== 1 || users[0]._id !== OPENID)
    if (needUserFix) {
      const sorted = users.slice().sort(function (a, b) { return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) })
      const newest = sorted[0]
      const mergedPrefs = newestOf(users, 'prefs')
      const mergedCustom = newestOf(users, 'customPlans')
      const data = {
        openid: OPENID,
        nickname: cleanText(newest.nickname, 30),
        avatar: cleanText(newest.avatar, 200),
        prefs: cleanPrefs(mergedPrefs || newest.prefs),
        customPlans: cleanCustomPlans(mergedCustom || newest.customPlans),
        updatedAt: Math.max(Number(newest.updatedAt || 0), Date.now())
      }
      await db.collection(COL_USERS).doc(OPENID).set({ data: data })
      const others = users.filter(function (doc) { return doc._id !== OPENID })
      for (const doc of others) {
        if (cleanText(doc.avatar, 200) !== data.avatar) await removeAvatar(doc.avatar)
        await db.collection(COL_USERS).doc(doc._id).remove().catch(function () {})
        summary.userDocs++
      }
    }

    return summary
  }

  return { openid: OPENID }
}
