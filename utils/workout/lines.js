// 播报与完成页文案。插件音色固定、不支持调速，只能靠文案与随机化避免听着机械。

// 最后一组结束时的收官话
const FINISH_LINES = [
  '训练完成，你太强了！',
  '全部搞定，太牛了！',
  '今天这波，满分收官！'
]

// 完成页标题：perfect 一组未跳过，partial 有跳过
const PRAISE = {
  perfect: [
    '完美通关，太强了！',
    '满分开局，收工！',
    '一组不落，教科书级别！',
    '今天这场，无可挑剔！'
  ],
  partial: [
    '尽力了，就是满分！',
    '完成就好，明天继续！',
    '能坚持到现在，已经赢了！'
  ]
}

// 完成页副标题
const CHEER_LINES = [
  '今天的汗水，都会在明天还给你。',
  '不用和谁比，你赢过了想躺下的自己。',
  '每一次坚持，身体都记得。',
  '练完这一场，今天就算赢了。',
  '你已经比开始的自己更强一点了。',
  '慢慢来，比较快，明天见。'
]

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function setText(group) {
  return group.name + '，' + group.targetText
}

function restText(seconds, nextName) {
  if (nextName) return '休息 ' + seconds + ' 秒，深呼吸，接下来是 ' + nextName
  return '休息 ' + seconds + ' 秒，深呼吸，马上继续！'
}

module.exports = {
  FINISH_LINES: FINISH_LINES,
  PRAISE: PRAISE,
  CHEER_LINES: CHEER_LINES,
  pickOne: pickOne,
  setText: setText,
  restText: restText
}
