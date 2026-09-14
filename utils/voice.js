// 训练语音播报（基于「微信同声传译」WechatSI 插件）
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
let pendingInterrupt = 0 // 抢占任务序号：连续抢占时只执行最新一次

function noop() {}

let enabledCache = null // 开关内存缓存：播报路径上避免每次同步读 storage

function enabled() {
  if (enabledCache === null) {
    try { enabledCache = wx.getStorageSync(KEY) !== false } catch (e) { enabledCache = true }
  }
  return enabledCache
}

function setEnabled(on) {
  enabledCache = !!on
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
  ctx.src = path
  ctx.play()
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
      // 抢占：立即清空待播队列，打断当前播报要延后约 60ms（3 帧）——
      // 音频实例的 stop/destroy 与重建开销大，需等点击回调返回、界面绘制完成后再执行，
      // 否则会阻塞 JS 线程造成按钮卡顿。
      // 连续抢占时通过序号只保留最后一次，旧任务作废，避免过期语音抢先播出
      queue.length = 0
      const seq = ++pendingInterrupt
      setTimeout(function () {
        if (seq !== pendingInterrupt) return
        stop()
        paths.forEach(function (path) { if (path) queue.push(path) })
        playNext()
      }, 60)
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
  if (playing) { setTimeout(runPreload, 500); return }
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
    setTimeout(release, 3000)
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

// 预合成：提前把本次会用到的语句生成为本地音频
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
