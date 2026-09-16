// CloudBase 初始化协调层：调用前统一等 init()，避免启动期竞态
const config = require('./config.js')

let initPromise = null

function supported() {
  try {
    return !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.init)
  } catch (e) {
    return false
  }
}

function init() {
  if (initPromise) return initPromise
  if (!supported()) return Promise.resolve(false)

  initPromise = new Promise(function (resolve) {
    try {
      const opt = { traceUser: true }
      if (config.CLOUD_ENV) opt.env = config.CLOUD_ENV
      wx.cloud.init(opt)
      resolve(true)
    } catch (e) {
      resolve(false)
    }
  })
  return initPromise
}

function callable() {
  try {
    return !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.callFunction)
  } catch (e) {
    return false
  }
}

// 调用云函数（默认 login，name 可指定如 social）：云不可用 resolve(null)，调用失败 reject
function invoke(action, data, name) {
  if (!callable()) return Promise.resolve(null)
  return init().then(function (ok) {
    if (!ok || !callable()) return null
    const payload = data ? Object.assign({ action: action }, data) : (action ? { action: action } : {})
    return wx.cloud.callFunction({ name: name || 'login', data: payload })
  })
}

// 调用 login 云函数并归一化；与 callTo 的区别：失败时丢弃 code，调用方只判 ok
function call(action, data) {
  return callTo('login', action, data).then(function (res) {
    return res && res.ok ? res : { ok: false }
  })
}

// 调用指定云函数并归一化；与 call 的区别：失败时保留服务端 code
function callTo(name, action, data) {
  if (!callable()) return Promise.resolve({ ok: false })
  return invoke(action, data, name).then(function (res) {
    const result = (res && res.result) || {}
    if (!result.openid) return Object.assign({ ok: false }, result)
    return Object.assign({ ok: true }, result)
  }).catch(function (err) {
    console.error('[cloud] callTo', name, action, err)
    return { ok: false }
  })
}

module.exports = {
  init: init,
  callable: callable,
  invoke: invoke,
  call: call,
  callTo: callTo
}
