// 云开发配置
// ENABLE_CLOUD：云同步总开关，置 false 即降级为纯本地
// CLOUD_ENV：云开发环境 ID，单环境可留空，多环境必填
// FONT_URLS：像素字体 https 直链列表，按序回退，留空则用系统字体；
//   要求 https 且支持跨域，字体文件已从打包中排除（packOptions.ignore）
// FONT_FAMILY：注册给 wx.loadFontFace 的字体名，需与 app.wxss 的 font-family 首项一致
module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  FONT_URLS: [
    'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/fonts/zpix.woff2'
  ],
  FONT_FAMILY: 'Zpix'
}
