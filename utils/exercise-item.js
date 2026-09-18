// 计划里的一个动作条目：{ actionId, sets, rest, 目标 }。
// 落库前一律过 normalizeItem，读取时一律过 of()，中间没有第二套规则（云端也原样收发）。
//
// 目标三选一、语义互斥，条目上只写其中一个字段：
//   seconds: 30      计时组，训练页跑倒计时
//   toFailure: true  力竭组，没有目标数
//   reps: '12次'     计数组，文案自由（'8-10次' / '每侧10次'）
// 其它模块只读 of() 的结果，不去猜 reps 文案的含义——'力竭' 既不是次数也不是时长。
// 老数据只有 reps 文案、没有结构化字段，靠 of() 读时认回来

const DEFAULT_REPS = '12次'
const DEFAULT_SECONDS = 30
const FAILURE_TEXT = '力竭'
const MIN_SETS = 1 // 加减按钮据此置灰
const MAX_SETS = 9
const MIN_SECONDS = 5 // 5 秒以下没意义，10 分钟以上不像「一组」
const MAX_SECONDS = 600
const MAX_TEXT = 20
const MAX_ID = 40
// 非计时组没有确切时长，估时取经验常量（力竭略长于计数组）
const COUNT_WORK_SECONDS = 40
const FAILURE_WORK_SECONDS = 45

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function clampSets(value) {
  return Math.max(MIN_SETS, Math.min(MAX_SETS, Math.round(Number(value) || MIN_SETS)))
}

function clampSeconds(value) {
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(Number(value) || 0)))
}

// 目标文案 → 结构化字段：手输的目标和只存了文案的老数据都走这里
function fromText(text) {
  const raw = clip(text, MAX_TEXT)
  const secs = /^(\d+)\s*秒/.exec(raw)
  if (secs) return { seconds: clampSeconds(secs[1]) }
  if (raw === FAILURE_TEXT) return { toFailure: true }
  // 归不了类就留原文按计数组处理：宁可少一个倒计时，也别把动作演成别的样子
  return { reps: raw || DEFAULT_REPS }
}

// 幂等：已是结构化字段时不碰文案
function normalizeTarget(exercise) {
  const ex = exercise || {}
  if (Number(ex.seconds) > 0) return { seconds: clampSeconds(ex.seconds) }
  if (ex.toFailure) return { toFailure: true }
  return fromText(ex.reps)
}

// 落库前的整条归一：字段就这四项，多余的键丢掉。上下限实际生效的唯一位置
function normalizeItem(exercise) {
  const ex = (exercise && typeof exercise === 'object') ? exercise : {}
  return Object.assign({
    actionId: clip(ex.actionId, MAX_ID),
    sets: clampSets(ex.sets),
    rest: clip(ex.rest, MAX_TEXT)
  }, normalizeTarget(ex))
}

// 运行时视图：mode = time / failure / count，seconds 仅计时组有值
function of(exercise) {
  const target = normalizeTarget(exercise)
  if (target.seconds) return { mode: 'time', seconds: target.seconds, text: target.seconds + '秒' }
  if (target.toFailure) return { mode: 'failure', seconds: 0, text: FAILURE_TEXT }
  return { mode: 'count', seconds: 0, text: target.reps }
}

// 动作库标了 timed 的给秒数，其余给次数
function defaultText(action) {
  return (action && action.timed) ? DEFAULT_SECONDS + '秒' : DEFAULT_REPS
}

// 单组估时，用于自定义计划的时长/热量预估
function workSeconds(exercise) {
  const target = of(exercise)
  if (target.mode === 'time') return target.seconds
  return target.mode === 'failure' ? FAILURE_WORK_SECONDS : COUNT_WORK_SECONDS
}

module.exports = {
  MIN_SETS: MIN_SETS,
  MAX_SETS: MAX_SETS,
  clampSets: clampSets,
  fromText: fromText,
  normalizeItem: normalizeItem,
  of: of,
  defaultText: defaultText,
  workSeconds: workSeconds
}
