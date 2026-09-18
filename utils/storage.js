// 本机存储封装：异常静默，读不到或失败返回 fallback
function read(key, fallback) {
  const dft = fallback === undefined ? null : fallback
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v == null ? dft : v
  } catch (e) {
    return dft
  }
}

// 必须把配额溢出告诉调用方，否则会出现「提示保存成功、重启后数据消失」
function write(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    console.error('[storage] write failed', key, e)
    return false
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key)
    return true
  } catch (e) {
    return false
  }
}

// 绑定单个 key 的句柄，省掉各模块自己留 KEY 常量再包一层 readStore/writeStore：
// const store = storage.scoped('ft_xxx') → store.read() / store.write(v) / store.remove()
function scoped(key) {
  return {
    key: key,
    read: function (fallback) { return read(key, fallback) },
    write: function (value) { return write(key, value) },
    remove: function () { return remove(key) }
  }
}

module.exports = { read: read, write: write, remove: remove, scoped: scoped }
