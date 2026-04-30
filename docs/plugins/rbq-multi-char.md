# NAI 多角色模式 (Multi-Char)

插件 ID：`rbq-multi-char`

入口文件：[`../../plugins/multi-char-composer.js`](../../plugins/multi-char-composer.js)

---

## 功能简介

NAI 多角色模式用于把特定格式的多角色生图描述转换为 NovelAI V4.5 原生多角色 API 结构。

它适配类似“摸鱼世界书”的多角色文生图格式。

---

## 输入格式示例

```text
image###Scene:...;Char1:...|centers:C3;###
```

插件会解析场景、角色与位置等信息，并映射到 NAI V4.5 payload。

---

## 工作方式

插件通过 RBQ Hook 拦截 NAI payload，在出图请求发送前重写或补充多角色相关参数。

---

## 注意事项

- 该插件依赖特定文本格式。
- 如果格式不完整或字段缺失，可能无法正确映射。
- 建议与支持该格式的世界书或提示词模板配合使用。
