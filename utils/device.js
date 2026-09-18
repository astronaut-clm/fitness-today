// 设备信息兼容层：wx.getWindowInfo / getDeviceInfo / getMenuButtonBoundingClientRect
// 在低版本基础库上可能不存在或抛异常，直接调用会导致页面白屏，这里统一 try/catch 并回退旧接口。
function fromSystemInfoSync() {
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync() || {}
      return info
    }
  } catch (e) {}
  return {}
}

function windowInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo() || {}
  } catch (e) {}
  return fromSystemInfoSync()
}

function deviceInfo() {
  try {
    if (typeof wx.getDeviceInfo === 'function') return wx.getDeviceInfo() || {}
  } catch (e) {}
  return fromSystemInfoSync()
}

function menuButtonRect() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      return wx.getMenuButtonBoundingClientRect() || {}
    }
  } catch (e) {}
  return {}
}

module.exports = {
  windowInfo: windowInfo,
  deviceInfo: deviceInfo,
  menuButtonRect: menuButtonRect
}
