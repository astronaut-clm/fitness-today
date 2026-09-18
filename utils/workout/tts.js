// 语音播报引擎（WechatSI 插件）：预合成缓存 + 队列顺序播放，interrupt 可抢占。
// 插件缺失或合成失败一律静默降级
const storage = require('../storage.js')

const store = storage.scoped('ft_voice_enabled_v1')
const LANG = 'zh_CN'

let plugin = null
try {
  plugin = requirePlugin('WechatSI')
} catch (e) {
  plugin = null
}
const available = !!(plugin && typeof plugin.textToSpeech === 'function')

const cache = {}
const pending = {}
const queue = []
let current = null
let playing = false
let optionSet = false
let pendingInterrupt = 0 // 连续抢占时只执行最新一次

// 延时任务统一登记，dispose 时一次作废。
// 否则「抢占延时 60ms」会在离开页面后继续起播，训练页退出还漏出一句
const timers = new Set()

function later(fn, ms) {
  const id = setTimeout(function () {
    timers.delete(id)
    fn()
  }, ms)
  timers.add(id)
  return id
}

function clearTimers() {
  timers.forEach(function (id) { clearTimeout(id) })
  timers.clear()
  pendingInterrupt++ // 作废所有在飞的抢占任务
}

let enabledCache = null

function enabled() {
  if (enabledCache === null) {
    enabledCache = store.read() !== false
  }
  return enabledCache
}

function setEnabled(on) {
  enabledCache = !!on
  store.write(!!on)
  if (!on) stop()
}

function ensureOption() {
  if (optionSet) return
  optionSet = true
  // 静音/锁屏下也要出声；混播避免与其他音频互相打断
  try { wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true, fail: function () {} }) } catch (e) {}
}

function synthesize(text, cb) {
  if (!text) { cb(''); return }
  if (cache[text]) { cb(cache[text]); return }
  if (!available) { cb(''); return }
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

// 播完即销毁：复用时 stop/play 的时序竞争会让 onEnded 不触发
function playNext() {
  // 队列是延迟消费的，期间用户可能已关掉语音
  if (playing || !enabled()) return
  const path = queue.shift()
  if (!path) return
  ensureOption()
  let ctx = null
  try {
    ctx = wx.createInnerAudioContext()
  } catch (e) {
    ctx = null
  }
  if (!ctx) return
  playing = true
  current = ctx
  let settled = false
  function done() {
    if (settled) return
    settled = true
    if (current !== ctx) return // 已被抢占，播放状态交给抢占方
    current = null
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

// opts.interrupt=true 时清空队列并打断当前播报
function speak(text, opts) {
  speakAll([text], opts)
}

// 先全部合成再按序入队，避免回调乱序导致后句先播
function speakAll(texts, opts) {
  if (!enabled()) return
  const list = (texts || []).filter(function (t) { return !!t })
  if (!list.length) return
  const interrupt = !!(opts && opts.interrupt)
  const paths = new Array(list.length)
  let remaining = list.length
  function flush() {
    if (interrupt) {
      // 点击场景下打断延后 60ms：stop/destroy 开销大，得等点击回调返回、界面画完，
      // 否则阻塞 JS 线程造成按钮卡顿。计时器场景（nowait）无此顾虑，立即执行
      queue.length = 0
      const seq = ++pendingInterrupt
      later(function () {
        if (seq !== pendingInterrupt) return
        stop()
        paths.forEach(function (path) { if (path) queue.push(path) })
        playNext()
      }, opts && opts.nowait ? 0 : 60)
      return
    }
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

// 提前设置 src 触发下载/解码，降低首次起播延迟。
// 串行执行且播报时让路，避免与播放管线竞争
const preloadQueue = []
let preloading = false

function runPreload() {
  if (preloading) return
  if (playing) { later(runPreload, 500); return }
  const path = preloadQueue.shift()
  if (!path) return
  preloading = true
  try {
    const ctx = wx.createInnerAudioContext()
    let released = false
    function release() {
      if (released) return
      released = true
      try { ctx.destroy() } catch (e) {}
      preloading = false
      runPreload()
    }
    ctx.onCanplay(release)
    ctx.onError(release)
    ctx.src = path
    later(release, 3000)
  } catch (e) {
    preloading = false
    runPreload()
  }
}

function preload(path) {
  if (!path) return
  preloadQueue.push(path)
  runPreload()
}

function warmup(texts) {
  if (!available || !enabled()) return
  const seen = {}
  ;(texts || []).forEach(function (text) {
    if (!text || seen[text]) return
    seen[text] = 1
    synthesize(text, preload)
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

// 离开训练页必须调用：只调 stop() 收不干净（抢占定时器会重新起播）
function dispose() {
  clearTimers()
  stop()
  preloadQueue.length = 0
  preloading = false
}

module.exports = {
  available: available,
  enabled: enabled,
  setEnabled: setEnabled,
  speak: speak,
  warmup: warmup,
  stop: stop,
  dispose: dispose
}
