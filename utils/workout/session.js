// 未完成训练的本地断点恢复。
// 会话状态机的三个取值与「什么算有进度可续」都定义在这里——
// 计划列表页的「继续训练」标记、详情页的按钮文案、训练页的恢复弹层必须用同一个判据，
// 否则三处会出现「列表说能续、进去却从头开始」这类不一致
const storage = require('../storage.js')

const store = storage.scoped('ft_active_workout_v1')

// working=在练（可能暂停）；rest=组间休息；finished=已完成并落库
const STATE = { working: 'working', rest: 'rest', finished: 'finished' }

function get() {
  return store.read()
}

function save(session) {
  if (!session) return null
  const next = Object.assign({}, session)
  // 同步写：与 clear() 的同步删保持一致，避免先存后清时异步写晚到导致断点复活
  store.write(next)
  return next
}

function clear() {
  store.remove()
}

function belongsTo(planId) {
  const session = get()
  return session && session.planId === planId ? session : null
}

// 有进度可续 = 没练完，且至少完成了一组。
// 一组都没完成的会话没有进度可丢，调用方可以直接 clear() 而不必弹确认
function isResumable(session) {
  return !!(session &&
    session.state !== STATE.finished &&
    Number(session.completed || 0) > 0)
}

// 属于该计划、且有进度可续的会话；否则 null
function resumableFor(planId) {
  const session = belongsTo(planId)
  return isResumable(session) ? session : null
}

module.exports = {
  STATE: STATE,
  get: get,
  save: save,
  clear: clear,
  belongsTo: belongsTo,
  isResumable: isResumable,
  resumableFor: resumableFor
}
