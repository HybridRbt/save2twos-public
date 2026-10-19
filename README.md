# save2twos

将 Drafts 当前草稿发送到 Twos 的 Action 脚本。

## 使用

1. 在 Drafts 的 Action 中添加 Script 步骤，粘贴 `save2twos.js`。
2. 此脚本使用异步入口，需启用该步骤的 **Allow asynchronous execution**。
3. 首次运行时填写 `Post to Twos` 凭据：`api`、`user_id`、`token`，沿用你原有的接口配置。

凭据通过 Drafts Credential 保存，不要将真实 token 或私人接口地址写入仓库。

## 当前版本

每次发送时在正文末尾追加 ` #drafts`。如果正文已有用空白或文本边界隔开的 `#drafts`（不区分大小写），则不重复追加。不会修改 Drafts 原文或同步草稿自身的其他标签。

示例：`买牛奶` → `买牛奶 #drafts`。

取消凭据授权、缺少必要字段或正文为空白时停止发送；Token 使用密码输入框。HTTP 失败会提示状态码，网络异常给出固定提示，不记录完整响应或凭据，不自动重试创建请求。

该脚本的 `user_id` / `token` 请求格式与当前 Twos v1 Bearer API 不同；不能直接替换成 `/api/v1/things`。

## 验证与审查

运行 `node --check save2twos.js` 检查 JavaScript 语法，运行 `node --test` 执行回归测试（需要 Node.js 18+，无第三方依赖）。测试通过 VM 执行实际脚本，仅模拟 Drafts 专有 API 和网络边界。

参见 [代码评审](docs/代码评审.md)。尚未在真实 Drafts Action 中执行，也未向 Twos 发送测试内容。

Twos [官方标签文档](https://twosapp.com/docs/things/tags)介绍了 `#标签` 语法。当前脚本保留原接口请求格式和 HTTP 200 成功判定；旧接口是否识别标签、是否将多行拆成多个条目，需用实际接口验证。脚本只在整个发送文本末尾追加标签，不逐行追加。
