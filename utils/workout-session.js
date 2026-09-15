// 未完成训练的本地断点恢复
const KEY = 'ft_active_workout_v1'

function get() {
  try { return wx.getStorageSync(KEY) || null } catch (e) { return null }
}

function save(session) {
  if (!session) return null
  const next = {}
  Object.keys(session).forEach(function (key) { next[key] = session[key] })
  // 同步写：与 clear() 的同步删保持一致，避免先存后清时异步写晚到导致断点复活
  try { wx.setStorageSync(KEY, next) } catch (e) {}
  return next
}

function clear() {
  try { wx.removeStorageSync(KEY) } catch (e) {}
}

function belongsTo(planId) {
  const session = get()
  return session && session.planId === planId ? session : null
}

module.exports = {
  get: get,
  save: save,
  clear: clear,
  belongsTo: belongsTo
}
