const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function uploadOne(src, index) {
  try {
    const res = await axios.get(src, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { Referer: 'https://mp.weixin.qq.com' }
    })
    const ext = src.includes('.png') ? 'png' : 'jpg'
    const upload = await cloud.uploadFile({
      cloudPath: `images/${Date.now()}_${index}.${ext}`,
      fileContent: Buffer.from(res.data)
    })
    const urlRes = await cloud.getTempFileURL({ fileList: [upload.fileID] })
    return urlRes.fileList[0].tempFileURL
  } catch {
    return null
  }
}

exports.main = async (event) => {
  const { pageId, token, blocks } = event

  // 1. 找出所有待转存的图片 block
  const imageBlocks = blocks
    .filter(b => b.type === 'image' && b._originalSrc)

  if (imageBlocks.length === 0) {
    return { success: true, updated: 0 }
  }

  // 2. 并行转存图片到云存储
  const uploadedUrls = await Promise.all(
    imageBlocks.map((b, i) => uploadOne(b._originalSrc, i))
  )

  // 3. 构建 originalSrc -> cloudUrl 的映射
  const srcToCloud = {}
  imageBlocks.forEach((b, i) => {
    if (uploadedUrls[i]) {
      srcToCloud[b._originalSrc] = uploadedUrls[i]
    }
  })

  // 4. 获取页面已有图片 block 的 ID
  const childrenRes = await axios.get(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28'
      }
    }
  )

  const imageBlockIds = (childrenRes.data.results || [])
    .filter(b => b.type === 'image')
    .map(b => b.id)

  // 5. 逐个更新图片 block
  let updated = 0
  imageBlockIds.forEach((blockId, idx) => {
    const src = imageBlocks[idx]?._originalSrc
    if (!src || !srcToCloud[src]) return

    axios.patch(
      `https://api.notion.com/v1/blocks/${blockId}`,
      {
        image: {
          type: 'external',
          external: { url: srcToCloud[src] }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      }
    ).then(() => updated++)
  })

  return { success: true, updated, failed: imageBlocks.length - updated }
}
