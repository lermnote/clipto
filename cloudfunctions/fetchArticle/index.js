const cloud = require('wx-server-sdk')
const axios = require('axios')
const {
  Readability
} = require('@mozilla/readability')
const {
  JSDOM
} = require('jsdom')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 移除公众号底部无关元素
function cleanWechatFooter(document) {
  const selectors = [
    '#js_pc_qr_code', // 底部二维码
    '.qr_code', // 二维码相关
    '.appmsg_extra', // 文章底部额外信息
    '#js_author_name', // 作者信息
    '.profile_inner', // 账号信息
    '#js_share_source', // 分享来源
    '.weui-desktop-online-qr-code', // 桌面端二维码
    '[id*="qrcode"]', // 二维码相关ID
    '[class*="qrcode"]', // 二维码相关class
    '[class*="profile"]', // 账号profile
  ]
  selectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => el.remove())
    } catch (e) {}
  })
  return document
}

function domToBlocks(document) {
  const blocks = []
  const elements = document.querySelectorAll('p, h1, h2, h3, h4, img, blockquote, pre')

  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    const text = el.textContent.trim()

    if (tag === 'img') {
      // 先用原始 src 占位，后续再替换
      const src = el.getAttribute('data-src') || el.getAttribute('src') || ''
      if (!src || src.startsWith('data:')) continue
      blocks.push({
        type: 'image',
        image: {
          type: 'external',
          external: {
            url: src
          }
        },
        _originalSrc: src // 标记待替换
      })
    } else if (!text) {
      continue
    } else if (tag === 'blockquote') {
      blocks.push({
        type: 'quote',
        quote: {
          rich_text: [{
            type: 'text',
            text: {
              content: text.slice(0, 2000)
            }
          }]
        }
      })
    } else if (tag === 'pre') {
      blocks.push({
        type: 'code',
        code: {
          rich_text: [{
            type: 'text',
            text: {
              content: text.slice(0, 2000)
            }
          }],
          language: 'plain text'
        }
      })
    } else if (tag === 'h1' || tag === 'h2') {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: {
              content: text.slice(0, 200)
            }
          }]
        }
      })
    } else if (tag === 'h3' || tag === 'h4') {
      blocks.push({
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: {
              content: text.slice(0, 200)
            }
          }]
        }
      })
    } else {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: {
              content: text.slice(0, 2000)
            }
          }]
        }
      })
    }

    if (blocks.length >= 95) break
  }

  return blocks
}

exports.main = async (event) => {
  try {
    const {
      url
    } = event

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        Referer: 'https://mp.weixin.qq.com'
      },
      timeout: 30000
    })

    const dom = new JSDOM(res.data, {
      url
    })

    // Readability 提取元信息
    const reader = new Readability(dom.window.document.cloneNode(true))
    const article = reader.parse()

    // 原始 DOM 转 blocks（保留图片原始 src）
    const rawDom = new JSDOM(res.data, {
      url
    })
    cleanWechatFooter(rawDom.window.document)
    const blocks = domToBlocks(rawDom.window.document)

    // 提取封面图：优先 og:image，其次 article.topImage
    const ogImage = dom.window.document.querySelector('meta[property="og:image"]')?.content
    const coverImage = ogImage || article?.topImage?.src || null

    return {
      title: article?.title || '无标题',
      excerpt: article?.excerpt?.slice(0, 200) || '',
      blocks,
      url,
      coverImage
    }
  } catch (e) {
    const isTimeout = e.code === 'ECONNABORTED' || e.message?.includes('timeout')
    return {
      error: true,
      type: isTimeout ? 'timeout' : 'network',
      message: e.message || '抓取失败'
    }
  }

}