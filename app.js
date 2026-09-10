// app.js
const cloud = require('./utils/cloud.js')
const font = require('./utils/font.js')

App({
  onLaunch() {
    // 像素字体不依赖云能力，尽早开始加载
    font.load()
    // 让首屏启动生命周期先结束，再初始化云能力，减少启动阶段阻塞。
    setTimeout(function () {
      cloud.init()
    }, 0)
  }
})
