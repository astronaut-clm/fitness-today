// 云开发配置
// - ENABLE_CLOUD：云同步总开关；不需要云能力时置 false 即完全降级为纯本地
// - CLOUD_ENV：云开发环境 ID；只有一个环境时可留空（自动使用「默认环境」），多环境时必填
// - FONT_URLS：像素字体直链列表（https），按顺序尝试，前者加载失败会自动回退后者。
//   当前使用全量 zpix.woff2（约 943KB），托管在 GitHub + jsDelivr。
//   直链形如：
//     https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-action-today@master/assets/fonts/zpix.woff2
//   要求 https 且支持跨域（jsDelivr 自带 CORS）。留空则不加载自定义字体，回退系统字体。
//   注意：字体文件已被 project.config.json 的 packOptions.ignore 排除，不会打进小程序包。
// - FONT_FAMILY：注册给 wx.loadFontFace 的字体名，需与 app.wxss 的 font-family 首项一致
module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  FONT_URLS: [
    'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-action-today@master/assets/fonts/zpix.woff2'
  ],
  FONT_FAMILY: 'Zpix'
}
