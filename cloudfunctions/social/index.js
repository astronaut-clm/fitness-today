// 云函数 social：排行榜 + 铁友圈。跨用户内容客户端读不到（集合仅创建者可读写），
// 统一在服务端以管理员权限完成读写。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL_USERS = 'ft_users'
const COL_RECORDS = 'ft_records'
const COL_RANK_CACHE = 'ft_rank_cache'
const COL_POSTS = 'ft_posts'
const COL_LIKES = 'ft_post_likes'
const COL_REPORTS = 'ft_post_reports'

// 管理员白名单：读云函数环境变量 ADMIN_OPENIDS（多个用英文逗号分隔），
// 源码不硬编码任何 openid，避免公开管理员身份标识。
const ADMIN_OPENIDS = []

function adminOpenids() {
  const list = ADMIN_OPENIDS.slice()
  const raw = String((typeof process !== 'undefined' && process.env && process.env.ADMIN_OPENIDS) || '')
  raw.split(',').forEach(function (id) {
    const v = String(id || '').trim()
    if (v && list.indexOf(v) < 0) list.push(v)
  })
  return list
}

function isAdmin(openid) {
  return !!openid && adminOpenids().indexOf(openid) >= 0
}

// 榜单：返回前 N 名；同月共享缓存 TTL（毫秒）
const RANK_TOP = 100
const RANK_CACHE_TTL = 60 * 1000

// 举报审核：聚合后返回前 N 个被举报对象
const REPORT_TOP = 100

// 铁友圈：分页大小 / 正文上限 / 同一用户发帖最小间隔（毫秒）
const FEED_PAGE_SIZE = 10
const FEED_MAX_LEN = 500
const FEED_MIN_INTERVAL = 10 * 1000

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function clampNum(value, min, max, fallback) {
  const num = Number(value)
  if (isNaN(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

// 客户端传入本机时区的 'YYYY-MM'，服务端校验后换算成 [当月1日, 次月1日) 的区间。
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

// 昵称缺省时用 openid 尾号兜底，避免把完整 openid 当昵称展示。
function rankName(openid, user) {
  const nickname = cleanText(user && user.nickname, 30)
  if (nickname) return nickname
  const id = String(openid || '')
  return id ? '练友' + id.slice(-6) : '神秘练友'
}

// 批量读用户文档并按 _id 建映射；单次 limit 上限 1000，超量分批
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

// 累计训练分钟
function rankMinutesExpr() {
  return db.command.aggregate.sum('$actualMinutes')
}

// 当月累计分钟前 RANK_TOP 名（含 openid，仅服务端使用 / 缓存）
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

// 我的当月分钟与名次（名次 = 分钟比自己多的人数 + 1）
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

// 命中且未过期返回原始行，否则 null（异常一律视为未命中）
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

// 客户端读不到别人的云存储文件，这里用管理员权限批量换临时链接（有效期约 2 小时）。
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
  if (!range) return { openid: openid, ok: false, code: 'bad_month' }
  const month = event.month
  const now = Date.now()

  let raw = await readRankCache(month, now)
  if (!raw) {
    raw = await buildRankRows(range)
    // 换好的临时链接一并写入缓存：链接有效期约 2 小时，远长于缓存 TTL（60 秒），
    // 缓存期内各请求无需重复调用 getTempFileURL
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
  // 我在 Top100 内时直接从榜单行得出名次，免去 myRank 的两次全表聚合
  let mineRow = null
  raw.forEach(function (row) {
    if (row && row.openid === openid) mineRow = row
  })
  const me = (mineRow && mineRow.minutes > 0)
    ? { minutes: mineRow.minutes, days: mineRow.days, rank: mineRow.rank }
    : await myRank(range, openid)
  return { openid: openid, ok: true, month: month, rows: rows, me: me, updatedAt: now }
}

// 发布前内容安全检测（v2）：返回 pass / review / risky。
// 接口不可用（如未声明 openapi 权限）时保守放行并告警，避免发布功能整体不可用。
async function checkContent(content, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid: openid,
      scene: 2, // 2 = 评论/社区内容
      content: content
    })
    const suggest = res && res.result && res.result.suggest
    return suggest || 'pass'
  } catch (err) {
    const code = (err && (err.errCode || err.errcode)) || 0
    if (code === 87014) return 'risky'
    console.warn('[social] msgSecCheck unavailable', code, err && err.errMsg)
    return 'pass'
  }
}

// 帖子列表：createdAt 倒序游标分页，join 昵称头像，标注 isMe / liked。
async function feedList(openid, event) {
  const size = Math.round(clampNum(event && event.limit, 1, 20, FEED_PAGE_SIZE))
  const cursor = Number(event && event.cursor) || 0
  const where = { status: 'ok' }
  if (cursor > 0) where.createdAt = _.lt(cursor)

  const res = await db.collection(COL_POSTS).where(where).orderBy('createdAt', 'desc')
    .limit(size + 1).get().catch(function () { return { data: [] } })
  let list = (res && res.data) || []
  const hasMore = list.length > size
  if (hasMore) list = list.slice(0, size)

  const openids = []
  const postIds = []
  list.forEach(function (p) {
    if (p._openid && openids.indexOf(p._openid) < 0) openids.push(p._openid)
    if (p._id) postIds.push(p._id)
  })

  // 用户资料与点赞状态互不依赖，并行查询省一次往返
  const tasks = [loadUserMap(openids)]
  if (postIds.length) {
    tasks.push(db.collection(COL_LIKES).where({ _openid: openid, postId: _.in(postIds) })
      .limit(postIds.length).get().catch(function () { return { data: [] } }))
  }
  const results = await Promise.all(tasks)
  const userMap = results[0]
  const likes = postIds.length ? ((results[1] && results[1].data) || []) : []
  const likedMap = {}
  likes.forEach(function (l) { if (l && l.postId) likedMap[l.postId] = true })

  // 头像批量换临时链接（免费版云存储客户端读不到别人的文件）。
  const avatarMap = await resolveAvatarTempUrls(list.map(function (p) {
    const u = userMap[p._openid] || {}
    return { avatar: cleanText(u.avatar, 200) }
  }))

  const rows = list.map(function (p, i) {
    const author = userMap[p._openid] || {}
    const nickname = rankName(p._openid, author)
    return {
      id: p._id,
      content: cleanText(p.content, FEED_MAX_LEN),
      createdAt: Number(p.createdAt || 0),
      nickname: nickname,
      avatar: avatarMap[i] || cleanText(author.avatar, 200),
      char: nickname.slice(0, 1),
      likeCount: Math.max(0, Number(p.likeCount) || 0),
      liked: !!likedMap[p._id],
      isMe: p._openid === openid
    }
  })

  return {
    openid: openid,
    ok: true,
    rows: rows,
    hasMore: hasMore
  }
}

// 发帖：内容清洗 + 长度/频率校验 + 内容安全检测，通过后落库。
async function feedCreate(openid, event) {
  const content = cleanText(event && event.content, FEED_MAX_LEN)
  if (!content) return { openid: openid, ok: false, code: 'empty' }

  // 频率检查与内容安全检测互不依赖，并行执行缩短响应时间。
  const checks = await Promise.all([
    db.collection(COL_POSTS).where({ _openid: openid })
      .orderBy('createdAt', 'desc').limit(1).get().catch(function () { return { data: [] } }),
    checkContent(content, openid)
  ])
  // 频率限制：同一用户 FEED_MIN_INTERVAL 内只允许发一条，避免刷屏。
  const last = (checks[0] && checks[0].data && checks[0].data[0]) || null
  const now = Date.now()
  if (last && now - Number(last.createdAt || 0) < FEED_MIN_INTERVAL) {
    return { openid: openid, ok: false, code: 'too_fast' }
  }

  const suggest = checks[1]
  if (suggest !== 'pass') {
    return { openid: openid, ok: false, code: suggest === 'risky' ? 'risky' : 'review' }
  }

  const add = await db.collection(COL_POSTS).add({
    data: { _openid: openid, content: content, createdAt: now, likeCount: 0, status: 'ok' }
  }).catch(function () { return null })
  if (!add || !add._id) return { openid: openid, ok: false, code: 'db_error' }
  return { openid: openid, ok: true, id: add._id, createdAt: now }
}

// 点赞 / 取消点赞：确定性 _id（postId_openid）天然防重复，无需额外索引。
async function feedLike(openid, event) {
  const postId = cleanText(event && event.postId, 64)
  if (!postId) return { openid: openid, ok: false, code: 'bad_post' }

  const likeId = postId + '_' + openid
  // 帖子与点赞状态互不依赖，并行读取
  const gets = await Promise.all([
    db.collection(COL_POSTS).doc(postId).get().catch(function () { return { data: null } }),
    db.collection(COL_LIKES).doc(likeId).get().catch(function () { return { data: null } })
  ])
  const post = gets[0] && gets[0].data
  if (!post || post.status !== 'ok') return { openid: openid, ok: false, code: 'not_found' }
  const liked = !!(gets[1] && gets[1].data)

  const delta = liked ? -1 : 1
  const likeWrite = liked
    ? db.collection(COL_LIKES).doc(likeId).remove().catch(function () {})
    : db.collection(COL_LIKES).doc(likeId).set({
      data: { _openid: openid, postId: postId, createdAt: Date.now() }
    }).catch(function () {})
  // 两条写操作互相独立，并行执行
  await Promise.all([
    likeWrite,
    db.collection(COL_POSTS).doc(postId).update({ data: { likeCount: _.inc(delta) } }).catch(function () {})
  ])

  // 计数基于操作前的值推算（与并发点赞存在小误差），省去一次读回
  const count = Math.max(0, (Number(post.likeCount) || 0) + delta)
  return { openid: openid, ok: true, liked: !liked, likeCount: count }
}

// 内容被删除后，其待处理举报自动结案，避免管理员复核已不存在的内容。
async function resolveReports(targetId) {
  await db.collection(COL_REPORTS).where({ targetId: targetId })
    .update({ data: { status: 'resolved', handledAt: Date.now(), removed: true } })
    .catch(function () {})
}

// 物理删除一条动态及其点赞（管理员与作者共用）。
async function removePost(postId) {
  await db.collection(COL_POSTS).doc(postId).remove().catch(function () {})
  await db.collection(COL_LIKES).where({ postId: postId }).remove().catch(function () {})
  await resolveReports(postId)
}

// 删帖：仅作者可删，连带删除该帖所有点赞（server 端批量删除）。
async function feedDelete(openid, event) {
  const postId = cleanText(event && event.postId, 64)
  if (!postId) return { openid: openid, ok: false, code: 'bad_post' }

  const postRes = await db.collection(COL_POSTS).doc(postId).get()
    .catch(function () { return { data: null } })
  const post = postRes && postRes.data
  if (!post) return { openid: openid, ok: true }
  if (post._openid !== openid) return { openid: openid, ok: false, code: 'forbidden' }

  await removePost(postId)
  return { openid: openid, ok: true }
}

// 举报动态：post_targetId_openid 去重，落库时存内容快照，管理端可直接复核。
async function feedReport(openid, event) {
  const targetId = cleanText(event && event.targetId, 64)
  if (!targetId) return { openid: openid, ok: false, code: 'bad_post' }

  const res = await db.collection(COL_POSTS).doc(targetId).get()
    .catch(function () { return { data: null } })
  const post = res && res.data
  if (!post || post.status !== 'ok') return { openid: openid, ok: false, code: 'not_found' }

  await db.collection(COL_REPORTS).doc('post_' + targetId + '_' + openid).set({
    data: {
      _openid: openid,
      targetId: targetId,
      reason: cleanText(event && event.reason, 100),
      targetContent: cleanText(post.content, FEED_MAX_LEN),
      targetOpenid: cleanText(post._openid, 64),
      status: 'pending',
      createdAt: Date.now()
    }
  }).catch(function () {})
  return { openid: openid, ok: true }
}

// 管理端：待处理举报，按被举报对象聚合（举报次数 / 举报人 / 内容快照）
async function adminReportList(openid) {
  if (!isAdmin(openid)) return { openid: openid, ok: false, code: 'forbidden' }
  const $ = db.command.aggregate
  const res = await db.collection(COL_REPORTS).aggregate()
    .match({ status: _.neq('resolved') })
    .group({
      _id: '$targetId',
      content: $.first('$targetContent'),
      authorOpenid: $.first('$targetOpenid'),
      count: $.sum(1),
      reporters: $.addToSet('$_openid'),
      lastAt: $.max('$createdAt')
    })
    .sort({ lastAt: -1, _id: 1 })
    .limit(REPORT_TOP)
    .end()
    .catch(function () { return { list: [] } })

  const list = (res && res.list) || []
  const openids = []
  list.forEach(function (g) {
    if (!g) return
    if (g.authorOpenid && openids.indexOf(g.authorOpenid) < 0) openids.push(g.authorOpenid)
    ;(g.reporters || []).forEach(function (id) {
      if (id && openids.indexOf(id) < 0) openids.push(id)
    })
  })
  const userMap = await loadUserMap(openids)

  const rows = list.map(function (g) {
    const author = userMap[g.authorOpenid] || {}
    return {
      targetId: g._id,
      content: cleanText(g.content, FEED_MAX_LEN),
      author: rankName(g.authorOpenid, author),
      authorOpenid: cleanText(g.authorOpenid, 64),
      count: Number(g.count) || 0,
      reporters: (g.reporters || []).map(function (id) { return rankName(id, userMap[id] || {}) }),
      lastAt: Number(g.lastAt) || 0
    }
  })

  return { openid: openid, ok: true, rows: rows }
}

// 管理端：处理举报。op=delete 删除被举报动态，其余为忽略；两种都把该动态的举报结案。
async function adminReportResolve(openid, event) {
  if (!isAdmin(openid)) return { openid: openid, ok: false, code: 'forbidden' }
  const targetId = cleanText(event && event.targetId, 64)
  if (!targetId) return { openid: openid, ok: false, code: 'bad_target' }

  if ((event && event.op) === 'delete') await removePost(targetId)

  await db.collection(COL_REPORTS).where({ targetId: targetId })
    .update({ data: { status: 'resolved', handledBy: openid, handledAt: Date.now() } })
    .catch(function () {})
  return { openid: openid, ok: true }
}

// 管理端：判断当前用户是否为管理员，用于决定是否展示审核入口。
async function adminCheck(openid) {
  return { openid: openid, ok: true, isAdmin: isAdmin(openid) }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID || ''
  const action = event && event.action

  if (!action || action === 'openid') return { openid: OPENID }
  if (!OPENID) return { openid: '' }

  if (action === 'rankMonth') return rankMonth(OPENID, event)

  if (action === 'feedList') return feedList(OPENID, event)
  if (action === 'feedCreate') return feedCreate(OPENID, event)
  if (action === 'feedLike') return feedLike(OPENID, event)
  if (action === 'feedDelete') return feedDelete(OPENID, event)
  if (action === 'feedReport') return feedReport(OPENID, event)

  if (action === 'adminCheck') return adminCheck(OPENID)
  if (action === 'adminReportList') return adminReportList(OPENID, event)
  if (action === 'adminReportResolve') return adminReportResolve(OPENID, event)

  return { openid: OPENID }
}
