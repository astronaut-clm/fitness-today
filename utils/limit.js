// 调用限频：interval 毫秒内重复触发返回 false；失败后可 reset 放行下一次
function pass(obj, key, interval) {
  const now = Date.now()
  if (obj[key] && now - obj[key] < interval) return false
  obj[key] = now
  return true
}

function reset(obj, key) {
  obj[key] = 0
}

module.exports = { pass: pass, reset: reset }
