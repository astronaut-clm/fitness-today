// 本地存储读写的统一封装：读写异常静默，读取缺省/失败返回 fallback
function read(key, fallback) {
  const dft = fallback === undefined ? null : fallback
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v == null ? dft : v
  } catch (e) {
    return dft
  }
}

// 返回是否写入成功：配额溢出时必须让调用方知道，
// 否则会出现「UI 提示保存成功、重启后数据消失」的假成功
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

// 绑定单个 key 的读写句柄：绝大多数模块只用一个 storage key，
// 以前每个模块都要自己留一个 KEY 常量再包一层 readStore/writeStore，
// 现在统一写成 const store = storage.scoped('ft_xxx')，然后 store.read() / store.write(v) / store.remove()
function scoped(key) {
  return {
    key: key,
    read: function (fallback) { return read(key, fallback) },
    write: function (value) { return write(key, value) },
    remove: function () { return remove(key) }
  }
}

module.exports = { read: read, write: write, remove: remove, scoped: scoped }
