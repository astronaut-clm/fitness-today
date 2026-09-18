// 动作演示视频缓存：下完存进用户目录，第二次起读本地，不必再等网络
const config = require('./config.js')
const actionsData = require('../databases/actions.js')

const fs = wx.getFileSystemManager()
const DIR = ((wx.env && wx.env.USER_DATA_PATH) || '') + '/ft_videos'
const flights = {}
const memory = {}
let dirReady = null

// 全量预热并发数：登录后还有云端同步在跑，开太大只会互相抢带宽
const WARM_CONCURRENCY = 3

function ensureDir() {
  if (!dirReady) {
    dirReady = new Promise(function (resolve) {
      fs.mkdir({ path: DIR, recursive: true, success: resolve, fail: resolve })
    })
  }
  return dirReady
}

function hasFile(path) {
  return new Promise(function (resolve) {
    fs.access({ path: path, success: function () { resolve(true) }, fail: function () { resolve(false) } })
  })
}

function download(url, path) {
  return new Promise(function (resolve) {
    wx.downloadFile({
      url: url,
      success: function (res) {
        // 非 200 也会进 success，CDN 回错页时 tempFilePath 是空的或不可播
        if (res && res.statusCode && res.statusCode !== 200) return resolve('')
        const tmp = (res && res.tempFilePath) || ''
        if (!tmp) return resolve('')
        fs.saveFile({
          tempFilePath: tmp,
          filePath: path,
          success: function (r) { resolve((r && r.savedFilePath) || path) },
          fail: function () { resolve(tmp) } // 存不下也先给临时文件，本次能播
        })
      },
      fail: function () { resolve('') }
    })
  })
}

function urlOf(id) {
  if (!id || !config.ACTION_VIDEO_PREFIX) return ''
  return config.ACTION_VIDEO_PREFIX + id + '.mp4'
}

// 会话内已解析过的直接给出路径，省掉一次异步探测
function peek(id) {
  return memory[id] || ''
}

// 命中本地直接返回，未命中下载并落盘；失败回退远端直链，交给 <video> 自己拉
function resolveById(id) {
  const url = urlOf(id)
  if (!url || !DIR) return Promise.resolve(url)
  if (memory[id]) return Promise.resolve(memory[id])
  if (flights[id]) return flights[id]
  flights[id] = ensureDir().then(function () {
    const path = DIR + '/' + id + '.mp4'
    return hasFile(path).then(function (hit) { return hit ? path : download(url, path) })
  }).then(function (path) {
    delete flights[id]
    memory[id] = path || url
    return memory[id]
  })
  return flights[id]
}

// 提前发起下载：与页面转场并行，进详情页时直接复用同一个 in-flight
function prefetch(id) {
  if (id) resolveById(id)
}

// 全量预热：把动作库所有演示视频拉到本地，之后进哪个动作都是秒播。
// 已落盘的直接跳过（fs.access 很便宜），失败的不提示、下次进来会重试。
// 始终 resolve，返回本次真正下载成功的个数
let warming = null

function warmup() {
  if (!config.ACTION_VIDEO_PREFIX || !DIR) return Promise.resolve(0)
  if (warming) return warming

  const ids = actionsData.actions.map(function (a) { return a.id }).filter(Boolean)
  let cursor = 0
  let done = 0

  // 每条跑道自己往下取，跑完当前 id 再取下一个
  function run() {
    if (cursor >= ids.length) return Promise.resolve()
    const id = ids[cursor++]
    return resolveById(id).then(function (path) {
      if (path && path.indexOf('http') !== 0) done++
      return run()
    })
  }

  const runners = []
  for (let i = 0; i < WARM_CONCURRENCY && i < ids.length; i++) runners.push(run())
  warming = Promise.all(runners).then(function () {
    warming = null // 清掉标记：缓存被系统回收后还能再跑一次
    return done
  })
  return warming
}

module.exports = { urlOf: urlOf, peek: peek, resolveById: resolveById, prefetch: prefetch, warmup: warmup }
