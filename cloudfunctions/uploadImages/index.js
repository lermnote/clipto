const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function uploadOne(src, index) {
  try {
    const res = await axios.get(src, {
      responseType: 'arraybuffer',
      timeout: 10000,
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
  imageBlocks.forEach((b, idx) => {
    if (results[idx]) {
      srcToCloud[b._originalSrc] = results[idx]
    }
  })

  // 4. 获取页面已有 blocks，找到图片 block 的 ID
  const getRes = await axios.get(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28'
      }
    }
  )

  const existingBlocks = getRes.data.results || []
  const imageBlockIds = existingBlocks
    .filter(b => b.type === 'image')
    .map(b => b.id)

  // 5. 逐个更新图片 block（Notion API 不支持批量更新单个 block）
  let updated = 0
  for (const blockId of imageBlockIds) {
    // 找到这个 block 在原始 blocks 中的位置，对应新的 cloud URL
    const idx = imageBlockIds.indexOf(blockId)
    const src = imageBlocks[idx]?._originalSrc
    if (!src || !srcToCloud[src]) continue

    await axios.patch(
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
    )
    updated++
  }

  return { success: true, updated, failed: imageBlockIds.length - updated }
}
