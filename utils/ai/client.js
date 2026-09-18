// 大模型统一入口，走小程序端 wx.cloud.extend.AI。
// 别改到云函数侧的 cloud.ai()：那是腾讯云 AI+ 通道，没有 cloudbase provider，会 404
const PROVIDER = 'cloudbase'
// 换模型前先用小请求验证：可用性因环境而异。
// hy3 系强制思维链会吃光输出预算（empty_result）；hy-role 需在 AI+ 控制台手动开通
const MODEL = 'hy-role'

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

function extractReasoning(res) {
  const choice = res && res.choices && res.choices[0]
  const reasoning = choice && choice.message && choice.message.reasoning_content
  return reasoning ? String(reasoning) : ''
}

// 模型偶尔包一层 ```json，取最外层花括号
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

// options: model / reasoningEffort / temperature / maxTokens / messages / enableThinking
function buildRequest(options) {
  const opts = options || {}
  const data = {
    model: opts.model || MODEL,
    reasoning_effort: opts.reasoningEffort || 'low',
    // 必须显式给足：默认值偏小，思维链一挤占正文就空（empty_result）
    max_tokens: opts.maxTokens || 2048,
    temperature: opts.temperature == null ? 0.3 : opts.temperature,
    messages: opts.messages || []
  }
  // 混元的 OpenAI 兼容参数，不支持时不报错
  if (opts.enableThinking === false) data.enable_thinking = false
  return data
}

// resolve { text, reasoning }，reasoning 未开深度推理时为空串
function generateText(options) {
  const model = getModel()
  if (!model) return Promise.reject(new Error('ai_unavailable'))
  return Promise.resolve(model.generateText(buildRequest(options))).then(function (res) {
    // 网关错误（403/限流/模型不支持）以 { code, message } 返回，抛真实错误码
    if (res && res.code) throw new Error(String(res.code))
    const text = extractText(res)
    if (!text) throw new Error('empty_result')
    return { text: text, reasoning: extractReasoning(res) }
  })
}

module.exports = {
  generateText: generateText,
  parseJson: parseJson,
  withTimeout: withTimeout,
  safeStr: safeStr,
  clampNum: clampNum,
  strList: strList
}
