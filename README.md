# save2twos

将 Drafts 当前草稿发送到 Twos 的 Action 脚本。

## 使用

1. 在 Drafts 的 Action 中添加 Script 步骤，粘贴 `save2twos.js`。
2. 此脚本使用异步入口，需启用该步骤的 **Allow asynchronous execution**。
3. 首次运行时填写 `Post to Twos` 凭据：`api`、`user_id`、`token`，沿用你原有的接口配置。

凭据通过 Drafts Credential 保存，不要将真实 token 或私人接口地址写入仓库。

## 当前版本

当前保存的是用户提供的原始脚本，未修改行为。固定 `drafts` 标签功能尚待确认方案后实现。

该脚本的 `user_id` / `token` 请求格式与当前 Twos v1 Bearer API 不同；不能直接替换成 `/api/v1/things`。

## 验证与审查

运行 `node --check save2twos.js` 检查 JavaScript 语法。Node.js 无法直接运行 Drafts 专有 API。

参见 [代码评审](docs/代码评审.md)。尚未在真实 Drafts Action 中执行，也未向 Twos 发送测试内容。
