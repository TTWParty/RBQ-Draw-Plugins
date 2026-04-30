# Hello World 测试扩展

插件 ID：`rbq-core-hello`

入口文件：[`../../plugins/example-hello.js`](../../plugins/example-hello.js)

---

## 功能简介

这是 RBQ 子插件生态的最小示例插件，用于演示插件如何被宿主加载、如何访问 `RBQ`、`jQuery` 和 `toastr`，以及如何在控制台或界面中输出调试信息。

适合开发者作为新插件模板参考。

---

## 适用场景

- 验证插件市场安装、更新、卸载流程。
- 验证宿主是否成功加载子插件。
- 作为新插件开发的最小入口示例。

---

## 开发参考

查看源码：[`../../plugins/example-hello.js`](../../plugins/example-hello.js)

开发新插件时建议复制它的闭包结构，并在内部逐步添加自己的逻辑。
