// 计划里的一个动作条目：{ actionId, sets, rest, 目标 }。字段边界与目标语义都归这里，
// 落库前一律过 normalizeItem，读取时一律过 of()，中间不再有第二套规则。
//
// 目标的三种语义互斥，条目上只写其中一个字段：
//   seconds: 30      计时组——训练页跑倒计时，归零自动进下一组
//   toFailure: true  力竭组——没有目标数，做到做不动为止
//   reps: '12次'     计数组——文案自由，'8-10次' / '每侧10次' 都行
// 其它模块只读 of() 的结果，不再去猜 reps 文案的含义——'力竭' 既不是次数也不是时长，
// 以前靠正则匹配 '30秒' 反推，匹配不上就一律当计数组，多一种语义就多一处隐式假设。
//
// 字段边界只在这一处收敛：云端原样收发，不做第二套校验。所以老版本客户端存的数据
// （只有 reps 文案、没有结构化字段）靠读取时的 of() 认回来，落库形态不必强求一致。

// 自定义计划新增动作时的默认目标
const DEFAULT_REPS = '12次'
const DEFAULT_SECONDS = 30
const FAILURE_TEXT = '力竭'
// 单动作组数上下限：详情页与自定义计划页的加减按钮据此置灰
const MIN_SETS = 1
const MAX_SETS = 9
// 单组秒数上下限：5 秒以下没有训练意义，10 分钟以上不像「一组」
const MIN_SECONDS = 5
const MAX_SECONDS = 600
// 文案长度上限：手输文案与落库文案同一把尺子
const MAX_TEXT = 20
const MAX_ID = 40
// 非计时组的单组估时（秒）：没有确切时长，取经验常量，力竭略长于普通计数组
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

// 目标文案 → 结构化字段：用户手输的目标、以及只存了文案的历史数据都走这里
function fromText(text) {
  const raw = clip(text, MAX_TEXT)
  const secs = /^(\d+)\s*秒/.exec(raw)
  if (secs) return { seconds: clampSeconds(secs[1]) }
  if (raw === FAILURE_TEXT) return { toFailure: true }
  // 归不了类的文案保留原文按计数组处理：宁可少一个倒计时，也不要把动作演成别的样子
  return { reps: raw || DEFAULT_REPS }
}

// 目标归一成三形态之一。已是结构化字段时不碰文案，幂等，可反复调用
function normalizeTarget(exercise) {
  const ex = exercise || {}
  if (Number(ex.seconds) > 0) return { seconds: clampSeconds(ex.seconds) }
  if (ex.toFailure) return { toFailure: true }
  return fromText(ex.reps)
}

// 落库前的整条归一：字段就这四项，多余的键一律丢掉，上下限一次性收敛。
// 存本机前走这里；云端原样收下，所以上下限实际生效的地方就是这一处
function normalizeItem(exercise) {
  const ex = (exercise && typeof exercise === 'object') ? exercise : {}
  return Object.assign({
    actionId: clip(ex.actionId, MAX_ID),
    sets: clampSets(ex.sets),
    rest: clip(ex.rest, MAX_TEXT)
  }, normalizeTarget(ex))
}

// 运行时视图：mode 为 'time' / 'failure' / 'count'，seconds 仅计时组有值
function of(exercise) {
  const target = normalizeTarget(exercise)
  if (target.seconds) return { mode: 'time', seconds: target.seconds, text: target.seconds + '秒' }
  if (target.toFailure) return { mode: 'failure', seconds: 0, text: FAILURE_TEXT }
  return { mode: 'count', seconds: 0, text: target.reps }
}

// 新增动作的默认目标文案：动作库标了 timed 的按秒（见 databases/actions.js）
function defaultText(action) {
  return (action && action.timed) ? DEFAULT_SECONDS + '秒' : DEFAULT_REPS
}

// 单组估时：计时组取实际秒数，其余两种按经验常量。用于自定义计划的时长/热量预估
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
