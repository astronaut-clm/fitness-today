// AI 重排：规则打分出候选 → 模型选一个并给理由；失败保持规则结果不变
const cloud = require('../cloud.js')
const recommend = require('../recommend.js')
const insights = require('../insights.js')
const dateUtil = require('../date.js')
const coachMemory = require('./coach-profile.js')
const ai = require('./client.js')
const storage = require('../storage.js')
const throttle = require('../throttle.js')

const safeStr = ai.safeStr
const clampNum = ai.clampNum
const strList = ai.strList

const CANDIDATE_SIZE = 5
// 只带近 7 条明细，输入越小思考越快；更早的历史由 memory 摘要覆盖
const RECENT_SIZE = 7
// 首页是交互场景，medium 频繁超时；有 memory 画像加持，low 的质量够用
const REASONING_EFFORT = 'low'
const TIMEOUT = 15000
const DAILY_LIMIT = 2
const store = storage.scoped('ft_ai_rec')
const flight = throttle.flight()

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

// 只传训练信号，不传 openid / 昵称 / 头像
function buildPayload(records, profile) {
  const p = profile || {}
  const built = insights.weekProgress(records, p)
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
    memory: coachMemory.get(),
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

// 同一天输入没变就复用上次结果
function signature(payload) {
  return [
    payload.goal,
    payload.scenes.join(','),
    payload.experience,
    payload.equipment.join(','),
    payload.candidates.map(function (c) { return c.id }).join(',')
  ].join('|')
}

// 额度判断必须在「是否已有结果」之前：模型持续失败时 pick 一直为空，
// 先判 pick 会每次都返回 null，onShow 就无限重打模型，DAILY_LIMIT 形同虚设
function readCached(today, sig) {
  const s = store.read()
  if (!s || s.date !== today) return null
  if (s.pick && s.sig === sig) return Object.assign({ ok: true }, s.pick)
  if (Number(s.calls || 0) >= DAILY_LIMIT) {
    // 额度用完：有旧结果就复用，没有则明确失败让调用方降级
    return s.pick ? Object.assign({ ok: true }, s.pick) : { ok: false, code: 'daily_limit' }
  }
  return null
}

function fetchPlan(records, profile) {
  // buildPayload 会穿三层，脏记录会让它同步抛异常，别打断页面生命周期
  let payload
  try {
    payload = buildPayload(records, profile)
  } catch (e) {
    console.warn('[ai] payload failed', e && e.message)
    return Promise.resolve({ ok: false })
  }
  if (!payload.candidates.length) return Promise.resolve({ ok: false })

  const sig = signature(payload)
  const cached = readCached(dateUtil.today(), sig)
  if (cached) return Promise.resolve(cached)
  // 同一输入的并发调用共用一次请求
  return flight.run(sig, function () { return run(dateUtil.today(), sig, payload) })
}

function run(today, sig, payload) {
  return cloud.init().then(function (ok) {
    if (!ok) return { ok: false }
    const saved = store.read()
    const cur = (saved && saved.date === today)
      ? saved
      : { date: today, sig: sig, pick: null, calls: 0 }
    // 可能已被兄弟请求写满当天额度
    if (Number(cur.calls || 0) >= DAILY_LIMIT) {
      return cur.pick ? Object.assign({ ok: true }, cur.pick) : { ok: false, code: 'daily_limit' }
    }

    cur.sig = sig
    // 先计数再打模型，免得并发/重试把额度打穿
    cur.calls = Number(cur.calls || 0) + 1
    // 计数没落盘就等于没有额度账本，宁可放弃本次调用也不打穿限额
    if (!store.write(cur)) return { ok: false, code: 'write_failed' }

    const startedAt = Date.now()
    const req = ai.generateText({
      reasoningEffort: REASONING_EFFORT,
      enableThinking: false, // 思维链会吃光输出预算（empty_result 根因）
      maxTokens: 800, // 关思考后输出仅 ~50 token JSON
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(payload) }
      ]
    })

    function toPick(out) {
      const raw = ai.parseJson(out.text)
      const id = safeStr(raw && raw.planId, 40)
      // planId 必须在候选集内，防模型幻觉
      if (!payload.candidates.some(function (c) { return c.id === id })) throw new Error('bad_plan')
      return { planId: id, reason: safeStr(raw.reason, 40), byAI: true }
    }

    // 迟到也收货：withTimeout 只是前端放弃等待，服务端多半跑完了。
    // 写进缓存，下次进页面（同日同签名）直接命中，超时不再是纯损失
    req.then(function (out) {
      try {
        const latest = store.read()
        if (!latest || latest.date !== today || latest.sig !== sig || latest.pick) return
        latest.pick = toPick(out)
        store.write(latest)
      } catch (e) {}
    }, function () {})

    return ai.withTimeout(req, TIMEOUT)
      .then(function (out) {
        const pick = toPick(out)
        cur.pick = pick
        store.write(cur)
        return Object.assign({ ok: true, cached: false }, pick)
      })
      .catch(function (e) {
        console.warn('[ai] recommend failed', e && e.message, (Date.now() - startedAt) + 'ms')
        // 失败保留上次结果，避免卡片在多次 refresh 间闪回
        if (cur.pick) return Object.assign({ ok: true }, cur.pick)
        return { ok: false }
      })
  })
}

// 换号/登出必须清理，否则新账号会命中上个用户的推荐与已消耗的额度
function resetLocal() {
  store.remove()
  flight.clear()
}

module.exports = { fetchPlan: fetchPlan, resetLocal: resetLocal }
