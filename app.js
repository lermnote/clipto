// app.js
const localConfig = require('./config/env.js')

App({
  globalData: {
    pendingUrl: null
  },
  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: localConfig.cloudEnv,
        traceUser: true
      })
    }
  },
  onShow(options) {
    // 接收从微信内分享过来的链接
    if (options.referrerInfo && options.referrerInfo.extraData) {
      const { url } = options.referrerInfo.extraData
      if (url) {
        // 存到全局，clip 页面 onShow 时读取
        this.globalData.pendingUrl = url
      }
    }
  },
});