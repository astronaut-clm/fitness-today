// 未完成训练的本地断点恢复
const storage = require('./storage.js')

const KEY = 'ft_active_workout_v1'

function get() {
  return storage.read(KEY)
}

function save(session) {
  if (!session) return null
  const next = Object.assign({}, session)
  // 同步写：与 clear() 的同步删保持一致，避免先存后清时异步写晚到导致断点复活
  storage.write(KEY, next)
  return next
}

function clear() {
  storage.remove(KEY)
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
