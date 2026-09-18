// 日期工具：一律以本机时区的 'YYYY-MM-DD' 字符串交换，可直接比大小/前缀，省去反复构造 Date

// 下标对齐 getDay()，0 = 周日
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 月历表头：周一开头
const WEEK_HEAD_LABELS = WEEK_LABELS.slice(1).concat(WEEK_LABELS.slice(0, 1))

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function format(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

// 本地时区，避免 UTC 偏移
function parse(str) {
  const parts = String(str || '').split('-')
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2])
  return isNaN(d.getTime()) ? null : d
}

function today() {
  return format(new Date())
}

function addDays(dateStr, delta) {
  const d = parse(dateStr)
  if (!d) return ''
  d.setDate(d.getDate() + delta)
  return format(d)
}

function todayAndYesterday() {
  const t = today()
  return { today: t, yesterday: addDays(t, -1) }
}

// 周一为一周起点，缺省取今天所在周
function weekStart(dateStr) {
  const d = parse(dateStr || today())
  if (!d) return ''
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return format(d)
}

function dayLabel(date) {
  if (!date) return ''
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + WEEK_LABELS[date.getDay()]
}

// 'YYYY-MM'
function monthKey() {
  const now = new Date()
  return now.getFullYear() + '-' + pad(now.getMonth() + 1)
}

function monthLabel(year, month) {
  return Number(year) + '年' + Number(month) + '月'
}

function monthLabelOf(month) {
  const parts = String(month || '').split('-')
  return parts.length < 2 ? '' : monthLabel(parts[0], parts[1])
}

// month: 1-12
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// 周一开头，首尾补空格凑满整周
function monthGrid(year, month) {
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const total = daysInMonth(year, month)
  const days = []
  for (let i = 0; i < offset; i++) {
    days.push({ key: 'p' + i, date: '', day: '', inMonth: false })
  }
  const prefix = year + '-' + pad(month) + '-'
  for (let d = 1; d <= total; d++) {
    const key = prefix + pad(d)
    days.push({ key: key, date: key, day: d, inMonth: true })
  }
  while (days.length % 7 !== 0) {
    days.push({ key: 't' + days.length, date: '', day: '', inMonth: false })
  }
  const weeks = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  return weeks
}

module.exports = {
  pad: pad,
  parse: parse,
  today: today,
  addDays: addDays,
  todayAndYesterday: todayAndYesterday,
  weekStart: weekStart,
  dayLabel: dayLabel,
  monthKey: monthKey,
  monthLabel: monthLabel,
  monthLabelOf: monthLabelOf,
  WEEK_HEAD_LABELS: WEEK_HEAD_LABELS,
  monthGrid: monthGrid
}
