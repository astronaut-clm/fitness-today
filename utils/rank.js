// utils/rank.js 排行榜（月榜）数据获取
// 榜单由 social 云函数的 rankMonth 动作在服务端聚合（跨用户数据客户端读不到）。
// 月度按用户本机时区计算，避免云函数时区与用户不一致导致月初/月末错位。
const cloud = require('./cloud.js')

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// 本机时区的自然月 key：'YYYY-MM'
function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + pad(now.getMonth() + 1)
}

// 'YYYY-MM' -> 'YYYY年M月'
function monthLabel(month) {
  const parts = String(month || '').split('-')
  if (parts.length < 2) return ''
  return Number(parts[0]) + '年' + Number(parts[1]) + '月'
}

// 拉取榜单：成功 { ok:true, month, rows, me }，失败 { ok:false }
function fetch(month) {
  const key = month || currentMonth()
  return cloud.callTo('social', 'rankMonth', { month: key }).then(function (res) {
    if (!res || !res.ok || res.code) return { ok: false }
    const rows = (res.rows || []).map(function (row) {
      return Object.assign({}, row, {
        char: (row.nickname || '练').slice(0, 1),
        noClass: row.rank <= 3 ? 'rank-no-' + row.rank : 'rank-no-n'
      })
    })
    return {
      ok: true,
      month: res.month || key,
      rows: rows,
      me: res.me || { minutes: 0, days: 0, rank: 0 }
    }
  })
}

module.exports = {
  currentMonth: currentMonth,
  monthLabel: monthLabel,
  fetch: fetch
}
