// 周复盘：hy3 深度推理（免费额度），按周出一份——本周日 08:00 之后才生成。
// 缓存以周一日期为键，跨周自动重算，未出新的之前继续展示上周那份
const cloud = require('../cloud.js')
const ai = require('./client.js')
const coachMemory = require('./coach-profile.js')
const dateUtil = require('../date.js')
const storage = require('../storage.js')
const throttle = require('../throttle.js')
const recordStore = require('../records.js')

const store = storage.scoped('ft_ai_weekly_v1')
const flight = throttle.flight()
// 出点评不赶时间：宁可等也不掐断，超时放宽到 5 分钟（深度推理本来就慢）
const TIMEOUT = 5 * 60 * 1000
// 失败后 1 小时内不自动重试。窗口只有周日一天，间隔太长等于当天再也不重试
const RETRY_GAP = 3600 * 1000

const SYSTEM = [
  '你是健身教练，为用户写本周训练复盘。',
  '【硬约束】',
  '1. 严格输出 JSON：{"highlight":"...","improve":"...","next":"..."}',
  '2. highlight 本周亮点 ≤50 字，落到具体数据（次数/时长/连续天数）；improve 一个可以更好的点 ≤40 字，不指责；next 下周一个可执行建议 ≤40 字。',
  '3. 口语化，像教练当面做周总结，禁止"继续坚持"式空话。',
  '4. 结合 memory 长期画像（训练积累、趋势、节奏）让复盘"认识他"；memory.totalSessions>0 时禁止"首练/新用户"表述。',
  '【安全】不给医疗建议、不诊断伤痛、不承诺减重斤数与疗效。'
].join('\n')

// 统计 [start, end] 内的训练：次数、天数、总时长、完成率
function rangeStats(records, start, end) {
  let sessions = 0
  let minutes = 0
  let done = 0
  let total = 0
  const days = {}
  ;(records || []).forEach(function (r) {
    if (r.type !== recordStore.TYPE_PLAN || r.date < start || r.date > end) return
    sessions++
    minutes += Number(r.actualMinutes || 0)
    done += Number(r.completedGroups || 0)
    total += Number(r.totalGroups || 0)
    days[r.date] = true
  })
  return {
    sessions: sessions,
    days: Object.keys(days).length,
    minutes: minutes,
    completionRate: total > 0 ? Math.round(done / total * 100) : 0
  }
}

// 解锁判据：本周训练次数
function weekSessions(records) {
  return rangeStats(records, dateUtil.weekStart(), dateUtil.today()).sessions
}

// 是否已到出点评的时刻（本周日 08:00）
function due() {
  return Date.now() >= dateUtil.weekReviewAt()
}

// 一周只出一份：命中本周缓存直接返回，且始终走单飞。resolve { ok, data, cached?, week? }
function fetchWeekly(input) {
  const data = input || {}
  const wk = dateUtil.weekStart()
  const today = dateUtil.today()
  const saved = store.read()
  const ready = due()

  if (saved && saved.week === wk) {
    if (saved.data) return Promise.resolve({ ok: true, cached: true, data: saved.data, week: wk })
    // 失败水位，免得每次进页面都重试烧额度
    if (Date.now() - Number(saved.attemptedAt || 0) < RETRY_GAP) return Promise.resolve({ ok: false })
  }
  if (!ready) {
    // 本周还没出，上周那份继续展示，等下个周日 08:00 再算新的
    if (saved && saved.data && saved.week === dateUtil.addDays(wk, -7)) {
      return Promise.resolve({ ok: true, cached: true, data: saved.data, week: saved.week })
    }
    return Promise.resolve({ ok: false, code: 'not_due' })
  }
  // 同一周的并发调用共用一次请求
  const pending = flight.get(wk)
  if (pending) return pending

  // 脏记录会让统计同步抛异常，转成明确的失败
  let payload
  try {
    payload = {
      week: { start: wk, end: today },
      thisWeek: rangeStats(data.records, wk, today),
      lastWeek: rangeStats(data.records, dateUtil.addDays(wk, -7), dateUtil.addDays(wk, -1)),
      goal: ai.safeStr(data.goal, 20),
      memory: coachMemory.get()
    }
  } catch (e) {
    console.warn('[ai] weekly stats failed', e && e.message)
    return Promise.resolve({ ok: false })
  }

  function start() {
    return cloud.init().then(function (ok) {
      if (!ok) return { ok: false }
      if (!store.write({ week: wk, data: (saved && saved.week === wk && saved.data) || null, attemptedAt: Date.now() })) return { ok: false }
      return ai.withTimeout(ai.generateText({
        model: 'hy3', // 免费额度；强制思维链适合复盘的多因素权衡，慢无所谓（后台任务）
        reasoningEffort: 'medium',
        maxTokens: 3000, // 思维链会占预算，给足避免挤空正文
        temperature: 0.5,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      }), TIMEOUT).then(function (out) {
        const raw = ai.parseJson(out.text)
        const review = {
          highlight: ai.safeStr(raw.highlight, 60),
          improve: ai.safeStr(raw.improve, 50),
          next: ai.safeStr(raw.next, 50)
        }
        if (!review.highlight) throw new Error('bad_review')
        store.write({ week: wk, data: review, attemptedAt: Date.now() })
        return { ok: true, data: review, week: wk }
      }).catch(function (e) {
        console.warn('[ai] weekly failed', e && e.message)
        return { ok: false }
      })
    })
  }

  return flight.run(wk, start)
}

function resetLocal() {
  store.remove()
  flight.clear()
}

module.exports = {
  fetchWeekly: fetchWeekly,
  weekSessions: weekSessions,
  due: due,
  resetLocal: resetLocal
}
