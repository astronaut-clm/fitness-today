// 本局训练的播报器：训练页所有语音都从这里出去，页面只管喊，预热与打断都在内部
const voice = require('./tts.js')
const copy = require('./lines.js')

function create(groups) {
  // 提前合成本局用到的句子，避免播报时等网络
  function warmup() {
    const phrases = copy.FINISH_LINES.slice()
    const seen = {}
    groups.forEach(function (group, idx) {
      const setText = copy.setText(group)
      if (!seen[setText]) { seen[setText] = 1; phrases.push(setText) }
      const next = groups[idx + 1]
      const restText = copy.restText(group.rest, next && next.name)
      if (!seen[restText]) { seen[restText] = 1; phrases.push(restText) }
    })
    voice.warmup(phrases)
  }

  return {
    // 页面据此决定要不要显示语音开关
    available: voice.available,
    enabled: function () { return voice.enabled() },
    setEnabled: function (on) { voice.setEnabled(on) },
    stop: function () { voice.stop() },
    // 离开训练页必须调用：stop() 只停当前这句
    dispose: function () { voice.dispose() },

    // 语音关着或插件不可用就整个跳过，省掉没人听的合成
    prepare: function () {
      if (!voice.available || !voice.enabled()) return
      warmup()
    },

    // interrupt 打断上一阶段的残留播报，否则新组要排队等
    group: function (group) {
      if (!group) return
      voice.speak(copy.setText(group), { interrupt: true })
    },

    // 打断上一组的残留播报，休息提示立即出声
    rest: function (seconds, nextName) {
      voice.speak(copy.restText(seconds, nextName), { interrupt: true })
    },

    finish: function () {
      voice.speak(copy.pickOne(copy.FINISH_LINES), { interrupt: true })
    },

    // 念一段现成的话，非抢占，排在当前播报之后
    say: function (text) {
      if (!voice.available || !voice.enabled()) return
      voice.speak(text)
    }
  }
}

module.exports = { create: create }
