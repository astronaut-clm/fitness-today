// utils/voice.js 训练语音播报
// 基于「微信同声传译」插件（需在 app.json 的 plugins 中声明为 WechatSI）的语音合成能力，
// 为跟练过程提供语音提示（动作播报 / 休息提示 / 倒数 / 完成）。
//
// 设计要点：
// 1) 预合成：训练开始前把本次会用到的语句先合成为本地音频并缓存，
//    之后播放直接读本地文件，避免每次播报都要等网络合成导致提示滞后。
// 2) 队列播放：多条播报按顺序播放，互不打断；
//    倒计时这类需要「即时抢占」的场景可用 interrupt 清空待播队列。
// 3) 可降级：插件未声明或合成失败时静默跳过，不影响任何训练流程。
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
  if (typeof wx.setInnerAudioOption === 'function') {
    // 健身场景常在静音/锁屏下使用，需要越过静音开关；与其他音频混播避免互相打断。
    try { wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true, fail: noop }) } catch (e) {}
  }
}

function synthesize(text, cb) {
  if (!text) { cb(''); return }
  if (cache[text]) { cb(cache[text]); return }
  if (!available) { cb(''); return }
  // 同一句正在合成时挂到等待队列，避免重复请求
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

// 每次播放都新建独立实例、播完即销毁：
// 复用同一个实例时，stop() 与后续 play() 存在时序竞争，会导致 onEnded 不触发、
// playing 卡在 true，后续播报被静默丢弃（表现为「只有前几组有声音」）。
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

// 播放一段文本；opts.interrupt 为 true 时清空待播队列（倒计时抢占用）。
// 复用 speakAll 的顺序入队逻辑，单条即长度为 1 的顺序序列。
function speak(text, opts) {
  speakAll([text], opts)
}

// 顺序播放多段文本：先全部合成，再按传入顺序入队，
// 避免未预热时合成回调乱序导致后来的语句先播（如口号先于动作名）。
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

// 预合成：训练开始前调用，把本次会用到的语句提前生成为本地音频
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
