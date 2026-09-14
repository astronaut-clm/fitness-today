// 月榜数据由服务端 social.rankMonth 聚合；月份按本机时区计算
const cloud = require('./cloud.js')
const dateUtil = require('./date.js')

// 本机时区的自然月 key：'YYYY-MM'
function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + dateUtil.pad(now.getMonth() + 1)
}

// 'YYYY-MM' -> 'YYYY年M月'
function monthLabel(month) {
  const parts = String(month || '').split('-')
  if (parts.length < 2) return ''
  return Number(parts[0]) + '年' + Number(parts[1]) + '月'
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
