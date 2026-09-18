const cloud = require('./utils/cloud.js')
const font = require('./utils/font.js')

App({
  onLaunch() {
    font.load()
    // 延后初始化，别阻塞首屏
    setTimeout(function () {
      cloud.init()
    }, 0)
  }
})
