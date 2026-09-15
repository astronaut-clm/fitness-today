// AI 重排：规则打分出候选 → 让模型选一个并给出理由；失败时保持规则结果不变
// 走小程序端 wx.cloud.extend.AI（provider=cloudbase，微信云开发售卖的模型）
// 云函数侧 wx-server-sdk 的 cloud.ai() 是腾讯云 AI+ 通道，没有 cloudbase 这个 provider，会 404
const cloud = require('./cloud.js')
const recommend = require('./recommend.js')
const insights = require('./insights.js')
const dateUtil = require('./date.js')

const CANDIDATE_SIZE = 5
const RECENT_SIZE = 14
const PROVIDER = 'cloudbase'
const AI_MODEL = 'hy3-preview'
const TIMEOUT = 8000
const DAILY_LIMIT = 2
const CACHE_KEY = 'ft_ai_rec'

const SYSTEM = [
  '你是一名资深健身教练，为小程序用户推荐「今天该练哪个计划」。',
  '【硬约束】',
  '1. 只能从 candidates 中选择，返回的 planId 必须完全等于其中某一项的 id。',
  '2. 严格输出 JSON，不要任何额外文字：{"planId":"...","reason":"..."}',
  '3. reason ≤ 20 字，口语化、具体，说明「为什么今天练这个」，禁止空话。',
  '【决策原则】',
  '1. 场景、器械不匹配直接排除。',
  '2. 难度贴近用户经验，宁易勿难；新手优先短时全身。',
  '3. 避开 fatigue 中列出的肌群（近 3 天练过）。',
  '4. 本周目标未达成 → 优先能保证完成的中短时长；已达成 → 可给更有挑战的。',
  '5. 连续训练 ≥3 天 → 安排低强度或时长最短的。',
  '6. 近期 done/total 偏低（完成率 < 60%）→ 降一档难度。',
  '【安全】不给医疗建议、不诊断伤痛；用户提及疼痛或伤病 → 建议休息并咨询专业人士。不承诺减重斤数与疗效。'
].join('\n')

function safeStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max)
}

function clampNum(v, max) {
  const n = Number(v)
  return isNaN(n) ? 0 : Math.min(max, Math.max(0, n))
}

function strList(v, max, limit) {
  return (Array.isArray(v) ? v : []).map(function (s) { return safeStr(s, max) }).slice(0, limit)
}

// 只传训练相关信号，不传 openid / 昵称 / 头像
function buildPayload(records, profile) {
  const p = profile || {}
  const built = insights.build(records, p)
  const recent = (records || []).slice(0, RECENT_SIZE).map(function (r) {
    return {
      date: safeStr(r.date, 10),
      name: safeStr(r.planName, 20),
      minutes: clampNum(r.actualMinutes, 600),
      done: clampNum(r.completedGroups, 99),
      total: clampNum(r.totalGroups, 99)
    }
  })
  const candidates = recommend.rank(records, p, CANDIDATE_SIZE).map(function (item) {
    return {
      id: safeStr(item.plan.id, 40),
      name: safeStr(item.plan.name, 20),
      level: safeStr(item.plan.level, 4),
      duration: clampNum(item.plan.duration, 300),
      tags: strList(item.plan.tags, 6, 3)
    }
  }).filter(function (c) { return c.id && c.name })

  return {
    goal: safeStr(p.goal, 20),
    scenes: strList(p.scenes, 10, 2),
    experience: safeStr(p.experience, 4),
    equipment: strList(p.equipment, 10, 3),
    week: {
      days: built.weekDays,
      targetDays: built.targetDays,
      minutes: built.weekMinutes,
      targetMinutes: built.targetMinutes
    },
    recent: recent,
    fatigue: Object.keys(insights.recentMuscles(records)),
    candidates: candidates
  }
}

// 输入指纹：同一天输入没变就复用上次结果
function signature(payload) {
  return [
    payload.goal,
    payload.scenes.join(','),
    payload.experience,
    payload.equipment.join(','),
    payload.candidates.map(function (c) { return c.id }).join(',')
  ].join('|')
}

function readStore() {
  try { return wx.getStorageSync(CACHE_KEY) || null } catch (e) { return null }
}

function writeStore(v) {
  try { wx.setStorageSync(CACHE_KEY, v) } catch (e) {}
}

// 命中缓存直接返回，不需要云环境；多次 refresh 时不会把已出的 AI 结果冲掉
function readCached(today, sig) {
  const s = readStore()
  if (!s || s.date !== today || !s.pick) return null
  if (s.sig === sig) return Object.assign({ ok: true }, s.pick)
  // 当天额度用完：复用上次结果，不再打模型
  if (Number(s.calls || 0) >= DAILY_LIMIT) return Object.assign({ ok: true }, s.pick)
  return null
}

function getModel() {
  try {
    const ai = wx.cloud.extend && wx.cloud.extend.AI
    if (!ai || typeof ai.createModel !== 'function') return null
    return ai.createModel(PROVIDER)
  } catch (e) {
    return null
  }
}

function extractText(res) {
  if (!res) return ''
  const choice = res.choices && res.choices[0]
  const content = choice && choice.message && choice.message.content
  if (content) return String(content)
  return typeof res.text === 'string' ? res.text : ''
}

// 模型偶尔会包一层 ```json，取最外层花括号
function parseJson(text) {
  const s = String(text).trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('bad_json')
  return JSON.parse(s.slice(start, end + 1))
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { reject(new Error('timeout')) }, ms)
    promise.then(function (v) { clearTimeout(timer); resolve(v) }, function (e) { clearTimeout(timer); reject(e) })
  })
}

function generateText(payload) {
  const model = getModel()
  if (!model) return Promise.reject(new Error('ai_unavailable'))
  return Promise.resolve(model.generateText({
    model: AI_MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(payload) }
    ]
  })).then(function (res) {
    const text = extractText(res)
    if (!text) throw new Error('empty_result')
    return text
  })
}

let inflight = null // { sig, promise }：同一输入的并发调用共用一次请求

function fetchPlan(records, profile) {
  const payload = buildPayload(records, profile)
  if (!payload.candidates.length) return Promise.resolve({ ok: false })

  const sig = signature(payload)
  const cached = readCached(dateUtil.today(), sig)
  if (cached) return Promise.resolve(cached)
  if (inflight && inflight.sig === sig) return inflight.promise

  const req = run(dateUtil.today(), sig, payload)
  inflight = { sig: sig, promise: req }
  // 请求结束后释放 inflight，避免后续同 sig 调用命中已 settle 的旧 promise（缓存层仍可兜底）
  req.then(function () {
    if (inflight && inflight.promise === req) inflight = null
  }, function () {})
  return req
}

function run(today, sig, payload) {
  return cloud.ready().then(function (ok) {
    if (!ok) return { ok: false }
    const store = readStore()
    const cur = (store && store.date === today)
      ? store
      : { date: today, sig: sig, pick: null, calls: 0 }
    // 竞态：并发进来时已被兄弟请求写满额度
    if (cur.pick && Number(cur.calls || 0) >= DAILY_LIMIT) {
      return Object.assign({ ok: true }, cur.pick)
    }

    cur.sig = sig
    // 先计数再打模型，避免并发/重试把当天额度打穿
    cur.calls = Number(cur.calls || 0) + 1
    writeStore(cur)

    return withTimeout(generateText(payload), TIMEOUT)
      .then(parseJson)
      .then(function (raw) {
        const id = safeStr(raw && raw.planId, 40)
        // 关键校验：planId 必须在候选集内，防模型幻觉
        if (!payload.candidates.some(function (c) { return c.id === id })) throw new Error('bad_plan')
        const pick = {
          planId: id,
          reason: safeStr(raw.reason, 40),
          byAI: true
        }
        cur.pick = pick
        writeStore(cur)
        return Object.assign({ ok: true, cached: false }, pick)
      })
      .catch(function (e) {
        console.warn('[ai] recommend failed', e && e.message)
        // 失败也保留上次结果，避免卡片在多次 refresh 间闪回
        if (cur.pick) return Object.assign({ ok: true }, cur.pick)
        return { ok: false }
      })
  })
}

module.exports = { fetchPlan: fetchPlan }
