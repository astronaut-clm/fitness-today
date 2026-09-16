// 周训练复盘：hy3 深度推理（免费额度），后台任务不怕慢——45s 超时 + 按周缓存
// 触发：打卡页展示时自动生成（本周练过 ≥2 次）；缓存按周一日期为键，跨周自动重算
const cloud = require('./cloud.js')
const ai = require('./ai-client.js')
const coachMemory = require('./coach-memory.js')
const dateUtil = require('./date.js')
const storage = require('./storage.js')

const KEY = 'ft_ai_weekly_v1'
const TIMEOUT = 45000
const RETRY_GAP = 6 * 3600 * 1000 // 失败后 6 小时内不自动重试（手动「换一版」不受限）

const SYSTEM = [
  '你是健身教练，为用户写本周训练复盘。',
  '【硬约束】',
  '1. 严格输出 JSON：{"highlight":"...","improve":"...","next":"..."}',
  '2. highlight 本周亮点 ≤50 字，落到具体数据（次数/时长/连续天数）；improve 一个可以更好的点 ≤40 字，不指责；next 下周一个可执行建议 ≤40 字。',
  '3. 口语化，像教练当面做周总结，禁止"继续坚持"式空话。',
  '4. 结合 memory 长期画像（训练积累、趋势、节奏）让复盘"认识他"；memory.totalSessions>0 时禁止"首练/新用户"表述。',
  '【安全】不给医疗建议、不诊断伤痛、不承诺减重斤数与疗效。'
].join('\n')

function rangeStats(records, start, end) {
  let sessions = 0
  let minutes = 0
  let done = 0
  let total = 0
  const days = {}
  ;(records || []).forEach(function (r) {
    if (r.date < start || r.date > end || r.type !== 'plan') return
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

function readStore() {
  return storage.read(KEY)
}

function writeStore(v) {
  storage.write(KEY, v)
}

// 本周训练次数（调用方据此决定是否解锁复盘）
function weekSessions(records) {
  const wk = dateUtil.weekStart()
  const today = dateUtil.today()
  let sessions = 0
  ;(records || []).forEach(function (r) {
    if (r.date >= wk && r.date <= today && r.type === 'plan') sessions++
  })
  return sessions
}

// input: { records, goal }；opts.force 跳过缓存与水位（手动「换一版」）
// resolve { ok, data: { highlight, improve, next }, cached? }
function fetchWeekly(input, opts) {
  const data = input || {}
  const force = !!(opts && opts.force)
  const wk = dateUtil.weekStart()
  const today = dateUtil.today()
  const store = readStore()

  if (!force && store && store.week === wk) {
    if (store.data) return Promise.resolve({ ok: true, cached: true, data: store.data })
    // 失败水位：避免每次进页面都重试烧额度
    if (Date.now() - Number(store.attemptedAt || 0) < RETRY_GAP) return Promise.resolve({ ok: false })
  }

  const thisWeek = rangeStats(data.records, wk, today)
  const lastWeek = rangeStats(data.records, dateUtil.addDays(wk, -7), dateUtil.addDays(wk, -1))
  const payload = {
    week: { start: wk, end: today },
    thisWeek: thisWeek,
    lastWeek: lastWeek,
    goal: ai.safeStr(data.goal, 20),
    memory: coachMemory.get(data.records)
  }

  return cloud.init().then(function (ok) {
    if (!ok) return { ok: false }
    writeStore({ week: wk, data: (store && store.week === wk && store.data) || null, attemptedAt: Date.now() })
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
      writeStore({ week: wk, data: review, attemptedAt: Date.now() })
      return { ok: true, data: review }
    }).catch(function (e) {
      console.warn('[ai] weekly failed', e && e.message)
      return { ok: false }
    })
  })
}

// 登出清理本机数据时调用
function resetLocal() {
  storage.remove(KEY)
}

module.exports = {
  fetchWeekly: fetchWeekly,
  weekSessions: weekSessions,
  resetLocal: resetLocal
}
