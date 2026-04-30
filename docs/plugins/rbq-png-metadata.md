# NAI 图片信息提取器

插件 ID：`rbq-png-metadata`

入口文件：[`../../plugins/png-metadata-extractor.js`](../../plugins/png-metadata-extractor.js)

---

## 功能简介

NAI 图片信息提取器用于读取 NovelAI 原生 PNG 图片中的隐藏元数据，并展示 prompt、负面 prompt、seed、尺寸、步数、CFG、采样器等信息。

---

## 使用方式

1. 打开 RBQ 画廊或 SillyTavern 图片查看器。
2. 插件会在查看器工具栏注入一个魔法棒按钮。
3. 点击按钮后，插件下载当前图片并解析 PNG `tEXt` / `iTXt` chunk。
4. 如果识别到 NovelAI JSON 元数据，会弹出结果窗口。

---

## 支持的查看器

- RBQ 自定义图片查看器。
- Fancybox 4。
- Fancybox 3。
- LightGallery。
- SillyTavern 经典 zoom dialog。
- swipe zoom dialog。

---

## 限制

- 仅支持仍保留原始 PNG 元数据的图片。
- 如果图片被平台压缩成 WebP/JPEG，元数据通常会丢失。
- 主要面向 NovelAI 官方格式。

---

## 移动端适配

结果弹窗已针对手机端安全区、滚动高度、按钮挤压和单列布局做适配。
