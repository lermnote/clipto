# Clipto - 公众号文章剪藏工具

将公众号文章一键保存到 Notion，方便阅读和管理。

## 功能特性

- **文章抓取**：输入公众号文章链接，自动提取标题、正文、图片
- **封面图**：自动提取并设置为 Notion 页面封面
- **Notion 同步**：支持同步到指定 Notion Database
- **历史记录**：查看已保存的文章列表，支持复制链接、删除
- **重置配置**：可在设置页清除所有配置
- **图片转存**：自动将公众号图片转存到云存储，避免图片失效
> 注：图片转存功能目前使用云存储临时链接（7 天有效期），
> 永久链接方案待后续版本完善。

## 技术架构

- **小程序端**：微信小程序 + 云开发
- **云函数**：
  - `fetchArticle`：抓取网页内容，提取标题、正文、封面图
  - `uploadImages`：将公众号图片转存到云存储并更新 Notion
- **存储**：微信云存储
- **同步目标**：Notion API

## 项目结构

```
clipto/
├── pages/
│   ├── index/      # 首页（设置 Token 和 Database ID）
│   ├── clip/       # 剪藏页（输入链接抓取文章）
│   └── history/    # 历史记录
├── images/icons/   # 图标资源
├── cloudfunctions/
│   ├── fetchArticle/  # 文章抓取云函数
│   └── uploadImages/  # 图片转存云函数
└── app.js
```

## 配置说明

### 1. Notion 设置

1. 创建 Notion Integration：[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. 创建 Database，包含以下字段：
   - `Name`（标题类型）
   - `URL`（URL 类型，可选）
   - `Tags`（多选类型，可选）
   - `摘要`（文本类型，可选）
   - `Date`（日期类型，可选）
3. 分享 Database 给 Integration，获取 Database ID

### 2. 小程序配置

在设置页填入：
- **Notion Token**：`secret_` 或 `ntn_` 开头的 Integration Token
- **Database ID**：Notion Database URL 中的 32 位字符

### 3. 云开发配置

确保已开通云开发，并在微信开发者工具中部署云函数：
- `fetchArticle`
- `uploadImages`

### 4. 云数据库权限

在云开发控制台，将 `config` 和 `history` 集合的权限设置为：
- 读：**仅创建者可读**
- 写：**仅创建者可写**

这样可以确保你的 Notion Token 不会被其他用户读取。

## 使用流程

1. 打开小程序，进入「设置」页面配置 Notion
2. 进入「剪藏」页面，粘贴公众号文章链接
3. 点击抓取，预览内容后点击保存
4. 文章自动同步到 Notion，历史记录可在「历史」页面查看

## 开发说明

### 云函数依赖

```bash
cd clipto/cloudfunctions/fetchArticle
npm install
```

依赖：`axios`、`jsdom`

### 本地开发

1. 克隆项目
2. 使用微信开发者工具导入 `clipto` 文件夹
3. 开通云开发环境
4. 部署云函数
5. 修改 `project.config.json` 中的 appid 为你的小程序 appid
