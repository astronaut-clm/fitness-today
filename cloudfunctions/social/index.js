// 云函数 social：跨用户内容（排行榜 + 铁友圈）。
// 客户端读不到别人的数据（集合权限为「仅创建者可读写」），
// 所有跨用户读写在服务端以管理员权限完成，绕过客户端权限规则。
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
const COL_COMMENTS = 'ft_post_comments'

// 排行榜参数：只返回前 N 名；同一自然月榜单缓存 TTL（毫秒），避免每次打开都全量聚合。
const RANK_TOP = 100
const RANK_CACHE_TTL = 60 * 1000

// 铁友圈参数：分页大小 / 正文上限 / 同一用户发帖最小间隔（毫秒）。
const FEED_PAGE_SIZE = 10
const FEED_MAX_LEN = 500
const FEED_MIN_INTERVAL = 10 * 1000

// 评论参数：分页大小 / 正文上限 / 同一用户评论最小间隔（毫秒）。
const COMMENT_PAGE_SIZE = 20
const COMMENT_MAX_LEN = 200
const COMMENT_MIN_INTERVAL = 5 * 1000

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function clampNum(value, min, max, fallback) {
  const num = Number(value)
  if (isNaN(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

// ---- 排行榜（月榜） ----
// 客户端按本机时区算出自然月 'YYYY-MM' 传入，服务端只做格式校验并换算成
// [当月1日, 次月1日) 的字符串区间（date 字段为 'YYYY-MM-DD'，字典序即时间序）。
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

// 按 _openid 聚合当月累计训练分钟；actualMinutes 缺失时回退 duration。
function rankMinutesExpr() {
  const $ = db.command.aggregate
  return $.sum($.ifNull(['$actualMinutes', '$duration']))
}

// 取出当月累计分钟前 RANK_TOP 名（原始行，含 openid，仅服务端使用/缓存）。
async function buildRankRows(range) {
  const $ = db.command.aggregate
  const res = await db.collection(COL_RECORDS).aggregate()
    .match({ date: _.gte(range.start).and(_.lt(range.end)) })
    // days 用 addToSet 收集去重日期，保证「同一天多次训练」只算一天。
    .group({ _id: '$_openid', minutes: rankMinutesExpr(), days: $.addToSet('$date') })
    .project({ _id: 1, minutes: 1, days: $.size('$days') })
    .sort({ minutes: -1, _id: 1 })
    .limit(RANK_TOP)
    .end()
  const list = (res && res.list) || []
  const ids = list.map(function (row) { return row && row._id }).filter(Boolean)
  let users = []
  if (ids.length) {
    const usersRes = await db.collection(COL_USERS).where({ _id: _.in(ids) }).limit(ids.length)
      .get().catch(function () { return { data: [] } })
    users = (usersRes && usersRes.data) || []
  }
  const userMap = {}
  users.forEach(function (u) { if (u && u._id) userMap[u._id] = u })
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

// 当前用户当月累计分钟与名次（名次 = 比自己分钟多的人数 + 1）。
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

// 缓存读：命中且未过期返回原始行数组，否则返回 null（任何异常都安全降级为不命中）。
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

// 免费版云存储默认/锁定为「仅创建者可读写」，客户端无法直接加载别人的头像。
// 云函数可用管理员权限生成临时 HTTPS 链接，供客户端展示任意用户的头像。
// 临时链接有效期约 2 小时，榜单缓存只有 60 秒，足够用。
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

// 排行榜（月榜）：按月累计训练时长排名。
// 榜单前 N 名走 60 秒缓存（服务端共享），「我的名次」按当前 openid 实时计算。
async function rankMonth(openid, event) {
  const range = monthRange(event && event.month)
  if (!range) return { openid: openid, ok: false, code: 'bad_month' }
  const month = event.month
  const now = Date.now()

  let raw = await readRankCache(month, now)
  if (!raw) {
    raw = await buildRankRows(range)
    await writeRankCache(month, raw, now)
  }

  // 免费版云存储锁定「仅创建者可读写」，直接返回 fileID 客户端显示不了。
  // 用管理员权限批量换临时链接；失败时仍保留原值，由前端 fallback 兜底。
  const avatarMap = await resolveAvatarTempUrls(raw)
  const rows = raw.map(function (row, index) {
    return {
      rank: row.rank,
      nickname: row.nickname,
      avatar: avatarMap[index] || row.avatar || '',
      minutes: row.minutes,
      days: row.days,
      isMe: !!row.openid && row.openid === openid
    }
  })
  const me = await myRank(range, openid)
  return { openid: openid, ok: true, month: month, rows: rows, me: me, updatedAt: now }
}

// ---- 铁友圈 ----

// 发布前内容安全检测（v2）。
// 返回 'pass'（放行）/ 'review'（需人工复核）/ 'risky'（违规）。
// 注意：若接口本身不可用（如未在 config.json 声明 openapi 权限），这里保守放行并告警，
// 以免因配置问题导致整个发布功能不可用；上线前请确认权限已配置生效。
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

  let users = []
  if (openids.length) {
    const ur = await db.collection(COL_USERS).where({ _id: _.in(openids) }).limit(openids.length)
      .get().catch(function () { return { data: [] } })
    users = (ur && ur.data) || []
  }
  const userMap = {}
  users.forEach(function (u) { if (u && u._id) userMap[u._id] = u })

  let likes = []
  if (postIds.length) {
    const lr = await db.collection(COL_LIKES).where({ _openid: openid, postId: _.in(postIds) })
      .limit(postIds.length).get().catch(function () { return { data: [] } })
    likes = (lr && lr.data) || []
  }
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
      commentCount: Math.max(0, Number(p.commentCount) || 0),
      liked: !!likedMap[p._id],
      isMe: p._openid === openid
    }
  })

  const last = list[list.length - 1]
  return {
    openid: openid,
    ok: true,
    rows: rows,
    hasMore: hasMore,
    nextCursor: hasMore && last ? Number(last.createdAt || 0) : 0
  }
}

// 发帖：内容清洗 + 长度/频率校验 + 内容安全检测，通过后落库。
async function feedCreate(openid, event) {
  const content = cleanText(event && event.content, FEED_MAX_LEN)
  if (!content) return { openid: openid, ok: false, code: 'empty' }

  // 频率限制：同一用户 FEED_MIN_INTERVAL 内只允许发一条，避免刷屏。
  const lastRes = await db.collection(COL_POSTS).where({ _openid: openid })
    .orderBy('createdAt', 'desc').limit(1).get().catch(function () { return { data: [] } })
  const last = (lastRes && lastRes.data && lastRes.data[0]) || null
  const now = Date.now()
  if (last && now - Number(last.createdAt || 0) < FEED_MIN_INTERVAL) {
    return { openid: openid, ok: false, code: 'too_fast' }
  }

  const suggest = await checkContent(content, openid)
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

  const postRes = await db.collection(COL_POSTS).doc(postId).get()
    .catch(function () { return { data: null } })
  const post = postRes && postRes.data
  if (!post || post.status !== 'ok') return { openid: openid, ok: false, code: 'not_found' }

  const likeId = postId + '_' + openid
  const likeRes = await db.collection(COL_LIKES).doc(likeId).get()
    .catch(function () { return { data: null } })
  const liked = !!(likeRes && likeRes.data)

  if (liked) {
    await db.collection(COL_LIKES).doc(likeId).remove().catch(function () {})
    await db.collection(COL_POSTS).doc(postId).update({ data: { likeCount: _.inc(-1) } }).catch(function () {})
  } else {
    await db.collection(COL_LIKES).doc(likeId).set({
      data: { _openid: openid, postId: postId, createdAt: Date.now() }
    }).catch(function () {})
    await db.collection(COL_POSTS).doc(postId).update({ data: { likeCount: _.inc(1) } }).catch(function () {})
  }

  const afterRes = await db.collection(COL_POSTS).doc(postId).get()
    .catch(function () { return { data: null } })
  const count = Math.max(0, Number(afterRes && afterRes.data && afterRes.data.likeCount) || 0)
  return { openid: openid, ok: true, liked: !liked, likeCount: count }
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

  await db.collection(COL_POSTS).doc(postId).remove().catch(function () {})
  await db.collection(COL_LIKES).where({ postId: postId }).remove().catch(function () {})
  await db.collection(COL_COMMENTS).where({ postId: postId }).remove().catch(function () {})
  return { openid: openid, ok: true }
}

// 举报：按 postId_openid 去重记录，供后台核查（用户间不感知处理结果）。
async function feedReport(openid, event) {
  const postId = cleanText(event && event.postId, 64)
  if (!postId) return { openid: openid, ok: false, code: 'bad_post' }
  await db.collection(COL_REPORTS).doc(postId + '_' + openid).set({
    data: {
      _openid: openid,
      postId: postId,
      reason: cleanText(event && event.reason, 100),
      createdAt: Date.now()
    }
  }).catch(function () {})
  return { openid: openid, ok: true }
}

// ---- 评论 ----

// 某帖评论：createdAt 倒序游标分页，join 昵称头像，标注 isMe。
async function commentList(openid, event) {
  const postId = cleanText(event && event.postId, 64)
  if (!postId) return { openid: openid, ok: false, code: 'bad_post' }

  const size = Math.round(clampNum(event && event.limit, 1, 50, COMMENT_PAGE_SIZE))
  const cursor = Number(event && event.cursor) || 0
  const where = { postId: postId, status: 'ok' }
  if (cursor > 0) where.createdAt = _.lt(cursor)

  const res = await db.collection(COL_COMMENTS).where(where).orderBy('createdAt', 'desc')
    .limit(size + 1).get().catch(function () { return { data: [] } })
  let list = (res && res.data) || []
  const hasMore = list.length > size
  if (hasMore) list = list.slice(0, size)

  const openids = []
  list.forEach(function (c) {
    if (c._openid && openids.indexOf(c._openid) < 0) openids.push(c._openid)
  })
  let users = []
  if (openids.length) {
    const ur = await db.collection(COL_USERS).where({ _id: _.in(openids) }).limit(openids.length)
      .get().catch(function () { return { data: [] } })
    users = (ur && ur.data) || []
  }
  const userMap = {}
  users.forEach(function (u) { if (u && u._id) userMap[u._id] = u })

  const avatarMap = await resolveAvatarTempUrls(list.map(function (c) {
    const u = userMap[c._openid] || {}
    return { avatar: cleanText(u.avatar, 200) }
  }))

  const rows = list.map(function (c, i) {
    const author = userMap[c._openid] || {}
    const nickname = rankName(c._openid, author)
    return {
      id: c._id,
      content: cleanText(c.content, COMMENT_MAX_LEN),
      createdAt: Number(c.createdAt || 0),
      nickname: nickname,
      avatar: avatarMap[i] || cleanText(author.avatar, 200),
      char: nickname.slice(0, 1),
      isMe: c._openid === openid
    }
  })

  const last = list[list.length - 1]
  return {
    openid: openid,
    ok: true,
    rows: rows,
    hasMore: hasMore,
    nextCursor: hasMore && last ? Number(last.createdAt || 0) : 0
  }
}

// 发表评论：校验帖子存在 + 频率限制 + 内容安全检测，通过后落库并累加帖子的评论数。
async function commentCreate(openid, event) {
  const postId = cleanText(event && event.postId, 64)
  if (!postId) return { openid: openid, ok: false, code: 'bad_post' }
  const content = cleanText(event && event.content, COMMENT_MAX_LEN)
  if (!content) return { openid: openid, ok: false, code: 'empty' }

  const postRes = await db.collection(COL_POSTS).doc(postId).get()
    .catch(function () { return { data: null } })
  const post = postRes && postRes.data
  if (!post || post.status !== 'ok') return { openid: openid, ok: false, code: 'not_found' }

  // 频率限制：同一用户 COMMENT_MIN_INTERVAL 内只允许发一条，避免刷屏。
  const lastRes = await db.collection(COL_COMMENTS).where({ _openid: openid })
    .orderBy('createdAt', 'desc').limit(1).get().catch(function () { return { data: [] } })
  const last = (lastRes && lastRes.data && lastRes.data[0]) || null
  const now = Date.now()
  if (last && now - Number(last.createdAt || 0) < COMMENT_MIN_INTERVAL) {
    return { openid: openid, ok: false, code: 'too_fast' }
  }

  const suggest = await checkContent(content, openid)
  if (suggest !== 'pass') {
    return { openid: openid, ok: false, code: suggest === 'risky' ? 'risky' : 'review' }
  }

  const add = await db.collection(COL_COMMENTS).add({
    data: { _openid: openid, postId: postId, content: content, createdAt: now, status: 'ok' }
  }).catch(function () { return null })
  if (!add || !add._id) return { openid: openid, ok: false, code: 'db_error' }

  await db.collection(COL_POSTS).doc(postId).update({ data: { commentCount: _.inc(1) } })
    .catch(function () {})
  return { openid: openid, ok: true, id: add._id, createdAt: now }
}

// 删除评论：仅本人可删，连带把帖子的评论数减一。
async function commentDelete(openid, event) {
  const commentId = cleanText(event && event.commentId, 64)
  if (!commentId) return { openid: openid, ok: false, code: 'bad_comment' }

  const res = await db.collection(COL_COMMENTS).doc(commentId).get()
    .catch(function () { return { data: null } })
  const comment = res && res.data
  if (!comment) return { openid: openid, ok: true }
  if (comment._openid !== openid) return { openid: openid, ok: false, code: 'forbidden' }

  await db.collection(COL_COMMENTS).doc(commentId).remove().catch(function () {})
  await db.collection(COL_POSTS).doc(comment.postId).update({ data: { commentCount: _.inc(-1) } })
    .catch(function () {})
  return { openid: openid, ok: true }
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

  if (action === 'commentList') return commentList(OPENID, event)
  if (action === 'commentCreate') return commentCreate(OPENID, event)
  if (action === 'commentDelete') return commentDelete(OPENID, event)

  return { openid: OPENID }
}
