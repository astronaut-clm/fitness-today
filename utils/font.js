// wx.loadFontFace 只认 https 直链，故字体托管于 jsDelivr；加载失败则静默回退系统字体
const config = require('./config.js')
const storage = require('./storage.js')

// 会话级标记：注册成功后在 wx 上打标，避免热重载重复下载
const LOADED_MARK = '__pixelFontLoaded'

// 加载超时视为失败，回退系统字体
const TIMEOUT = 25000

// pixel=加载 Zpix；system=系统字体（默认）。字体注册后无法卸载，
// 所以「关闭像素字体」不动已加载的字体，只让页面不再引用 Zpix，靠改页面根节点字体栈即时生效，无需重启
const choice = storage.scoped('ft_font_choice_v1')
// 系统字体栈：既是像素字体的回退，也是关闭时的目标字体
const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif'

let loading = null

function getChoice() {
  // 默认系统字体；只有用户显式选过像素字体时才加载并引用 Zpix
  return choice.read() === 'pixel' ? 'pixel' : 'system'
}

function setChoice(value) {
  const next = value === 'pixel' ? 'pixel' : 'system'
  choice.write(next)
  return next
}

// page-meta 的 page-style：像素字体引用 Zpix，系统字体显式回系统字体栈。
// font-family 会被页面整棵子树继承，切换这个样式即可全页即时换字（原生 button/input 需 app.wxss 里 inherit）
function pageStyle() {
  const stack = getChoice() === 'pixel' ? '"Zpix", ' + SYSTEM_STACK : SYSTEM_STACK
  return 'font-family: ' + stack + ';'
}

// resolve(true/false)，不 reject：超时与失败都归一化成 false
function loadOne(url) {
  return new Promise(function (resolve) {
    let settled = false
    let timer = 0
    function settle(ok) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    // 句柄必须在 loadFontFace 之前建好：部分基础库会同步回调 success/fail，
    // 那时 settle 先跑而 timer 还没赋值，原写法会落进 const 的暂时性死区直接抛错
    timer = setTimeout(function () { settle(false) }, TIMEOUT)
    // 不设 global：字体只负责注册，是否使用交给页面根节点的 font-family 决定。
    // global 会全局强制生效且无法撤销，会导致关闭像素字体后仍回不去系统字体
    wx.loadFontFace({
      family: 'Zpix',
      source: 'url("' + url + '")',
      success: function () { settle(true) },
      fail: function () { settle(false) }
    })
  })
}

function load() {
  if (getChoice() !== 'pixel') return Promise.resolve(false)
  if (wx[LOADED_MARK]) return Promise.resolve(true)
  if (loading) return loading

  const url = config.FONT_URL
  if (!url) return Promise.resolve(false)

  loading = loadOne(url).then(function (ok) {
    if (ok) wx[LOADED_MARK] = true
    else loading = null // 失败则清掉 in-flight，允许后续重试
    return ok
  })
  return loading
}

// 页面通用 behavior：字体选择同步到 page-meta 的 page-style。
// font-family 沿整棵子树继承，改页面根节点样式即可全页即时换字，无需重启。
function syncFontStyle(page) {
  const style = pageStyle()
  if (page.data.fontStyle !== style) page.setData({ fontStyle: style })
}

const fontBehavior = Behavior({
  data: {
    fontStyle: ''
  },
  onLoad() {
    syncFontStyle(this)
  },
  onShow() {
    syncFontStyle(this)
  }
})

module.exports = { load: load, getChoice: getChoice, setChoice: setChoice, pageStyle: pageStyle, behavior: fontBehavior }
