// 训练语音播报（基于「微信同声传译」WechatSI 插件）
// 预合成缓存 + 队列顺序播放（interrupt 可抢占）；插件缺失或合成失败时静默降级
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
let pendingInterrupt = 0 // 抢占任务序号：连续抢占时只执行最新一次

// 所有延时任务登记在此：停止播放或页面卸载时可一次性作废。
// 否则「抢占延时 60ms」这类定时器会在离开页面后继续执行 stop/入队/起播，
// 训练页退出后还会漏出一句话
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
  // 作废所有在飞的抢占任务，避免它们继续执行 stop/入队/起播
  pendingInterrupt++
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
  if (!on) {
    stop()
    releaseAllHot()
  }
}

function ensureOption() {
  if (optionSet) return
  optionSet = true
  // 静音/锁屏下也要出声；与其他音频混播避免互相打断
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

// 热实例池：path -> 已预解码的 InnerAudioContext，播报时拿来即播（起播零解码延迟）；
// 消费后立即补货（倒数读秒每组都用），实例播完即销毁不复用（复用的 stop/play 时序竞争会让 onEnded 不触发）
const hot = {}
const hotText = {}
// 热实例数量上限：句子有限但可能长期占用音频通道，超出后按创建顺序淘汰最早的
const HOT_MAX = 20

function releaseHot(path) {
  const ctx = hot[path]
  delete hot[path]
  delete hotText[path]
  if (!ctx) return
  try { ctx.destroy() } catch (e) {}
}

// 关掉语音或离开页面时释放整个热实例池：否则这批实例会一直占着音频通道
function releaseAllHot() {
  Object.keys(hot).forEach(function (path) { releaseHot(path) })
}

// 每次播放优先消费热实例，否则新建；播完即销毁
function playNext() {
  // 队列是延迟消费的，期间用户可能已关掉语音（含延迟到达的句子），这里兜底
  if (playing || !enabled()) return
  const path = queue.shift()
  if (!path) return
  ensureOption()
  let ctx = hot[path] || null
  const wasHot = !!ctx
  if (wasHot) {
    delete hot[path]
    const text = hotText[path]
    if (text) { delete hotText[path]; heat(text) }
  } else {
    ctx = wx.createInnerAudioContext()
  }
  if (!ctx) return
  playing = true
  current = ctx
  let settled = false
  function done() {
    if (settled) return
    settled = true
    // 已被 stop() 抢占（interrupt / 页面隐藏），播放状态由抢占方接管
    if (current !== ctx) return
    current = null
    playing = false
    try { ctx.destroy() } catch (e) {}
    playNext()
  }
  ctx.obeyMuteSwitch = false
  ctx.onEnded(done)
  ctx.onError(done)
  if (!wasHot) ctx.src = path
  ctx.play()
}

// 对起播延迟敏感的语句（如倒数读秒）：合成完成后常驻已解码实例，播报时无需再加载
function heat(text) {
  if (!available || !enabled()) return
  synthesize(text, function (path) {
    if (!path || hot[path]) return
    try {
      const ctx = wx.createInnerAudioContext()
      ctx.obeyMuteSwitch = false
      ctx.onError(function () {
        if (hot[path] === ctx) releaseHot(path)
      })
      ctx.src = path
      hot[path] = ctx
      hotText[path] = text
      // 超出上限时淘汰最早创建的实例（对象键按插入顺序，keys[0] 即最旧）
      const keys = Object.keys(hot)
      if (keys.length > HOT_MAX) {
        keys.slice(0, keys.length - HOT_MAX).forEach(function (key) {
          if (key !== path) releaseHot(key)
        })
      }
    } catch (e) {}
  })
}

// 播放一段文本；opts.interrupt=true 时抢占（清空队列并打断当前播报）
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
    if (interrupt) {
      // 点击场景下打断当前播报延后约 60ms 执行：音频实例 stop/destroy 开销大，需等点击回调返回、
      // 界面绘制完成，否则阻塞 JS 线程造成按钮卡顿；计时器场景（nowait）无此顾虑，立即执行。
      // 连续抢占按序号只保留最后一次
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

// 预加载：合成完成后提前设置 src 触发音频下载/解码，降低首次播放起播延迟
// 串行执行且播报时让路，避免实例创建/销毁与播放管线竞争
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

// 离开训练页必须调用。只调 stop() 收不干净：
// 已排定的抢占定时器仍会重新入队并起播，热实例池也会一直占着音频通道
function dispose() {
  clearTimers()
  stop()
  preloadQueue.length = 0
  preloading = false
  releaseAllHot()
}

module.exports = {
  available: available,
  enabled: enabled,
  setEnabled: setEnabled,
  speak: speak,
  warmup: warmup,
  heat: heat,
  stop: stop,
  dispose: dispose
}
