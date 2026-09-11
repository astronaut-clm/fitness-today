// utils/cloud.js CloudBase 初始化协调层
// 所有云能力调用通过 ready() 等待初始化，避免 app.onLaunch 延后初始化后的竞态。
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

function ready() {
  return init()
}

// 是否具备可调用的云函数能力（login 云函数所在云环境已配置）。
function callable() {
  try {
    return !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.callFunction)
  } catch (e) {
    return false
  }
}

// 调用云函数（默认 login，本项目大部分云端读写由它提供）。
// name 可指定其他函数名（如 social：排行榜 + 铁友圈）。
// - 未开启云能力 / 云初始化未就绪：resolve(null)
// - 云函数调用失败：reject(err)，由调用方决定提示或重试
function invoke(action, data, name) {
  if (!callable()) return Promise.resolve(null)
  return ready().then(function (ok) {
    if (!ok || !callable()) return null
    const payload = data ? Object.assign({ action: action }, data) : (action ? { action: action } : {})
    return wx.cloud.callFunction({ name: name || 'login', data: payload })
  })
}

// 调用 login 云函数并归一化结果：非云环境 / 缺少 openid 视为失败，失败不抛错。
// 供各业务模块复用，避免各自重复实现同样的包装逻辑。
function call(action, data) {
  if (!callable()) return Promise.resolve({ ok: false })
  return invoke(action, data).then(function (res) {
    const result = (res && res.result) || {}
    if (!result.openid) return { ok: false }
    return Object.assign({ ok: true }, result)
  }).catch(function (err) {
    console.error('[cloud] call', action, err)
    return { ok: false }
  })
}

// 调用指定名字的云函数并归一化结果（login 之外的函数，如 social）。
// 与 call 的区别：失败时会把服务端返回的 code 一并带出，便于上层区分错误原因。
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
  ready: ready,
  callable: callable,
  invoke: invoke,
  call: call,
  callTo: callTo
}
