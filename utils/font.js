// wx.loadFontFace 只认 https 直链，故字体托管于 jsDelivr；加载失败则静默回退系统字体
const config = require('./config.js')

// 会话级标记：注册成功后在 wx 上打标，避免热重载重复下载
const LOADED_MARK = '__pixelFontLoaded'

let loading = null

// 加载超时视为失败，回退系统字体
const TIMEOUT = 25000

// pixel=加载 Zpix；system=系统字体。注册后无法卸载，关回系统字体需重启小程序
const CHOICE_KEY = 'ft_font_choice_v1'

function getChoice() {
  let saved = ''
  try { saved = wx.getStorageSync(CHOICE_KEY) || '' } catch (e) {}
  return saved === 'pixel' ? 'pixel' : 'system'
}

function setChoice(value) {
  const next = value === 'pixel' ? 'pixel' : 'system'
  try { wx.setStorageSync(CHOICE_KEY, next) } catch (e) {}
  return next
}

function loadOne(url) {
  return new Promise(function (resolve) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      resolve(false)
    }, TIMEOUT)

    wx.loadFontFace({
      family: 'Zpix',
      source: 'url("' + url + '")',
      global: true,
      success: function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(true)
      },
      fail: function () {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(false)
      }
    })
  })
}

function load() {
  if (getChoice() !== 'pixel') return Promise.resolve(false)
  if (loading) return loading
  if (wx[LOADED_MARK]) return Promise.resolve(true)

  const urls = config.FONT_URLS ? [config.FONT_URLS] : []
  if (!urls.length) return Promise.resolve(false)

  loading = urls
    .reduce(function (chain, url) {
      return chain.then(function (ok) {
        if (ok) return true
        return loadOne(url)
      })
    }, Promise.resolve(false))
    .then(function (ok) {
      if (ok) wx[LOADED_MARK] = true
      else loading = null // 全失败：清缓存以便后续重试
      return ok
    })

  return loading
}

module.exports = { load: load, getChoice: getChoice, setChoice: setChoice }
