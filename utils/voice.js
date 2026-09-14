// utils/voice.js 训练语音播报（基于「微信同声传译」WechatSI 插件）
// 预合成缓存 + 队列顺序播放（interrupt 可抢占）；插件缺失或合成失败时静默降级
const KEY = 'ft_voice_enabled_v1'
const LANG = 'zh_CN'

let plugin = null
try {
  plugin = requirePlugin('WechatSI')
} catch (e) {
  plugin = null
}
const available = !!(plugin && typeof plugin.textToSpeech === 'function')

const cache = {}    // text -> 本地音频路径
const pending = {}  // text -> 合成中的等待回调列表
const queue = []    // 待播放的音频路径
let current = null   // 当前正在播放的音频实例
let playing = false
let optionSet = false

function noop() {}

function enabled() {
  try { return wx.getStorageSync(KEY) !== false } catch (e) { return true }
}

function setEnabled(on) {
  try { wx.setStorageSync(KEY, !!on) } catch (e) {}
  if (!on) stop()
}

function ensureOption() {
  if (optionSet) return
  optionSet = true
  // 静音/锁屏下也要出声；与其他音频混播避免互相打断
  try { wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true, fail: noop }) } catch (e) {}
}

function synthesize(text, cb) {
  if (!text) { cb(''); return }
  if (cache[text]) { cb(cache[text]); return }
  if (!available) { cb(''); return }
  // 同一句合成中则挂到等待队列，避免重复请求
  if (pending[text]) { pending[text].push(cb); return }
  pending[text] = [cb]
  plugin.textToSpeech({
    lang: LANG,
    tts: true,
    content: text,
    success: function (res) {
      const path = (res && res.filename) || ''
      if (path) cache[text] = path
      const waiters = pending[text] || []
      delete pending[text]
      waiters.forEach(function (fn) { fn(path) })
    },
    fail: function () {
      const waiters = pending[text] || []
      delete pending[text]
      waiters.forEach(function (fn) { fn('') })
    }
  })
}

// 每次播放新建实例、播完即销毁；复用同一实例时 stop/play 时序竞争会让 onEnded 不触发、后续播报丢失
function playNext() {
  if (playing) return
  const path = queue.shift()
  if (!path) return
  ensureOption()
  const ctx = wx.createInnerAudioContext()
  if (!ctx) return
  playing = true
  current = ctx
  let settled = false
  function done() {
    if (settled) return
    settled = true
    if (current === ctx) current = null
    playing = false
    try { ctx.destroy() } catch (e) {}
    playNext()
  }
  ctx.obeyMuteSwitch = false
  ctx.onEnded(done)
  ctx.onError(done)
  ctx.src = path
  ctx.play()
}

// 播放一段文本；opts.interrupt=true 时清空待播队列
function speak(text, opts) {
  speakAll([text], opts)
}

// 顺序播放多段文本：先全部合成再按序入队，避免回调乱序导致后句先播
function speakAll(texts, opts) {
  if (!enabled()) return
  const list = (texts || []).filter(function (t) { return !!t })
  if (!list.length) return
  const interrupt = !!(opts && opts.interrupt)
  const paths = new Array(list.length)
  let remaining = list.length
  function flush() {
    if (interrupt) queue.length = 0
    paths.forEach(function (path) { if (path) queue.push(path) })
    if (!playing) playNext()
  }
  list.forEach(function (text, i) {
    synthesize(text, function (path) {
      paths[i] = path
      remaining--
      if (remaining === 0) flush()
    })
  })
}

// 预合成：提前把本次会用到的语句生成为本地音频
function warmup(texts) {
  if (!available || !enabled()) return
  const seen = {}
  ;(texts || []).forEach(function (text) {
    if (!text || seen[text]) return
    seen[text] = 1
    synthesize(text, noop)
  })
}

function stop() {
  queue.length = 0
  playing = false
  const ctx = current
  current = null
  if (ctx) {
    try { ctx.stop() } catch (e) {}
    try { ctx.destroy() } catch (e) {}
  }
}

function destroy() {
  stop()
}

module.exports = {
  available: available,
  enabled: enabled,
  setEnabled: setEnabled,
  speak: speak,
  speakAll: speakAll,
  warmup: warmup,
  stop: stop,
  destroy: destroy
}
