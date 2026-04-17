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
    .map((b, i) => ({ ...b, _index: i }))
    .filter(b => b.type === 'image' && b._originalSrc)

  // 2. 并行转存图片（最多 5 张并行）
  const results = []
  for (let i = 0; i < imageBlocks.length; i += 5) {
    const batch = imageBlocks.slice(i, i + 5)
    const uploaded = await Promise.all(
      batch.map((b, j) => uploadOne(b._originalSrc, i + j))
    )
    results.push(...uploaded)
  }

  // 3. 构建 originalSrc -> cloudUrl 的映射
  const srcToCloud = {}
  // 替换掉 forEach 那段
  for (let idx = 0; idx < imageBlockIds.length; idx++) {
    const blockId = imageBlockIds[idx]
    const src = imageBlocks[idx]?._originalSrc
    if (!src || !srcToCloud[src]) continue

    try {
      await axios.patch(
        `https://api.notion.com/v1/blocks/${blockId}`,
        { image: { type: 'external', external: { url: srcToCloud[src] } } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        }
      )
      updated++
    } catch (e) {
      console.warn(`[uploadImages] block ${blockId} 更新失败`, e.message)
    }
  }

  return { success: true, updated, failed: imageBlockIds.length - updated }
}
