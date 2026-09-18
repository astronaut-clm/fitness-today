// 云函数 login：取 openid + 个人数据读写。ft_users 的 doc id 就是 openid，天然按用户隔离
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

// 自定义计划原样收发：字段边界只由客户端 exercise-item 收敛，云端不重复一套。
// 这里只保证外层信封是 { plans, updatedAt }
function customPlansOf(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {}
  return {
    plans: (src.plans && typeof src.plans === 'object') ? src.plans : {},
    updatedAt: Number(src.updatedAt || 0)
  }
}

// 字段级写入，避免并发整篇覆盖。返回 false 表示未落库，调用方必须回 ok:false
async function writeFields(openid, fields) {
  const col = db.collection(COL_USERS)
  const res = await col.doc(openid).update({ data: fields }).catch(function () { return null })
  if (res && res.stats && res.stats.updated > 0) return true
  // updated=0 也可能是「文档存在但内容没变」，只有确认不存在才整篇写，避免覆盖掉别的字段
  const count = await col.where({ _id: openid }).count().catch(function () { return null })
  if (count && count.total > 0) return !!(res && res.stats)
  if (!count) return false
  const created = await col.doc(openid).set({
    data: Object.assign({
      nickname: '',
      avatar: '',
      prefs: cleanPrefs({}),
      customPlans: customPlansOf({}),
      updatedAt: Date.now()
    }, fields)
  }).catch(function () { return null })
  return !!created
}

// fileID 批量换临时链接，用管理员权限绕过存储权限。限 20 个
async function fileUrl(openid, event) {
  const own = 'avatars/' + openid + '/'
  const list = (Array.isArray(event && event.fileList) ? event.fileList.slice(0, 20) : [])
    .filter(function (id) {
      return typeof id === 'string' && id.indexOf('cloud://') === 0 && id.indexOf(own) > 0
    })
  const r = await cloud.getTempFileURL({ fileList: list }).catch(function () { return { fileList: [] } })
  return {
    ok: true,
    fileList: ((r && r.fileList) || []).map(function (item) {
      return {
        fileID: (item && item.fileID) || '',
        tempFileURL: (item && item.tempFileURL) || '',
        status: item && item.status
      }
    })
  }
}

// 一次往返返回资料 + 偏好 + 自定义计划。exists 是「云端有没有这个用户」的唯一判据
async function userGet(openid) {
  const r = await db.collection(COL_USERS).where({ _id: openid }).limit(1).get().catch(function () { return null })
  if (!r) return { ok: false, code: 'server_error' }
  const doc = (r.data && r.data[0]) || {}
  return {
    ok: true,
    exists: !!(r.data && r.data[0]),
    nickname: cleanText(doc.nickname, 30),
    avatar: cleanText(doc.avatar, 200),
    prefs: cleanPrefs(doc.prefs),
    customPlans: customPlansOf(doc.customPlans),
    updatedAt: Number(doc.updatedAt || 0)
  }
}

// 三个写 action 的响应体恰好等于写入的字段，故统一由 writeAction 拼装。
// updatedAt 一律取服务器时钟，避免两端时钟偏差
async function writeAction(openid, fields) {
  if (!(await writeFields(openid, fields))) return { ok: false, code: 'write_failed' }
  return Object.assign({ ok: true }, fields)
}

function profileSet(openid, event) {
  const incoming = (event && event.profile) || {}
  return writeAction(openid, {
    nickname: cleanText(incoming.nickname, 30),
    avatar: cleanText(incoming.avatar, 200),
    updatedAt: Date.now()
  })
}

function prefsSet(openid, event) {
  const prefs = cleanPrefs((event && event.prefs) || {})
  prefs.updatedAt = Date.now()
  return writeAction(openid, { prefs: prefs, updatedAt: prefs.updatedAt })
}

function cpSet(openid, event) {
  const cp = customPlansOf((event && event.customPlans) || {})
  cp.updatedAt = Date.now()
  return writeAction(openid, { customPlans: cp, updatedAt: cp.updatedAt })
}

const HANDLERS = {
  fileUrl: fileUrl,
  userGet: userGet,
  profileSet: profileSet,
  prefsSet: prefsSet,
  cpSet: cpSet
}

// 响应契约：{ ok: true, ... } 或 { ok: false, code }。
// 新增 action 必须显式回 ok，否则客户端按失败处理
exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { ok: false, code: 'no_openid' }

  const action = (event && event.action) || 'openid'
  if (action === 'openid') return { ok: true, openid: openid }

  // hasOwnProperty 兜底，防 action 传 'constructor' 之类的原型链键
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, action) && HANDLERS[action]
  if (!handler) return { ok: false, code: 'unknown_action' }
  try {
    return await handler(openid, event)
  } catch (e) {
    console.error('[login] action failed', action, e && e.message)
    return { ok: false, code: 'server_error' }
  }
}
