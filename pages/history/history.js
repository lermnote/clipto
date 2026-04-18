// pages/history/history.js
const db = wx.cloud.database()

/** 格式化日期：将 Date 对象或时间戳转为 YYYY-MM-DD HH:mm */
function formatDate(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    list: [],
    loading: true
  },

  async onShow() {
    // 有缓存则直接使用，避免每次切 tab 都全量拉取
    if (this._cachedList) {
      this.setData({ list: this._cachedList, loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await db.collection('history')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      const list = res.data.map(item => ({
        ...item,
        createdAt: formatDate(item.createdAt)
      }))
      this._cachedList = list  // 缓存结果
      this.setData({ list, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  openArticle(e) {
    const { url } = e.currentTarget.dataset
    if (!url) return
    wx.showModal({
      title: '打开原文',
      content: '小程序内无法直接跳转，是否复制链接到剪贴板？',
      confirmText: '复制',
      success: (r) => {
        if (r.confirm) wx.setClipboardData({ data: url })
      }
    })
  },

  openNotion(e) {
    const { pageId } = e.currentTarget.dataset
    wx.setClipboardData({
      data: `https://notion.so/${pageId.replace(/-/g, '')}`,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    })
  },

  deleteItem(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await db.collection('history').doc(id).remove()
          this._cachedList = null  // 删除后清缓存，下次 onShow 会重新拉取
          this.setData({
            list: this.data.list.filter(item => item._id !== id)
          })
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }
})