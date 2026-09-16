// AI 重排：规则打分出候选 → 让模型选一个并给出理由；失败时保持不变
// 模型调用统一走 ai-client（provider=cloudbase，微信云开发售卖的模型）
const cloud = require('./cloud.js')
const recommend = require('./recommend.js')
const insights = require('./insights.js')
const dateUtil = require('./date.js')
const coachMemory = require('./coach-memory.js')
const ai = require('./ai-client.js')
const storage = require('./storage.js')

const safeStr = ai.safeStr
const clampNum = ai.clampNum
const strList = ai.strList

const CANDIDATE_SIZE = 5
// 细节窗口只保留近 7 条：输入越小思考越快；更早的历史由 memory 摘要覆盖
const RECENT_SIZE = 7
// 推理档位：推荐是首页交互场景，medium 深度推理在当前通道下频繁超时（30s 都不够），
// 用 low 轻量推理——有 memory 画像加持，决策质量足够；周复盘类后台场景才值得 medium+
const REASONING_EFFORT = 'low'
const TIMEOUT = 15000
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
  '【教练记忆】memory 是该用户的长期画像，字段含义：',
  '- since/totalSessions/totalMinutes：训练起点与积累；avgMinutes：单次平均时长（推荐时长不宜大幅超过它）。',
  '- completionRate/recentCompletionRate：全部与近 14 天完成率；trend：近 14 天较之前 14 天完成率趋势，up/flat/down/new（刚起步）。',
  '- topPlans：常练计划；weekdayRhythm：近 8 周每周日~周六（下标 0=周日）训练次数，反映作息节奏。',
  '- muscles30d：近 30 天各肌群组数，长期偏科的肌群可适当补练。',
  '记忆优先于默认经验：trend=down 或 recentCompletionRate 明显低于 completionRate → 降难度、缩短时长；trend=up 且周目标已达成 → 可进阶。',
  '【措辞红线】totalSessions > 0 表示用户练过，禁止"首练/新用户/第一次训练"等说法；trend=new 仅表示近两周刚起步，不等于没练过。可用 since/totalSessions 体现陪伴感（如"第 2 练"），但 reason 里不许堆数字。',
  '【安全】不给医疗建议、不诊断伤痛；用户提及疼痛或伤病 → 建议休息并咨询专业人士。不承诺减重斤数与疗效。'
].join('\n')

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
    memory: coachMemory.get(records),
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
  return storage.read(CACHE_KEY)
}

function writeStore(v) {
  storage.write(CACHE_KEY, v)
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
  return cloud.init().then(function (ok) {
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

    const startedAt = Date.now()
    const req = ai.generateText({
      // 当天超时过（cur.slow）自动降 low 档：宁要轻量推理的结果，不要 medium 的再次超时
      reasoningEffort: cur.slow ? 'low' : REASONING_EFFORT,
      // hy3-preview 思维链话痨会吃光输出预算（empty_result 根因）：交互场景直接关思考
      enableThinking: false,
      // 关思考后输出仅 ~50 token JSON，800 绰绰有余
      maxTokens: 800,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(payload) }
      ]
    })

    function toPick(out) {
      const raw = ai.parseJson(out.text)
      const id = safeStr(raw && raw.planId, 40)
      // 关键校验：planId 必须在候选集内，防模型幻觉
      if (!payload.candidates.some(function (c) { return c.id === id })) throw new Error('bad_plan')
      return { planId: id, reason: safeStr(raw.reason, 40), byAI: true }
    }

    // 迟到也收货：withTimeout 只是前端放弃等待，模型多半能在服务端跑完。
    // 结果迟到时写入缓存，下次进页面（同日同签名）直接命中，超时不再是纯损失
    req.then(function (out) {
      try {
        const latest = readStore()
        if (!latest || latest.date !== today || latest.sig !== sig || latest.pick) return
        latest.pick = toPick(out)
        writeStore(latest)
      } catch (e) {}
    }, function () {})

    return ai.withTimeout(req, TIMEOUT)
      .then(function (out) {
        const pick = toPick(out)
        cur.pick = pick
        writeStore(cur)
        return Object.assign({ ok: true, cached: false }, pick)
      })
      .catch(function (e) {
        console.warn('[ai] recommend failed', e && e.message, (Date.now() - startedAt) + 'ms')
        // 记录超时标记：当天后续调用降档，避免同一网络环境下反复超时
        if (e && e.message === 'timeout' && !cur.slow) {
          cur.slow = true
          writeStore(cur)
        }
        // 失败也保留上次结果，避免卡片在多次 refresh 间闪回
        if (cur.pick) return Object.assign({ ok: true }, cur.pick)
        return { ok: false }
      })
  })
}

module.exports = { fetchPlan: fetchPlan }
