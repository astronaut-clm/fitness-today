// 本局训练的播报器：训练页的所有语音都从这里出去。
// 它自己记着「这句播过没有」，页面只在该出声的时候喊一声，不用管去重和预热。
// 用法：create(groups) 拿到一个播报器，然后 prepare() / group() / countdown() ...
const voice = require('./tts.js')
const copy = require('./lines.js')

// 倒数播报起点：与预热的数字池长度保持一致
const COUNTDOWN_FROM = copy.COUNTDOWN_DIGITS.length

function create(groups) {
  // 播报去重状态：倒数记「哪个阶段的哪个数字播过了」
  let countPhase = ''
  let countValue = 0

  // 提前合成本局用到的语句，避免播报时等网络合成；倒数数字额外常驻热实例（见 voice.heat）
  function warmup() {
    const phrases = copy.COUNTDOWN_DIGITS.concat(copy.FINISH_LINES)
    const seen = {}
    groups.forEach(function (group, idx) {
      const setText = copy.setText(group)
      if (!seen[setText]) { seen[setText] = 1; phrases.push(setText) }
      const next = groups[idx + 1]
      const restText = copy.restText(group.rest, next && next.name)
      if (!seen[restText]) { seen[restText] = 1; phrases.push(restText) }
    })
    voice.warmup(phrases)
    copy.COUNTDOWN_DIGITS.forEach(function (n) { voice.heat(n) })
  }

  return {
    // 插件是否可用：页面据此决定要不要显示语音开关
    available: voice.available,
    enabled: function () { return voice.enabled() },
    setEnabled: function (on) { voice.setEnabled(on) },
    stop: function () { voice.stop() },
    // 离开训练页必须调用：stop() 只停当前这句，dispose 还会作废已排定的抢占定时器并释放热实例池
    dispose: function () { voice.dispose() },

    // 开局预热。语音关着或插件不可用就整个跳过，省掉一次没人听的合成
    prepare: function () {
      if (!voice.available || !voice.enabled()) return
      warmup()
    },

    // 进入新阶段时清空去重状态，否则新组的倒数会被当成已播过而漏掉
    reset: function () {
      countPhase = ''
      countValue = 0
    },

    // 新的一组：interrupt 打断上一阶段的残留播报（休息句/倒数），否则新组播报要排队等
    group: function (group) {
      if (!group) return
      voice.speak(copy.setText(group), { interrupt: true })
    },

    // 进入休息：打断上一组末尾的倒数，休息提示立即出声
    rest: function (seconds, nextName) {
      voice.speak(copy.restText(seconds, nextName), { interrupt: true })
    },

    finish: function () {
      voice.speak(copy.pickOne(copy.FINISH_LINES), { interrupt: true })
    },

    // 倒数仅最后几秒播报，同值不重复；每个数字都立即抢占上一拍（热实例起播零延迟），
    // 避免排队等上一拍播完导致语音逐拍落后于显示
    countdown: function (remain, phase) {
      if (remain > COUNTDOWN_FROM) { countPhase = ''; countValue = 0; return }
      if (remain < 1) return
      if (countPhase === phase && countValue === remain) return
      countPhase = phase
      countValue = remain
      voice.speak(String(remain), { interrupt: true, nowait: true })
    },

    // 念一段现成的话（语音开关提示、AI 点评成稿）：非抢占，排在当前播报之后
    say: function (text) {
      if (!voice.available || !voice.enabled()) return
      voice.speak(text)
    }
  }
}

module.exports = { create: create }
