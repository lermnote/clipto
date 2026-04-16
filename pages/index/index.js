const db = wx.cloud.database()

Page({
  data: {
    token: '',
    databaseId: '',
    saved: false
  },

  onLoad() {
    db.collection('config').doc('notion').get()
      .then(res => {
        this.setData({
          token: res.data.token,
          databaseId: res.data.databaseId,
          saved: true
        })
      })
      .catch(() => {})
  },

  onDbInput(e) {
    this.setData({
      databaseId: e.detail.value
    })
  },



  onTokenInput(e) {
    this.setData({
      token: e.detail.value
    })
  },
  async saveToken() {
    const {
      token,
      databaseId
    } = this.data
    // 同时兼容新格式 ntn_ 和旧格式 secret_
    if (!token.startsWith('ntn_') && !token.startsWith('secret_')) {
      wx.showToast({
        title: 'Token 格式有误',
        icon: 'error'
      })
      return
    }
    if (!databaseId || databaseId.length < 32) {
      wx.showToast({
        title: '请填写 Database ID',
        icon: 'error'
      })
      return
    }
    await db.collection('config').doc('notion').set({
      data: {
        token,
        databaseId
      }
    })
    wx.showToast({
      title: '保存成功'
    })
    this.setData({
      saved: true
    })
  },
})