const db = wx.cloud.database()

/** wx.request Promise 封装 */
function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      ...options,
      success: resolve,
      fail: reject
    })
  })
}

Page({
  data: {
    url: '',
    title: '',
    excerpt: '',
    tag: '',
    blocks: [],
    coverImage: '', // 封面图 URL，抓取后保存
    loading: false,
    fetched: false
  },

  async onLoad(options) {
    if (options.url) {
      this.setData({
        url: decodeURIComponent(options.url)
      })
      this.fetchContent()
    }
  },

  onShow() {
    // 避免重复抓取：只有 pendingUrl 时才抓取（来自小程序内跳转）
    const app = getApp()
    const pendingUrl = app.globalData.pendingUrl
    if (pendingUrl && !this._fetching) {
      app.globalData.pendingUrl = null
      this.setData({
        url: pendingUrl
      })
      this.fetchContent()
    }
  },

  onUrlInput(e) {
    this.setData({
      url: e.detail.value
    })
  },

  async fetchContent() {
    // 防重入
    if (this._fetching) return
    this._fetching = true

    const {
      url
    } = this.data
    if (!url) {
      wx.showToast({
        title: '请先输入链接',
        icon: 'none'
      })
      return
    }
    this.setData({
      loading: true,
      fetched: false
    })
    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchArticle',
        data: {
          url
        }
      })

      // cloud function 调用本身失败（如云函数未部署、超时）
      if (!res || res.errMsg !== 'cloud.callFunction:ok') {
        console.error('[fetchContent] cloud.callFunction 失败', res)
        wx.showToast({
          title: '云函数调用失败，请确认已部署',
          icon: 'none',
          duration: 3000
        })
        this.setData({
          loading: false
        })
        return
      }

      const result = res.result || {}

      // 云函数返回的结构化错误
      if (result.error) {
        const tips = {
          timeout: '网页加载超时（>25s），可尝试：1)稍后重试 2)换用短链接 3)手动填写',
          network: result.message || '网络请求失败，请检查链接是否可访问'
        }
        wx.showToast({
          title: tips[result.type] || result.message,
          icon: 'none',
          duration: 3000
        })
        this.setData({
          loading: false
        })
        return
      }

      // 兜底：result 里没有 title 视为空结果
      if (!result.title) {
        wx.showToast({
          title: '未能识别正文，可手动填写标题',
          icon: 'none'
        })
      }

      const {
        title,
        excerpt,
        blocks,
        coverImage
      } = result
      this.setData({
        title: title || '',
        excerpt: excerpt || '',
        blocks: blocks || [],
        coverImage: coverImage || '',
        fetched: true
      })

    } catch (e) {
      console.error('[fetchContent] 未预期错误', e)
      wx.showToast({
        title: '抓取失败，请手动填写',
        icon: 'none'
      })
    } finally {
      this._fetching = false
      this.setData({
        loading: false
      })
    }
  },

  onTitleInput(e) {
    this.setData({
      title: e.detail.value
    })
  },
  onTagInput(e) {
    this.setData({
      tag: e.detail.value
    })
  },

  async saveToNotion() {
    // 防重入：保存中则忽略
    if (this._saving) return
    this._saving = true

    const {
      url,
      title,
      excerpt,
      tag,
      blocks,
      coverImage
    } = this.data

    if (!url || !title) {
      this._saving = false
      wx.showToast({
        title: '链接和标题不能为空',
        icon: 'none'
      })
      return
    }

    this.setData({
      loading: true
    })
    try {
      const configRes = await db.collection('config').doc('notion').get()
      const token = configRes.data.token
      const databaseId = configRes.data.databaseId
      if (!token || !databaseId) {
        throw new Error('请先在设置页配置 Token 和 Database ID')
      }

      // 封面图处理：直接用原始URL（公众号图片可公开访问）
      let notionCover = null
      if (coverImage) {
        notionCover = {
          type: 'external',
          external: {
            url: coverImage
          }
        }
      }

      // ---- 关键改动：图片 block 先用原始 src 占位，去掉 _originalSrc 标记 ----
      // 跳过 blocks 中第一张图片，如果它和封面图 URL 相同（封面图不重复出现在正文）
      let skippedFirstImage = false
      const cleanBlocks = (blocks || []).map(b => {
        if (b.type === 'image') {
          const src = b.image?.external?.url || ''
          if (!skippedFirstImage && coverImage && src === coverImage) {
            skippedFirstImage = true
            return null  // 跳过封面图
          }
          return {
            type: 'image',
            image: b.image
          }
        }
        return b
      }).filter(Boolean)

      // 第一步：创建页面
      const pagePayload = {
        parent: {
          database_id: databaseId
        },
        properties: {
          Name: {
            title: [{
              text: {
                content: title
              }
            }]
          },
          URL: {
            url
          },
          Tags: {
            multi_select: tag ? [{
              name: tag
            }] : []
          },
          摘要: {
            rich_text: [{
              text: {
                content: excerpt || ''
              }
            }]
          },
          Date: {
            date: {
              start: new Date().toISOString().slice(0, 10)
            }
          }
        },
        children: cleanBlocks.slice(0, 50)
      }
      if (notionCover) pagePayload.cover = notionCover

      const createRes = await wxRequest({
        url: 'https://api.notion.com/v1/pages',
        method: 'POST',
        header: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        data: pagePayload
      })

      if (createRes.statusCode !== 200) {
        const notionMsg = createRes.data?.message || ''
        const hints = []
        if (notionMsg.includes('validation')) hints.push('字段验证失败')
        if (notionMsg.includes('database_id') || notionMsg.includes('Could not find')) hints.push('Database ID 有误')
        if (notionMsg.includes('parent')) hints.push('parent 配置错误')
        const hint = hints.length ? `（${hints.join('、')}）` : ''
        throw new Error(`Notion 创建失败 ${createRes.statusCode}${hint}: ${notionMsg}`)
      }

      const pageId = createRes.data.id

      // 第二步：剩余 block 分批 append（逻辑不变）
      const remaining = cleanBlocks.slice(50)
      for (let i = 0; i < remaining.length; i += 50) {
        const batch = remaining.slice(i, i + 50)
        const patchRes = await wxRequest({
          url: `https://api.notion.com/v1/blocks/${pageId}/children`,
          method: 'PATCH',
          header: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          data: {
            children: batch
          }
        })
        if (patchRes.statusCode !== 200) {
          console.warn('追加 block 失败', patchRes.data)
        }
      }

      // 第三步：写历史（逻辑不变）
      await db.collection('history').add({
        data: {
          title,
          url,
          tag,
          notionPageId: pageId,
          createdAt: db.serverDate()
        }
      })

      // 第四步：异步触发图片转存，不等结果
      const hasImages = (blocks || []).some(b => b.type === 'image' && b._originalSrc)
      if (hasImages) {
        wx.cloud.callFunction({
          name: 'uploadImages',
          data: {
            pageId,
            token,
            blocks
          } // 传原始 blocks（含 _originalSrc）
        }).catch(e => console.warn('[uploadImages] 后台转存失败', e))
      }

      wx.showToast({
        title: '已保存',
        icon: 'success',
        duration: 1500
      })
      setTimeout(() => wx.switchTab({
        url: '/pages/history/history'
      }), 1500)

    } catch (e) {
      console.error('[saveToNotion] 失败', e)
      wx.showToast({
        title: e.message || '保存失败，请重试',
        icon: 'none',
        duration: 2500
      })
    } finally {
      this._saving = false
      this.setData({
        loading: false
      })
    }
  }
})