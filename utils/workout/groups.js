// 计划 → 训练组序列：整组循环 loop 轮，每个动作按 sets 展开成独立的「组」
const actionsData = require('../../databases/actions.js')
const exerciseItem = require('../exercise-item.js')

// 组间休息缺省值（秒），健身房器械组间更长
const DEFAULT_REST = { gym: 60, home: 20 }
const FALLBACK_REST = 20

// '组间90秒' → 90；解析不出返回 0，由调用方回落场景缺省值
function parseRest(text) {
  const m = /^组间(\d+)\s*秒/.exec(String(text || '').trim())
  return m ? +m[1] : 0
}

function build(plan) {
  const groups = []
  const loop = plan.loop || 1
  const defRest = DEFAULT_REST[plan.scene] || FALLBACK_REST
  for (let round = 1; round <= loop; round++) {
    plan.exercises.forEach(function (exercise) {
      const action = actionsData.getAction(exercise.actionId) || {}
      // 计时/力竭/计数由动作条目自己声明，这里只取结果
      const target = exerciseItem.of(exercise)
      const rest = parseRest(exercise.rest) || defRest
      const sets = exercise.sets || 1
      for (let set = 1; set <= sets; set++) {
        groups.push({
          name: action.name || exercise.actionId,
          category: action.category || '训练',
          equipment: action.equipment || '',
          targetText: target.text,
          seconds: target.seconds,
          mode: target.mode,
          rest: rest,
          round: round,
          roundTotal: loop
        })
      }
    })
  }
  return groups
}

// index 越界返回 null，wxml 用 wx:if 兜住
function viewOf(group, index) {
  if (!group) return null
  return {
    setNo: index + 1,
    name: group.name,
    category: group.category,
    equipment: group.equipment,
    targetText: group.targetText,
    mode: group.mode,
    seconds: group.seconds,
    roundLabel: group.roundTotal > 1 ? '第' + group.round + '/' + group.roundTotal + '轮' : ''
  }
}

module.exports = {
  build: build,
  viewOf: viewOf,
  // 给 custom-plans 的时长估算复用，保证估算与实际同一份数
  DEFAULT_REST: DEFAULT_REST
}
