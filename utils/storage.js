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

function write(key, value) {
  try { wx.setStorageSync(key, value) } catch (e) {}
}

function remove(key) {
  try { wx.removeStorageSync(key) } catch (e) {}
}

module.exports = { read: read, write: write, remove: remove }
