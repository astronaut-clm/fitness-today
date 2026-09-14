// utils/feed.js 铁友圈（列表/发布/点赞/删除/举报，均经 social 云函数以管理员权限读写）
const cloud = require('./cloud.js')

// 相对时间文案（超一周显示日期）
function timeText(ts) {
  const t = Number(ts) || 0
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前'
  const d = new Date(t)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

// 拉取列表：cursor 为上一页最后一条 createdAt（0=首页）
function list(cursor) {
  const data = cursor ? { cursor: cursor } : {}
  return cloud.callTo('social', 'feedList', data).then(function (res) {
    if (!res || !res.ok) return { ok: false }
    const rows = (res.rows || []).map(function (row) {
      return Object.assign({}, row, { timeText: timeText(row.createdAt) })
    })
    return {
      ok: true,
      rows: rows,
      hasMore: !!res.hasMore,
      nextCursor: Number(res.nextCursor) || 0
    }
  })
}

// 发布动态（失败 code：empty/too_fast/risky/review/db_error）
function create(content) {
  return cloud.callTo('social', 'feedCreate', { content: content }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true, id: res.id, createdAt: res.createdAt }
  })
}

// 点赞/取消点赞，返回最终态
function like(postId) {
  return cloud.callTo('social', 'feedLike', { postId: postId }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true, liked: !!res.liked, likeCount: Math.max(0, Number(res.likeCount) || 0) }
  })
}

// 删除自己的动态。
function remove(postId) {
  return cloud.callTo('social', 'feedDelete', { postId: postId }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true }
  })
}

// 举报动态。
function report(postId, reason) {
  return cloud.callTo('social', 'feedReport', { postId: postId, reason: reason || '' }).then(function (res) {
    if (!res || !res.ok) return { ok: false }
    return { ok: true }
  })
}

// 拉取某帖评论：cursor 为上一页最后一条 createdAt（0=首页）
function comments(postId, cursor) {
  const data = cursor ? { postId: postId, cursor: cursor } : { postId: postId }
  return cloud.callTo('social', 'commentList', data).then(function (res) {
    if (!res || !res.ok) return { ok: false }
    const rows = (res.rows || []).map(function (row) {
      return Object.assign({}, row, { timeText: timeText(row.createdAt) })
    })
    return {
      ok: true,
      rows: rows,
      hasMore: !!res.hasMore,
      nextCursor: Number(res.nextCursor) || 0
    }
  })
}

// 发表评论（失败 code：empty/too_fast/risky/review/not_found/db_error）
function comment(postId, content) {
  return cloud.callTo('social', 'commentCreate', { postId: postId, content: content }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true, id: res.id, createdAt: res.createdAt }
  })
}

// 删除自己的评论。
function removeComment(commentId) {
  return cloud.callTo('social', 'commentDelete', { commentId: commentId }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true }
  })
}

module.exports = {
  list: list,
  create: create,
  like: like,
  remove: remove,
  report: report,
  comments: comments,
  comment: comment,
  removeComment: removeComment
}
