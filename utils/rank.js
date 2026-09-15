// 月榜数据由服务端 social.rankMonth 聚合；月份按本机时区计算
const cloud = require('./cloud.js')
const dateUtil = require('./date.js')

function currentMonth() {
  return dateUtil.monthKey()
}

// 'YYYY-MM' -> 'YYYY年M月'
function monthLabel(month) {
  const parts = String(month || '').split('-')
  if (parts.length < 2) return ''
  return dateUtil.monthLabel(parts[0], parts[1])
}

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
