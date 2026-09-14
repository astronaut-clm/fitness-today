// 云开发配置
// ENABLE_CLOUD：云同步总开关，置 false 即降级为纯本地
// CLOUD_ENV：云开发环境 ID，单环境可留空，多环境必填
// FONT_URLS：像素字体 https 直链列表，按序回退，留空则用系统字体；
//   要求 https 且支持跨域，字体文件已从打包中排除（packOptions.ignore）
// FONT_FAMILY：注册给 wx.loadFontFace 的字体名，需与 app.wxss 的 font-family 首项一致
// ACTION_CDN_PREFIX：动作演示动画 https 直链前缀（以 / 结尾），拼上 '<id>.gif' 即完整地址
//   assets/actions 下的 gif 已从打包中排除（packOptions.ignore），由 jsDelivr 按 GitHub 仓库原始字节分发，
//   不做图片转码，真机 <image> 可正常播放动画
//   例：'https://cdn.jsdelivr.net/gh/<user>/<repo>@master/assets/actions/'
//   留空则详情页不展示动画
module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  ACTION_CDN_PREFIX: 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/actions/',
  FONT_URLS: [
    'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/fonts/zpix.woff2'
  ],
  FONT_FAMILY: 'Zpix'
}
