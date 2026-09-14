// 难度等级常量：level 文案与 app.wxss 的 tag-lv1/2/3 类名共用，新增等级在此维护
const LEVEL_MAP = { 初级: 1, 中级: 2, 高级: 3 }

function tagClass(level) {
  return 'tag-lv' + (LEVEL_MAP[level] || 1)
}

module.exports = {
  tagClass: tagClass
}
