// 难度等级公共常量：内置计划与动作库的 level 字段共用同一套中文文案。
// tagClass 生成 app.wxss 中的 tag-lv1/2/3 类名；新增等级时同步维护这里即可。
const LEVEL_MAP = { 初级: 1, 中级: 2, 高级: 3 }

function tagClass(level) {
  return 'tag-lv' + (LEVEL_MAP[level] || 1)
}

module.exports = {
  tagClass: tagClass
}
