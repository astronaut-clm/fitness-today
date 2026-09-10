// utils/font.js 像素字体加载（https 直链 → wx.loadFontFace）
// 背景：小程序不能直接用 @font-face 引用项目内的字体文件；wx.loadFontFace 的 source 只认
// https 链接或 Data URL，因此字体需托管在一个 https 直链上（本项目用 GitHub + jsDelivr）。
// 支持多字体源：按 config.FONT_URLS 顺序尝试，前者失败自动回退后者。
// 全部失败则静默回退系统字体，不阻塞启动。
const config = require('./config.js')

// 会话级标记：字体一旦注册成功就记在 wx 上（热重载不会清空 wx 对象）。
// 每次热重载都会重新 onLaunch，重复调用会重复下载字体；有此标记即可跳过重复加载。
const LOADED_MARK = '__pixelFontLoaded'

let loading = null

// 单源加载超时时间；超时视为失败，继续回退下一个源。
const TIMEOUT = 25000

// 加载单个字体源；成功 resolve(true)，失败 resolve(false)
function loadOne(url) {
  return new Promise(function (resolve) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      resolve(false)
    }, TIMEOUT)

    wx.loadFontFace({
      family: config.FONT_FAMILY || 'Zpix',
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

// 按顺序尝试所有字体源；返回 Promise<boolean>（true=注册成功）
function load() {
  if (loading) return loading
  // 本会话已成功注册过（例如热重载后的重复 onLaunch）：直接跳过，避免重复加载
  if (wx[LOADED_MARK]) return Promise.resolve(true)
  if (!wx.loadFontFace) return Promise.resolve(false)

  const urls = (config.FONT_URLS || []).slice()
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
      else loading = null // 全部源失败：清空缓存，允许后续（热重载/网络恢复）重试
      return ok
    })

  return loading
}

module.exports = { load: load }
