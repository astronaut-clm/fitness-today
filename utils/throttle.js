// 调用限频与单飞：两件事都是「同一个动作短时间内只做一次」，收在一个模块里
//
// —— 限频 ——
// 把「上次时间戳」存在调用方对象的 key 上（页面实例即可，无需额外状态容器）
// pass  ：interval 毫秒内重复触发返回 false
// touch ：不判断，直接把基准点推到现在（用于手动重试等已放行的路径）
// reset ：清空基准点，放行下一次（用于失败后允许立即重试）
function pass(obj, key, interval) {
  const now = Date.now()
  if (obj[key] && now - obj[key] < interval) return false
  obj[key] = now
  return true
}

function touch(obj, key) {
  obj[key] = Date.now()
}

function reset(obj, key) {
  obj[key] = 0
}

// —— 单飞 ——
// 同一「标签」的并发调用共用一次在飞的 Promise，成功失败都放行下一次。
// 以前 account 的 userGet / 头像解析、ai/recommend、ai/weekly 各手写了一份同样的状态机。
//
// const flight = throttle.flight()
// flight.run(tag, function () { return somePromise })   // tag 相同即复用
// flight.get(tag)                                       // 只看有没有在飞的，不发起
// flight.clear()                                        // 登出/重置时作废全部
function flight() {
  const inflight = {}
  function clearTag(tag, req) {
    if (inflight[tag] === req) delete inflight[tag]
  }
  return {
    get: function (tag) {
      return inflight[tag] || null
    },
    run: function (tag, task) {
      if (inflight[tag]) return inflight[tag]
      const req = task()
      inflight[tag] = req
      const done = function () { clearTag(tag, req) }
      req.then(done, done)
      return req
    },
    clear: function () {
      Object.keys(inflight).forEach(function (tag) { delete inflight[tag] })
    }
  }
}

module.exports = { pass: pass, touch: touch, reset: reset, flight: flight }
