function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// Date -> 'YYYY-MM-DD'
function format(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

// 'YYYY-MM-DD' -> Date（本地时区，避免 UTC 偏移）
function parse(str) {
  const parts = str.split('-')
  return new Date(+parts[0], +parts[1] - 1, +parts[2])
}

function today() {
  return format(new Date())
}

function addDays(dateStr, delta) {
  const d = parse(dateStr)
  d.setDate(d.getDate() + delta)
  return format(d)
}

// 今天 + 前一天，用于连续打卡判断
function todayAndYesterday() {
  const t = today()
  return { today: t, yesterday: addDays(t, -1) }
}

// 中文星期标签（下标对齐 getDay()，0 = 周日）
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 月历表头（周一开头，由 WEEK_LABELS 派生）
const WEEK_HEAD_LABELS = WEEK_LABELS.slice(1).concat(WEEK_LABELS.slice(0, 1))

// 某年某月天数（month: 1-12）
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// 生成月历网格（周一开头，首尾补空格）
function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7 // 周一开头
  const total = daysInMonth(year, month)
  const weeks = []
  const days = []
  const padStart = offset
  for (let i = 0; i < padStart; i++) {
    days.push({ key: 'p' + i, date: '', day: '', inMonth: false })
  }
  for (let d = 1; d <= total; d++) {
    const date = pad(d)
    const key = year + '-' + pad(month) + '-' + date
    days.push({ key: key, date: key, day: d, inMonth: true })
  }
  while (days.length % 7 !== 0) {
    days.push({ key: 't' + days.length, date: '', day: '', inMonth: false })
  }
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  return weeks
}

module.exports = {
  pad: pad,
  format: format,
  parse: parse,
  today: today,
  addDays: addDays,
  todayAndYesterday: todayAndYesterday,
  WEEK_LABELS: WEEK_LABELS,
  WEEK_HEAD_LABELS: WEEK_HEAD_LABELS,
  monthGrid: monthGrid
}
