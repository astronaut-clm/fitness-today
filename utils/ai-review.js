// 训练后 AI 点评：结合本次训练数据与教练记忆（长期画像），生成一句针对性点评
// 按训练记录 ID 缓存：完成页反复进入不重复调用；失败静默，由页面保留默认文案兜底
const cloud = require('./cloud.js')
const ai = require('./ai-client.js')
const coachMemory = require('./coach-memory.js')
const storage = require('./storage.js')

const CACHE_KEY = 'ft_ai_review_v1'
const CACHE_MAX = 20 // 只留最近 20 次点评，防止本机存储膨胀
const TIMEOUT = 20000 // 流式断流兜底：超时强制结算，已流出部分照常展示

const SYSTEM = [
  '你是一名熟悉用户的健身教练，用户刚完成一次训练，写一句训练后点评。',
  '【要求】',
  '1. 40 字以内，口语化，像教练当面说话，禁止"很棒/继续加油"式空话。',
  '2. 先点一个本次的具体表现（完成度/用时/跳过情况），再给一个小建议或下一步。',
  '3. 结合 memory 长期画像让点评"认识他"：完成率趋势、训练积累、常练计划、用时水平。',
  '4. memory.totalSessions > 0 表示用户练过，禁止"首练/新用户/第一次"等说法；本次就是他 memory 里的最近一次。',
  '5. 直接输出点评文本，不要 JSON、不要引号、不要"点评："之类前缀。',
  '【安全】不给医疗建议、不诊断伤痛；跳过组较多时不指责，给可执行的替代建议；不承诺减重斤数与疗效。'
].join('\n')

function readCache() {
  return storage.read(CACHE_KEY, {})
}

function writeCache(map) {
  const keys = Object.keys(map)
  // 超出上限按 key 序（记录 ID 含日期与时间戳，近似先入先出）裁掉最旧的
  if (keys.length > CACHE_MAX) {
    keys.sort().slice(0, keys.length - CACHE_MAX).forEach(function (k) { delete map[k] })
  }
  storage.write(CACHE_KEY, map)
}

// input: { recordId, planName, done, total, skipped, costText, goal, records }
// onText(累计文本)：流式增量回调，缓存命中时一次性全量回调
// resolve { ok, text, cached? }；任何失败都 resolve { ok:false }，不打断完成页
function streamReview(input, onText) {
  const data = input || {}
  if (!data.recordId) return Promise.resolve({ ok: false })

  const hit = readCache()[data.recordId]
  if (hit) {
    if (onText) onText(hit)
    return Promise.resolve({ ok: true, text: hit, cached: true })
  }

  const payload = {
    plan: ai.safeStr(data.planName, 20),
    done: ai.clampNum(data.done, 99),
    total: ai.clampNum(data.total, 99),
    skipped: ai.clampNum(data.skipped, 99),
    cost: ai.safeStr(data.costText, 12),
    goal: ai.safeStr(data.goal, 20),
    memory: coachMemory.get(data.records)
  }

  return cloud.init().then(function (ok) {
    if (!ok) return { ok: false }
    return new Promise(function (resolve) {
      let acc = ''
      let settled = false
      // 断流/超时兜底：强制结算，已流出的部分照常展示
      const stall = setTimeout(function () { finish(acc) }, TIMEOUT)
      function finish(fullText) {
        if (settled) return
        settled = true
        clearTimeout(stall)
        const text = ai.safeStr(fullText || acc, 60)
        if (!text) { resolve({ ok: false }); return }
        const map = readCache()
        map[data.recordId] = text
        writeCache(map)
        resolve({ ok: true, text: text })
      }
      // 主动迭代 eventStream 驱动 UI：onText/onFinish 回调依赖 SDK 内部调度，
      // 不如迭代可靠；delta.reasoning_content 为思维链，只取 delta.content 正文
      function consume(res) {
        const it = res.eventStream[Symbol.asyncIterator]()
        function step() {
          if (settled) return
          it.next().then(function (r) {
            if (settled) return
            if (r.done) { finish(acc); return }
            const event = r.value || {}
            if (event.data === '[DONE]') { finish(acc); return }
            try {
              const parsed = JSON.parse(event.data)
              const choice = parsed.choices && parsed.choices[0]
              const delta = choice && choice.delta
              if (delta && delta.content) {
                acc += delta.content
                if (onText) onText(acc)
              }
            } catch (e) {}
            step()
          }, function () { finish(acc) })
        }
        step()
      }
      ai.streamText({
        // 一句点评属轻量任务：low 档推理足够；hy3-preview 思维链会吃光预算，直接关思考
        reasoningEffort: 'low',
        enableThinking: false,
        maxTokens: 800,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      }).then(consume, function (e) {
        console.warn('[ai] review failed', e && e.message)
        finish('')
      })
    })
  })
}

// 登出清理本机数据时调用
function resetLocal() {
  storage.remove(CACHE_KEY)
}

module.exports = {
  streamReview: streamReview,
  resetLocal: resetLocal
}
