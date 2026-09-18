// 云函数 social：月度排行榜。跨用户的聚合统计只能在这里做——客户端读不到别人的记录。
// 聚合按 `_openid` 分组：那是平台字段，只有客户端直连写入时才自动注入，
// ft_records 正是客户端写的（utils/records.js），所以每条记录都带着作者身份。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL_USERS = 'ft_users'
const COL_RECORDS = 'ft_records'
const COL_RANK_CACHE = 'ft_rank_cache'

const RANK_TOP = 100
const RANK_CACHE_TTL = 60 * 1000

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

// 'YYYY-MM'（客户端本机时区）→ [当月1日, 次月1日) 区间
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return null
  const year = Number(m[1])
  const mon = Number(m[2])
  if (mon < 1 || mon > 12 || year < 2000 || year > 2100) return null
  const nextMon = mon === 12 ? 1 : mon + 1
  const nextYear = mon === 12 ? year + 1 : year
  const nextPad = nextMon < 10 ? '0' + nextMon : '' + nextMon
  return { start: m[1] + '-' + m[2] + '-01', end: nextYear + '-' + nextPad + '-01' }
}

// 昵称缺省用 openid 尾号兜底，避免展示完整 openid
function rankName(openid, user) {
  const nickname = cleanText(user && user.nickname, 30)
  if (nickname) return nickname
  const id = String(openid || '')
  return id ? '练友' + id.slice(-6) : '神秘练友'
}

// 单次 limit 上限 1000，超量分批
async function loadUserMap(ids) {
  const list = (ids || []).filter(Boolean)
  const map = {}
  const BATCH = 1000
  for (let i = 0; i < list.length; i += BATCH) {
    const part = list.slice(i, i + BATCH)
    if (!part.length) break
    const res = await db.collection(COL_USERS).where({ _id: _.in(part) }).limit(part.length)
      .get().catch(function () { return { data: [] } })
    ;((res && res.data) || []).forEach(function (u) { if (u && u._id) map[u._id] = u })
  }
  return map
}

function rankMinutesExpr() {
  return db.command.aggregate.sum('$actualMinutes')
}

// 返回行含 openid，仅服务端内部使用 / 缓存
async function buildRankRows(range) {
  const $ = db.command.aggregate
  const res = await db.collection(COL_RECORDS).aggregate()
    .match({ date: _.gte(range.start).and(_.lt(range.end)) })
    // addToSet 去重日期：同一天多次训练只算一天
    .group({ _id: '$_openid', minutes: rankMinutesExpr(), days: $.addToSet('$date') })
    .project({ _id: 1, minutes: 1, days: $.size('$days') })
    .sort({ minutes: -1, _id: 1 })
    .limit(RANK_TOP)
    .end()
  const list = (res && res.list) || []
  const ids = list.map(function (row) { return row && row._id }).filter(Boolean)
  const userMap = await loadUserMap(ids)
  return list.map(function (row, index) {
    const openid = row._id || ''
    const user = userMap[openid] || {}
    return {
      rank: index + 1,
      openid: openid,
      nickname: rankName(openid, user),
      avatar: cleanText(user.avatar, 200),
      minutes: Math.max(0, Math.round(Number(row.minutes) || 0)),
      days: Number(row.days) || 0
    }
  })
}

// 名次 = 分钟比自己多的人数 + 1
async function myRank(range, openid) {
  const $ = db.command.aggregate
  const mineRes = await db.collection(COL_RECORDS).aggregate()
    .match({ date: _.gte(range.start).and(_.lt(range.end)), _openid: openid })
    .group({ _id: '$_openid', minutes: rankMinutesExpr(), days: $.addToSet('$date') })
    .project({ _id: 0, minutes: 1, days: $.size('$days') })
    .end()
  const mine = (mineRes && mineRes.list && mineRes.list[0]) || null
  const minutes = mine ? Math.max(0, Math.round(Number(mine.minutes) || 0)) : 0
  if (!minutes) return { minutes: 0, days: 0, rank: 0 }
  const greaterRes = await db.collection(COL_RECORDS).aggregate()
    .match({ date: _.gte(range.start).and(_.lt(range.end)) })
    .group({ _id: '$_openid', minutes: rankMinutesExpr() })
    .match({ minutes: _.gt(minutes) })
    .count('n')
    .end()
  const greater = (greaterRes && greaterRes.list && greaterRes.list[0] && greaterRes.list[0].n) || 0
  return { minutes: minutes, days: Number(mine.days) || 0, rank: greater + 1 }
}

// 异常一律视为未命中
async function readRankCache(month, now) {
  try {
    const res = await db.collection(COL_RANK_CACHE).doc(month).get()
    const data = (res && res.data) || {}
    if (Array.isArray(data.rows) && now - Number(data.updatedAt || 0) < RANK_CACHE_TTL) return data.rows
  } catch (e) {}
  return null
}

function writeRankCache(month, rows, now) {
  return db.collection(COL_RANK_CACHE).doc(month).set({
    data: { month: month, rows: rows, updatedAt: now }
  }).catch(function () {})
}

// 客户端读不到别人的云存储文件，用管理员权限批量换临时链接（有效期约 2 小时）
async function resolveAvatarTempUrls(rows) {
  const fileIDs = []
  const indexMap = {}
  rows.forEach(function (row, i) {
    const avatar = row && row.avatar
    if (typeof avatar === 'string' && avatar.indexOf('cloud://') === 0) {
      indexMap[fileIDs.length] = i
      fileIDs.push(avatar)
    }
  })
  if (!fileIDs.length) return {}

  const BATCH = 50
  const out = {}
  async function fetchBatch(start) {
    const batch = fileIDs.slice(start, start + BATCH)
    const res = await cloud.getTempFileURL({ fileList: batch }).catch(function () { return null })
    ;(res && res.fileList || []).forEach(function (item, i) {
      if (item && item.tempFileURL) out[indexMap[start + i]] = item.tempFileURL
    })
  }

  const tasks = []
  for (let start = 0; start < fileIDs.length; start += BATCH) {
    tasks.push(fetchBatch(start))
  }
  await Promise.all(tasks)
  return out
}

// 月榜：前 N 名走共享缓存，「我的名次」在榜内时直接从缓存行得出
async function rankMonth(openid, event) {
  const range = monthRange(event && event.month)
  if (!range) return { ok: false, code: 'bad_month' }
  const month = event.month
  const now = Date.now()

  let raw = await readRankCache(month, now)
  if (!raw) {
    raw = await buildRankRows(range)
    // 临时链接（约 2 小时）远长于缓存 TTL（60 秒），换好一并写入缓存
    const urlMap = await resolveAvatarTempUrls(raw)
    raw = raw.map(function (row, index) {
      return urlMap[index] ? Object.assign({}, row, { avatar: urlMap[index] }) : row
    })
    await writeRankCache(month, raw, now)
  }

  const rows = raw.map(function (row) {
    return {
      rank: row.rank,
      nickname: row.nickname,
      avatar: row.avatar || '',
      minutes: row.minutes,
      days: row.days,
      isMe: !!row.openid && row.openid === openid
    }
  })
  // 在 Top100 内直接取榜单行，免去 myRank 的全表聚合
  let mineRow = null
  raw.forEach(function (row) {
    if (row && row.openid === openid) mineRow = row
  })
  const me = (mineRow && mineRow.minutes > 0)
    ? { minutes: mineRow.minutes, days: mineRow.days, rank: mineRow.rank }
    : await myRank(range, openid)
  return { ok: true, month: month, rows: rows, me: me, updatedAt: now }
}

// 统一响应契约：{ ok: true, ... } 或 { ok: false, code }。
// 客户端（utils/cloud.js）只认显式的 ok，漏写一律按失败处理
exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { ok: false, code: 'no_openid' }
  if ((event && event.action) !== 'rankMonth') return { ok: false, code: 'unknown_action' }
  return rankMonth(openid, event)
}
