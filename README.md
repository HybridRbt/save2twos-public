# save2twos

将 Drafts 当前草稿发送到 Twos 的 Action 脚本。

## 使用

1. 在 Drafts 的 Action 中添加 Script 步骤，粘贴 `save2twos.js`。
2. 此脚本使用异步入口，需启用该步骤的 **Allow asynchronous execution**。
3. 在 Twos **Settings → API Keys** 创建具有 `write:things` 权限的 API key。
4. 首次运行时在新的 `Post to Twos v1` 凭据窗口填写 API key。旧 `Post to Twos` 的 `api`、`user_id`、`token` 不再使用，不会自动替换或删除旧凭据。

凭据通过 Drafts Credential 保存，不要将真实 token 或私人接口地址写入仓库。

## 当前版本

每次发送时在正文末尾追加 ` #drafts`。如果正文已有用空白或文本边界隔开的 `#drafts`（不区分大小写），则不重复追加。不会修改 Drafts 原文或同步草稿自身的其他标签。

示例：`买牛奶` → `买牛奶 #drafts`。

使用官方 `POST https://www.twosapp.com/api/v1/things`，以 JSON 发送，API key 放在 `Authorization: Bearer` 头中，不放入正文。除正文中的 `#drafts` 外，也通过官方 `tags: ["drafts"]` 字段明确指定来源标签。

取消凭据授权、API key 为空或正文为空白时停止发送；API key 使用密码输入框。HTTP 失败会提示状态码，网络异常给出固定提示，不记录完整响应或凭据，不自动重试创建请求。创建成功要求 HTTP 201。

## 创建时间与日期页面

读取 Drafts 的 `draft.createdAt`，将 ISO 8601 时间写入官方 `created` 字段，并通过 `list: "YYYY-MM-DD"` 放入相应日期的页面。日期以运行 Drafts 的设备时区解释该创建时刻，不使用发送当天，也不直接截取 UTC 日期。读取不到有效创建时间时停止发送。

时间点与显示时区是两回事。例如 `2026-10-20 14:00 +08:00` 与 `2026-10-20 01:00 -05:00` 是同一时刻；传入 `created` 保留的是该时刻，不能强制 Twos 的界面保留中国时区。官方接口未提供条目原始时区的专用字段，Drafts 的 `createdAt` 也不携带创建地时区标识。

当前尚未添加固定时区文字或创建时区选择器。若在另一个时区补发旧草稿，日期页面会按发送设备时区计算，无法自动还原创建地日期。固定原当地时间的展示方案待用户确认后继续实现。

## 验证与审查

运行 `node --check save2twos.js` 检查 JavaScript 语法，运行 `node --test` 执行回归测试（需要 Node.js 18+，无第三方依赖）。测试通过 VM 执行实际脚本，仅模拟 Drafts 专有 API 和网络边界。

参见 [代码评审](docs/代码评审.md)。尚未在真实 Drafts Action 中执行，也未向 Twos 发送测试内容。

上海与芝加哥时区下各 21 项测试通过，包含本地午夜前后归档日期、ISO 时间、HTTP 201、新凭据及失败路径。尚未使用真实 API key 进行端到端测试。脚本不会创建失败后自动换一种参数再次发送，避免重复条目。

官方参考：[Twos API](https://www.twosapp.com/developers)、[Twos 时区](https://twosapp.com/docs/customize/time-zones)、[Drafts 创建时间](https://scripting.getdrafts.com/classes/Draft#createdat)。
