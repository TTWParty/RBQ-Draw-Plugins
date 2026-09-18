# 安卓保存修复 (Save Downloads Fix)

插件 ID：`rbq-save-downloads-fix`

入口文件：[`../../plugins/save-downloads-fix.js`](../../plugins/save-downloads-fix.js)

---

## 功能简介

修复安卓版 TauriTavern 在保存图片/文件时出现：

```
Error invoking saveFileToDownloads: Java exception was raised during method invocation
```

导致内容无法保存到下载目录的问题。

TauriTavern 安卓端会把所有 `<a download>` 保存请求劫持到原生桥 `saveFileToDownloads`（Kotlin 实现），该方法内部任一校验失败（暂存文件不存在、路径越界、文件名含路径分隔符、MediaStore 写入失败等）都会以 Chromium 的通用报错抛出，网页侧看不到具体原因。

本插件不修改主程序与主插件，从子插件层做三层修复：

1. **原生桥透明修正**：直接调用 `saveFileToDownloads` 前自动清洗非法文件名（路径分隔符等）；失败后自动改用纯 ASCII 文件名原地重试。
2. **接管 `<a download>` 保存**：同时覆盖「临时 `<a>` 元素 `a.click()`」与「真实点击已挂载链接」两条路径，拦截后自建完整保存链。
3. **弹性降级链**：原生直存（原名）→ 原生直存（ASCII 名）→ 系统另存为（SAF 文档选择器）兜底；每一步尝试写入控制台日志。

---

## 适用场景

- 安卓版 TauriTavern 中保存 RBQ-Draw 生成的图片报 Java 异常。
- 保存预设 / 导出 ZIP / 导出 Vibe 等走 `<a download>` 的功能在安卓端失败。
- 需要定位保存失败具体在哪一层时，查看控制台 `[RBQ SaveFix]` 日志或 `window.__RBQ_SAVE_FIX__.diag`。

---

## 修复链说明

| 顺序 | 方式 | 说明 |
| --- | --- | --- |
| 1 | 原生直存（原名） | 与主程序行为一致，成功则体验无任何变化 |
| 2 | 原生直存（ASCII 名） | 规避部分 ROM 对非 ASCII 文件名写入 MediaStore 的兼容问题 |
| 3 | 系统另存为 (SAF) | 弹出系统「另存为」窗口，用户选择位置后写入，绕开 MediaStore 直存全部校验 |

暂存文件统一写入应用缓存目录下 `tauritavern-export-staging/rbqfix-*`，与主程序桥的暂存根目录保持一致，全部完成后自动清理。

---

## 调试入口

- 控制台过滤 `RBQ SaveFix` 查看每一步尝试与失败原因。
- `window.__RBQ_SAVE_FIX__.diag`：最近一次保存的尝试明细与结果。
- `window.__RBQ_SAVE_FIX__.saveBlob(blob, '文件名.png')`：手动对任意 Blob 触发完整保存链。

---

## 兼容性

- 桌面端、网页端、iOS 环境下插件完全静默，不改变任何行为。
- 系统另存为窗口超时为 3 分钟，未选择会按取消处理。
