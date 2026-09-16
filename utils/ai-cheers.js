// 跟练鼓励语 AI 生成：进入跟练页时按用户画像预生成一批，混入固定 CHEERS 池
// 预生成 + voice.warmup 预合成：播报零等待；生成失败/超时则自然落回固定池，体验无缝
//
// 关键决策：role 模型入戏后拒绝批量输出（prompt 怎么约束都只回一句），
// 改为「一次一句、多次并发」——单句正是 role 模型的强项，并发后总耗时≈单次调用
const cloud = require('./cloud.js')
const ai = require('./ai-client.js')
const coachMemory = require('./coach-memory.js')
const dateUtil = require('./date.js')
const storage = require('./storage.js')

// 生成结果按「当天 + 计划」缓存：中断后「继续训练」重进页面直接复用，
// 同一场训练不为同一批文案重复付费；次日/换计划自然重新生成
const CACHE_KEY = 'ft_ai_cheers_v1'
const TIMEOUT = 12000
// 并发路数按组数伸缩：ceil(组数/2) + 2，下限 6 保底多样性，上限 14 控成本；
// 风格循环复用，temperature 0.9 下同风格也不重样
const MIN_CALLS = 6
const MAX_CALLS = 14
// AI 句会混入固定 CHEERS 池（5 句），有 2 句新鲜文案组合多样性就够
const MIN_OK = 2
// 超过上限的句子直接丢弃（见 firstLine），不要腰斩成半截话；
// 20 字含标点约 4 秒播报，仍是短句但不会误杀正常文案
const MAX_LEN = 20

// 每路指定一种风格，天然保证句式不重复
const STYLES = ['激励打鸡血', '轻松调侃', '提醒发力和动作标准', '描绘练完后的成就感', '肯定他的坚持', '短促有力的口令']

function systemFor(style) {
  return [
    '你是健身教练，用户正在跟练，每组动作开始时你会播报一句鼓励。',
    '现在说一句「' + style + '」风格的鼓励语。',
    '【硬约束】',
    '1. 只输出这一句话本身：不要引号、不要编号、不要解释、不要称呼。',
    '2. ≤' + MAX_LEN + ' 字（含标点），纯中文口语，能直接念出来；不要 emoji。',
    '3. 结合 memory 画像让鼓励"认识他"：训练积累、目标、常练计划，但不许报具体数字。',
    '4. 禁止"第一次/首练/新手"类表述，用户的训练历史以 memory 为准，不许猜测。',
    '【安全】不给医疗建议、不提及伤痛、不承诺减重斤数与疗效。'
  ].join('\n')
}

// 取第一行有效文本，剥掉模型可能自带的编号/引号；超长的不要（截断会出半截话）
function firstLine(text) {
  const lines = String(text || '').split(/\n+/)
  for (let i = 0; i < lines.length; i++) {
    const cleaned = String(lines[i])
      .replace(/^\s*(?:\d{1,2}[.、)）]?|[-*•·])\s*/, '')
      .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
      .replace(/[\s　]+/g, '')
    if (cleaned.length >= 4 && cleaned.length <= MAX_LEN) return cleaned
  }
  return ''
}

// 单路生成：失败静默回空串，由汇总处统一判定
function fetchOne(style, payload) {
  return ai.withTimeout(ai.generateText({
    reasoningEffort: 'low',
    enableThinking: false,
    maxTokens: 200,
    temperature: 0.9,
    messages: [
      { role: 'system', content: systemFor(style) },
      { role: 'user', content: JSON.stringify(payload) }
    ]
  }), TIMEOUT).then(function (out) {
    return firstLine(out.text)
  }).catch(function (e) {
    console.warn('[ai] cheers one failed', style, e && e.message)
    return ''
  })
}

function readCache(planId) {
  const s = storage.read(CACHE_KEY)
  if (s && s.date === dateUtil.today() && s.planId === planId && (s.lines || []).length >= MIN_OK) return s.lines
  return null
}

function writeCache(planId, lines) {
  storage.write(CACHE_KEY, { date: dateUtil.today(), planId: planId, lines: lines })
}

// input: { planId, planName, records, goal, groups }
// resolve { ok, lines, cached? }；任何失败 resolve { ok:false }，调用方继续用固定池
function fetch(input) {
  const data = input || {}
  const cached = readCache(data.planId)
  if (cached) return Promise.resolve({ ok: true, lines: cached, cached: true })
  const payload = {
    plan: ai.safeStr(data.planName, 20),
    goal: ai.safeStr(data.goal, 20),
    memory: coachMemory.get(data.records)
  }
  // 组数未知时按默认 6 路；组数多 → 池子深，整场不易听重
  const groups = Number(data.groups) || 0
  const calls = groups > 0
    ? Math.min(MAX_CALLS, Math.max(MIN_CALLS, Math.ceil(groups / 2) + 2))
    : MIN_CALLS
  return cloud.init().then(function (ok) {
    if (!ok) return { ok: false }
    const styles = []
    for (let i = 0; i < calls; i++) styles.push(STYLES[i % STYLES.length])
    return Promise.all(styles.map(function (style) { return fetchOne(style, payload) })).then(function (lines) {
      const seen = {}
      const picked = []
      lines.forEach(function (text) {
        if (!text || seen[text]) return
        seen[text] = 1
        picked.push(text)
      })
      if (picked.length < MIN_OK) {
        console.warn('[ai] cheers too_few_lines', picked.length)
        return { ok: false }
      }
      writeCache(data.planId, picked)
      return { ok: true, lines: picked }
    })
  })
}

// 登出清理本机数据时调用
function resetLocal() {
  storage.remove(CACHE_KEY)
}

module.exports = { fetch: fetch, resetLocal: resetLocal }
