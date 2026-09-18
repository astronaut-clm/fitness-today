// CloudBase 初始化与云函数调用封装：调用前统一等 init()，避免启动期竞态
const config = require('./config.js')

let initPromise = null

function init() {
  if (initPromise) return initPromise
  let ok = false
  try {
    ok = !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.init)
  } catch (e) {}
  if (!ok) return Promise.resolve(false)

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

// 调用契约：云函数必须显式返回 { ok: true, ... } 或 { ok: false, code }。
// 只有 ok === true 才算成功——漏写 ok 的响应按失败处理，宁可误报失败也不「假成功」。
// call() 永不 reject，永远 resolve 一个带 ok 的对象，调用方直接判 res.ok 即可。
function call(name, action, data) {
  if (!callable()) return Promise.resolve({ ok: false, code: 'cloud_disabled' })
  return init().then(function (ok) {
    if (!ok || !callable()) return { ok: false, code: 'cloud_disabled' }
    const payload = data ? Object.assign({ action: action }, data) : (action ? { action: action } : {})
    return wx.cloud.callFunction({ name: name, data: payload }).then(function (res) {
      const result = (res && typeof res.result === 'object' && res.result) || {}
      // 只认显式布尔 ok；缺失或非布尔一律按失败并标 bad_response，便于定位不守契约的 action
      if (typeof result.ok === 'boolean') return result
      return Object.assign({ code: 'bad_response' }, result, { ok: false })
    })
  }).catch(function (err) {
    console.error('[cloud] call', name, action, err)
    return { ok: false, code: 'call_failed' }
  })
}

// 写入成功后以服务器时钟回写本地 updatedAt：两端时钟偏差会让下一轮同步误判
// 「云端较新」（本机快于服务器时）或反复补推（本机慢于服务器时）。
// pushedTs 是发起推送时的本地时间戳，readTs() 取当前值——推送期间本地又改了就跳过回写，
// 留给下一轮收敛。返回响应里是否带回了可用的服务器时间戳。
function adoptServerTs(res, pushedTs, readTs, writeTs) {
  const serverTs = Number((res && res.updatedAt) || 0)
  if (serverTs <= 0) return false
  if (Number(readTs() || 0) === Number(pushedTs || 0)) writeTs(serverTs)
  return true
}

module.exports = {
  init: init,
  callable: callable,
  call: call,
  adoptServerTs: adoptServerTs
}
