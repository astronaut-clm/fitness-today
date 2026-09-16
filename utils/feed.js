// 铁友圈读写均经 social 云函数，以管理员权限操作
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
      hasMore: !!res.hasMore
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

// 发布失败 code → 用户提示文案（feed 页与跟练分享页共用）
function createErrorText(code) {
  if (code === 'risky' || code === 'review') return '内容未通过安全检测，请修改后重试'
  if (code === 'too_fast') return '发得有点快，歇会儿再发'
  return '发布失败，请重试'
}

function like(postId) {
  return cloud.callTo('social', 'feedLike', { postId: postId }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true, liked: !!res.liked, likeCount: Math.max(0, Number(res.likeCount) || 0) }
  })
}

function remove(postId) {
  return cloud.callTo('social', 'feedDelete', { postId: postId }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true }
  })
}

// 举报动态：服务端会保存内容快照，供管理端复核。
function report(postId, reason) {
  return cloud.callTo('social', 'feedReport', { targetId: postId, reason: reason || '' }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true }
  })
}

// 管理端：是否为管理员（决定是否展示审核入口）
function adminCheck() {
  return cloud.callTo('social', 'adminCheck', {}).then(function (res) {
    if (!res || !res.ok) return { ok: false, isAdmin: false }
    return { ok: true, isAdmin: !!res.isAdmin }
  })
}

// 管理端：待处理举报列表（按被举报对象聚合）
function adminReportList() {
  return cloud.callTo('social', 'adminReportList', {}).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    const rows = (res.rows || []).map(function (row) {
      return Object.assign({}, row, { timeText: timeText(row.lastAt) })
    })
    return { ok: true, rows: rows }
  })
}

// 管理端：处理举报（op='delete' 删除内容，其余忽略）
function adminReportResolve(targetId, op) {
  return cloud.callTo('social', 'adminReportResolve', {
    targetId: targetId,
    op: op || 'ignore'
  }).then(function (res) {
    if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'error' }
    return { ok: true }
  })
}

module.exports = {
  list: list,
  create: create,
  createErrorText: createErrorText,
  like: like,
  remove: remove,
  report: report,
  adminCheck: adminCheck,
  adminReportList: adminReportList,
  adminReportResolve: adminReportResolve
}
