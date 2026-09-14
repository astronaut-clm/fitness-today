const cloud = require('./utils/cloud.js')
const font = require('./utils/font.js')

App({
  onLaunch() {
    font.load()
    // 延后初始化云能力，避免阻塞首屏启动
    setTimeout(function () {
      cloud.init()
    }, 0)
  }
})
