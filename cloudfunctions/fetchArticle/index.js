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
    } catch (e) { }
  })
  return document
}

/**
 * 把一个元素的行内内容转成 Notion rich_text 数组
 * 支持：粗体、斜体、行内代码、删除线、链接、普通文字
 * 公众号常见的 style="font-weight:bold" 也能识别
 */
function parseInlineRichText(el, inherited = {}) {
  const items = []

  for (const node of el.childNodes) {
    // 文字节点
    if (node.nodeType === 3) {
      const content = node.textContent
      if (!content) continue
      items.push({
        type: 'text',
        text: { content: content.slice(0, 2000) },
        annotations: {
          bold: !!inherited.bold,
          italic: !!inherited.italic,
          code: !!inherited.code,
          strikethrough: !!inherited.strikethrough,
          underline: false,
          color: 'default'
        }
      })
      continue
    }

    // 元素节点
    if (node.nodeType !== 1) continue
    const tag = node.tagName.toLowerCase()

    // 跳过脚本、样式、图片（图片单独处理为 block）
    if (['script', 'style', 'img', 'br'].includes(tag)) continue

    // 检测行内样式里的 bold（公众号大量用 span+style）
    const style = node.getAttribute?.('style') || ''
    const styleHasBold = /font-weight\s*:\s*(bold|[6-9]\d{2})/i.test(style)
    const styleHasItalic = /font-style\s*:\s*italic/i.test(style)

    // 累积 annotations
    const next = {
      bold: inherited.bold || ['strong', 'b'].includes(tag) || styleHasBold,
      italic: inherited.italic || ['em', 'i'].includes(tag) || styleHasItalic,
      code: inherited.code || tag === 'code',
      strikethrough: inherited.strikethrough || ['s', 'del', 'strike'].includes(tag)
    }

    // 链接：递归解析子节点保留行内 annotation，再给每项挂上 href
    if (tag === 'a') {
      const href = node.getAttribute('href') || ''
      const safeHref = href.startsWith('http') ? href.slice(0, 2000) : ''
      if (!node.textContent.trim()) continue
      const inner = parseInlineRichText(node, next)
      for (const item of inner) {
        if (item.type === 'text' && safeHref) {
          item.text.link = { url: safeHref }
        }
      }
      items.push(...inner)
      continue
    }

    // 递归处理其他行内元素（span、label 等）
    items.push(...parseInlineRichText(node, next))
  }

  // Notion 单个 block 的 rich_text 上限是 100 项，合并相邻同 annotation 的纯文字片段
  return mergeRichText(items).slice(0, 100)
}

/**
 * 合并 rich_text 数组里相邻、annotation 完全相同的文字节点
 * 减少碎片，降低触碰 100 项上限的概率
 */
function mergeRichText(items) {
  const out = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.type === 'text' &&
      item.type === 'text' &&
      !prev.text.link && !item.text.link &&
      JSON.stringify(prev.annotations) === JSON.stringify(item.annotations) &&
      (prev.text.content + item.text.content).length <= 2000
    ) {
      prev.text.content += item.text.content
    } else {
      out.push(item)
    }
  }
  return out
}

/**
 * 提取 img 元素的图片 src（兼容公众号懒加载 data-src）
 */
function extractImgSrc(el) {
  return el.getAttribute('data-src') || el.getAttribute('src') || ''
}

/**
 * 把整个 document 转成 Notion blocks 数组
 * 支持：h1-h4、p、ul/ol、blockquote、pre/code、hr、img
 * 所有文字类 block 的行内内容均保留粗体、斜体、代码、链接、删除线
 */
function domToBlocks(document) {
  const blocks = []

  // 选取文章主体：公众号正文在 #js_content，兜底取 body
  const root = document.querySelector('#js_content') || document.body

  function walk(node) {
    if (blocks.length >= 95) return
    if (node.nodeType !== 1) return

    const tag = node.tagName.toLowerCase()

    // ── 分割线 ──────────────────────────────────────────
    if (tag === 'hr') {
      blocks.push({ type: 'divider', divider: {} })
      return
    }

    // ── 图片 ────────────────────────────────────────────
    if (tag === 'img') {
      const src = extractImgSrc(node)
      if (!src || src.startsWith('data:')) return
      blocks.push({
        type: 'image',
        image: { type: 'external', external: { url: src } },
        _originalSrc: src
      })
      return
    }

    // ── 标题 ────────────────────────────────────────────
    if (tag === 'h1' || tag === 'h2') {
      const rt = parseInlineRichText(node)
      if (!rt.length) return
      blocks.push({ type: 'heading_2', heading_2: { rich_text: rt } })
      return
    }
    if (tag === 'h3' || tag === 'h4') {
      const rt = parseInlineRichText(node)
      if (!rt.length) return
      blocks.push({ type: 'heading_3', heading_3: { rich_text: rt } })
      return
    }

    // ── 代码块 ──────────────────────────────────────────
    if (tag === 'pre') {
      const codeEl = node.querySelector('code')
      const text = (codeEl || node).textContent.trim()
      if (!text) return
      // 尝试从 class 里读语言，如 "language-javascript"
      const cls = (codeEl || node).getAttribute('class') || ''
      const langMatch = cls.match(/language-(\w+)/)
      const language = langMatch ? langMatch[1] : 'plain text'
      blocks.push({
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
          language
        }
      })
      return
    }

    // ── 引用 ────────────────────────────────────────────
    if (tag === 'blockquote') {
      const rt = parseInlineRichText(node)
      if (!rt.length) return
      blocks.push({ type: 'quote', quote: { rich_text: rt } })
      return
    }

    // ── 无序列表 ─────────────────────────────────────────
    if (tag === 'ul') {
      for (const li of node.querySelectorAll(':scope > li')) {
        if (blocks.length >= 95) break
        const rt = parseInlineRichText(li)
        if (!rt.length) continue
        blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt } })
      }
      return
    }

    // ── 有序列表 ─────────────────────────────────────────
    if (tag === 'ol') {
      for (const li of node.querySelectorAll(':scope > li')) {
        if (blocks.length >= 95) break
        const rt = parseInlineRichText(li)
        if (!rt.length) continue
        blocks.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt } })
      }
      return
    }

    // ── 段落 ────────────────────────────────────────────
    if (tag === 'p') {
      // 段落里如果有图片，先把图片提出来单独处理
      const imgs = node.querySelectorAll('img')
      if (imgs.length) {
        for (const img of imgs) {
          const src = extractImgSrc(img)
          if (!src || src.startsWith('data:')) continue
          blocks.push({
            type: 'image',
            image: { type: 'external', external: { url: src } },
            _originalSrc: src
          })
        }
        // 图片段落通常没有文字，但如果有就继续处理
        const text = node.textContent.trim()
        if (!text) return
      }
      // 纯空白段落跳过
      if (!node.textContent.trim()) return
      const rt = parseInlineRichText(node)
      if (!rt.length) return
      blocks.push({ type: 'paragraph', paragraph: { rich_text: rt } })
      return
    }

    // ── section / div 等容器：递归进去 ──────────────────
    if (['section', 'div', 'article', 'main', 'figure'].includes(tag)) {
      for (const child of node.childNodes) {
        if (blocks.length >= 95) break
        walk(child)
      }
      return
    }

    // ── 其余行内元素（span 等）当段落处理 ───────────────
    const text = node.textContent.trim()
    if (!text) return
    const rt = parseInlineRichText(node)
    if (!rt.length) return
    blocks.push({ type: 'paragraph', paragraph: { rich_text: rt } })
  }

  for (const child of root.childNodes) {
    if (blocks.length >= 95) break
    walk(child)
  }

  return blocks
}

exports.main = async (event) => {
  const { url } = event

  // URL 白名单校验
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { error: true, type: 'invalid', message: '无效的 URL 格式' }
  }

  const ALLOWED_HOSTS = [
    'mp.weixin.qq.com',
    'weixin.qq.com',
    // 后续可扩展：'zhuanlan.zhihu.com', 'sspai.com' 等
  ]

  if (parsed.protocol !== 'https:') {
    return { error: true, type: 'invalid', message: '仅支持 HTTPS 链接' }
  }

  if (!ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    return { error: true, type: 'invalid', message: '暂不支持该来源，目前仅支持微信公众号文章' }
  }

  try {
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