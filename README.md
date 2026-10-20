# save2twos

将 Drafts 当前草稿发送到 Twos 的 Action 脚本。

## 使用

1. 在 Drafts 的 Action 中添加 Script 步骤，粘贴 `save2twos.js`。
2. 此脚本使用异步入口，需启用该步骤的 **Allow asynchronous execution**。
3. 在 Twos **Settings → API Keys** 创建具有 `write:things` 权限的 API key。
4. 首次运行时在新的 `Post to Twos v1` 凭据窗口填写 API key。旧 `Post to Twos` 的 `api`、`user_id`、`token` 不再使用，不会自动替换或删除旧凭据。

凭据通过 Drafts Credential 保存，不要将真实 token 或私人接口地址写入仓库。

## 当前版本

每次发送时通过原生 `tags: ["drafts"]` 添加来源标签，正文原样发送，不再自动追加 `#drafts` 文字。用户自己写在正文中的 hashtag 会保留，不会修改 Drafts 原文或同步草稿自身的其他标签。

示例：正文 `买牛奶` → Twos 正文仍为 `买牛奶`，同时拥有 `drafts` 标签。

使用官方 `POST https://www.twosapp.com/api/v1/things`，以 JSON 发送，API key 放在 `Authorization: Bearer` 头中，不放入正文。标签只通过官方 `tags` 字段传递。

## 来源附注与原稿链接

每次创建条目时，通过 `note` 字段附加以下来源信息（Markdown 列表）：

```text
- 来源：Drafts
- 创建时区：Asia/Shanghai
- 当地创建时间：2026-10-19 11:23:45 UTC+08:00
- Drafts UUID：12345678-1234-4321-9876-123456789abc
```

附注位于条目的备注区域，不拼接进 `text`。创建时区来自本次自动判断或手动选择，不是自动发现的历史所在地；当地时间和 UTC 偏移根据原创建时刻计算，包含相应日期的夏令时。附注时间显示到秒，官方 `created` 字段仍保留原始毫秒。原生 `drafts` 标签继续保留，用于筛选。

`url` 字段写入 `drafts://open?uuid=<编码后的UUID>`，供点击返回原稿。Drafts 支持该 URL Scheme；Twos 是否允许保存和打开自定义协议、具体客户端是否弹出跳转提示，需要实测。脚本不自动替换成其他链接或在失败后重发，避免重复创建。

如果草稿 UUID 缺失，发送前报错，避免保存不可用的原稿链接。重复发送仍创建新条目，不保存 UUID 到 Twos ID 的映射，不更新、不去重、不修改已有 Twos 条目。

取消凭据授权、API key 为空或正文为空白时停止发送；API key 使用密码输入框。HTTP 失败会提示状态码，网络异常给出固定提示，不记录完整响应或凭据，不自动重试创建请求。创建成功要求 HTTP 201。

## 创建时间与日期页面

读取 Drafts 的 `draft.createdAt`，将 ISO 8601 时间写入官方 `created` 字段，并通过 `list: "YYYY-MM-DD"` 放入相应日期的页面。日期以本次确定的创建时区解释该创建时刻，不使用发送当天，也不直接截取 UTC 日期。读取不到有效创建时间时停止发送。

时间点与显示时区是两回事。例如 `2026-10-20 14:00 +08:00` 与 `2026-10-20 01:00 -05:00` 是同一时刻；传入 `created` 保留的是该时刻，不能强制 Twos 的界面保留中国时区。官方接口未提供条目原始时区的专用字段，Drafts 的 `createdAt` 也不携带创建地时区标识。

用户已选择正文不添加固定时间文字，接受 Twos 原生创建时间可能随查看设备时区变化。所选时区用于确定归档日期，不改变真实创建时刻。

## 自动判断与时区选择

“新记录”按草稿创建时间距发送时刻在 0 至 30 分钟内判断（含 30 分钟）；超过 30 分钟或创建时间在未来的草稿，需要手动选择创建时区。该规则是推断：长时间写作可能被归为旧稿；旧稿刚刚被修改仍按原创建时间判断。可在脚本顶部修改 `FRESH_DRAFT_MINUTES`。

| 情况 | 行为 |
| --- | --- |
| 首次发送新记录，或上次发送设备时区与当前相同 | 使用当前设备时区，直接发送 |
| 新记录，设备时区发生变化 | 显示上次与当前时区，确认后按当前时区发送；取消则停止 |
| 旧稿或未来时间草稿 | 必须选择创建时区，默认不预选 |
| 旧稿且设备时区变化 | 在同一个选择窗口显示变化，只弹一次 |

旧稿候选顺序为 `Asia/Shanghai`（中国）、`America/Chicago`（美国中部）、当前设备时区（去重），最后为“其他时区”。选择“其他时区”时填写 IANA 名称，例如 `America/Los_Angeles`。芝加哥日期按草稿创建时刻的夏令时规则计算，不固定使用 UTC−6。没有选择、填写无效时区或取消时不会发送。

例如在美国补发中国 `2026-10-19 00:23 +08:00` 创建的草稿：选择 `Asia/Shanghai`，写入 `created: "2026-10-18T16:23:00.000Z"`，归档到 `list: "2026-10-19"`。正文不添加时间文字。之后的新记录仍使用当前美国设备时区。

## 本地状态

通过 `FileManager.createLocal()` 在 **Drafts 自身的本地文件容器**保存 `/save2twos-state.json`；不是电脑文件系统根目录，且不同设备之间不共享。状态只有一条，会在发送成功后替换：

```json
{
  "version": 1,
  "lastDeviceTimeZone": "America/Chicago",
  "lastSentAt": "2026-10-20T12:00:00.000Z"
}
```

`lastDeviceTimeZone` 是上次成功发送时的设备时区，绝不是补发旧稿时选择的创建时区；`lastSentAt` 为本次发送开始时记录的 ISO 时间。状态不存 API key、正文或逐篇发送历史，不随记录数量增长，保留到下次成功发送或手动删除为止。

取消、网络错误或非 201 响应不会更新状态。若 Twos 已创建成功、但本地保存失败，只提示“已发送，请勿重复发送”，不把整个 Action 标为失败。已有状态不可读、版本不符或时区无效时，会在发送前报错，避免静默覆盖；可用 Drafts 的 `FileManager` 脚本检查或移走该文件，恢复为首次运行状态。

如需重置状态，在 Drafts 临时创建一个独立的同步 Script Action，运行下方脚本。它只将状态文件移至带时间戳的备份，不发送内容、不删除凭据；成功后再次运行发送 Action 即可。iOS 的本地文件无法直接在 Files 中看到。

```js
const fm = FileManager.createLocal();
const file = '/save2twos-state.json';
if (fm.exists(file)) {
  const backup = '/save2twos-state.backup-' + Date.now() + '.json';
  if (!fm.moveItem(file, backup, false)) {
    context.fail('无法备份并重置时区状态');
  }
}
```

## 验证与审查

运行 `node --check save2twos.js` 检查 JavaScript 语法，运行 `node --test` 执行回归测试（需要 Node.js 18+，无第三方依赖）。测试通过 VM 执行实际脚本，仅模拟 Drafts 专有 API 和网络边界。

参见 [代码评审](docs/代码评审.md)。用户实测已确认首次运行的 API key 提示、新稿判断、旧稿时区选择、日期页面及真实创建时间正确；发送成功/取消/失败时的本地状态更新规则尚未实机验证。

51 项模拟测试覆盖新旧记录边界、首次与时区变化、取消、旧稿跨国补发、自定义时区、冬夏令时、状态读取/写入失败，以及正文保留、原生标签、来源附注、当地时间与 UTC 偏移、UUID 编码、重复发送仍新建等行为。去除自动追加的 `#drafts` 文字、附注显示及原稿链接仍待用户实测；已有 Twos 条目不会自动修改。脚本不会创建失败后自动换一种参数再次发送，避免重复条目。

官方参考：[Twos API](https://www.twosapp.com/developers)、[Twos 时区](https://twosapp.com/docs/customize/time-zones)、[Drafts 创建时间](https://scripting.getdrafts.com/classes/Draft#createdat)。
