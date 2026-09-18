// 云函数 login：openid 获取 + 个人数据读写（ft_users，doc id = openid，天然按用户隔离）
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

// 自定义计划原样收发：条目的字段边界只由客户端 utils/exercise-item.js 收敛，云端不再重复一套。
// 这里只保证外层信封是 { plans, updatedAt }——userGet 靠 updatedAt=0 告诉客户端「还没有账号」
function customPlansOf(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {}
  return {
    plans: (src.plans && typeof src.plans === 'object') ? src.plans : {},
    updatedAt: Number(src.updatedAt || 0)
  }
}

// 字段级写入避免并发整篇覆盖；返回 false 表示未落库，调用方必须回 ok:false，客户端不得误判成功
async function writeFields(openid, fields) {
  const col = db.collection(COL_USERS)
  const res = await col.doc(openid).update({ data: fields }).catch(function () { return null })
  if (res && res.stats && res.stats.updated > 0) return true
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

// 云存储 fileID 批量换临时 https 链接（管理员 token 绕过存储权限），限 20 个
async function fileUrl(openid, event) {
  const list = Array.isArray(event && event.fileList) ? event.fileList.slice(0, 20) : []
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

// 一次往返返回资料 + 偏好 + 自定义计划；文档不存在时各字段为空值，updatedAt=0 供客户端判定「无账号」
async function userGet(openid) {
  const r = await db.collection(COL_USERS).doc(openid).get().catch(function () { return { data: null } })
  const doc = (r && r.data) || {}
  return {
    ok: true,
    nickname: cleanText(doc.nickname, 30),
    avatar: cleanText(doc.avatar, 200),
    prefs: cleanPrefs(doc.prefs),
    customPlans: customPlansOf(doc.customPlans),
    updatedAt: Number(doc.updatedAt || 0)
  }
}

// 以下写入均为字段级更新，互不覆盖；updatedAt 一律取服务器时钟，避免两端时钟偏差。
// 三个写 action 的响应体恰好等于写入的字段，故统一由 writeAction 拼装
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

// 统一响应契约：{ ok: true, ... } 或 { ok: false, code }。
// 任何新增 action 都必须显式回 ok，否则客户端（utils/cloud.js）按失败处理
exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { ok: false, code: 'no_openid' }

  const action = (event && event.action) || 'openid'
  if (action === 'openid') return { ok: true, openid: openid }

  // hasOwnProperty 兜底：防 action 传 'constructor' 之类的原型链键命中
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, action) && HANDLERS[action]
  if (!handler) return { ok: false, code: 'unknown_action' }
  return handler(openid, event)
}
