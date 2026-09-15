// 头像渲染助手：cloud:// 换临时 https 链接 + seq 防过期覆盖 + 失败回退文字头像。
// checkin / account 页的单头像场景用 create()；rank / feed 的列表场景用 clearRow()。
const account = require('./account.js')

// apply(url) 由页面实现（setData 写头像字段，空串即回退文字头像）
function create(apply) {
  let seq = 0
  return {
    // 非 cloud://（本地临时图/空值）直接渲染；cloud:// 先清空再异步换链，过期结果丢弃
    show(fileID) {
      const id = String(fileID || '')
      seq += 1
      const current = seq
      if (id.indexOf('cloud://') !== 0) {
        apply(id)
        return
      }
      apply('')
      account.resolveAvatar(id).then(function (url) {
        if (!url || current !== seq) return
        apply(url)
      }).catch(function () {})
    },

    // image binderror（如临时链接过期）：作废旧结果并回退文字头像
    error() {
      seq += 1
      apply('')
    }
  }
}

// 列表行头像失效回退：清空该行 avatar，落到文字头像
function clearRow(page, listKey, index) {
  if (index == null) return
  const patch = {}
  patch[listKey + '[' + index + '].avatar'] = ''
  page.setData(patch)
}

module.exports = {
  create: create,
  clearRow: clearRow
}
