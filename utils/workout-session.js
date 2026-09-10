// utils/workout-session.js 未完成训练本地恢复
const KEY = 'ft_active_workout_v1'

function get() {
  try { return wx.getStorageSync(KEY) || null } catch (e) { return null }
}

function save(session) {
  if (!session) return null
  const next = {}
  Object.keys(session).forEach(function (key) { next[key] = session[key] })
  next.version = 1
  next.savedAt = Date.now()
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
