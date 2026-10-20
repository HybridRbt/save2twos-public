# save2twos

将 Drafts 当前草稿发送到 Twos 的 Action 脚本。

## 使用

1. 在 Drafts 的 Action 中添加 Script 步骤，粘贴 `save2twos.js`。
2. 此脚本使用异步入口，需启用该步骤的 **Allow asynchronous execution**。
3. 在 Twos **Settings → API Keys** 创建具有 `write:things` 权限的 API key。
4. 首次运行时在新的 `Post to Twos v1` 凭据窗口填写 API key。旧 `Post to Twos` 的 `api`、`user_id`、`token` 不再使用，不会自动替换或删除旧凭据。

凭据通过 Drafts Credential 保存，不要将真实 token 或私人接口地址写入仓库。

## 当前版本

每次发送时直接读取 Drafts 原生 `draft.tags`，与固定来源标签 `drafts` 合并，通过 Twos 原生 `tags` 字段全量同步。固定 `drafts` 在首位，其余保留原顺序；去掉标签首尾空白、忽略空标签，按大小写不敏感去重。无白名单，不改 Drafts 原标签数组。正文原样发送，不自动添加或抽取 hashtag；用户自己写在正文中的 hashtag 保留。

示例：正文 `买牛奶`，Drafts 标签 `["生活", "购物"]` → Twos 正文仍为 `买牛奶`，标签为 `["drafts", "生活", "购物"]`。

使用官方 `POST https://www.twosapp.com/api/v1/things`，以 JSON 发送，API key 放在 `Authorization: Bearer` 头中，不放入正文。标签只通过官方 `tags` 字段传递。

## 已关闭的附注与原稿链接

用户实测来源附注和返回 Drafts 原稿的链接均可用，但 Twos 将附注及链接卡片展开，造成显示臃肿。结合 Drafts 主要作为快速发送器的用途，已关闭这两项功能：请求不再包含 `note` 或 `url`，不再依赖草稿 UUID。来源通过原生 `drafts` 标签表达，原始创建时间仍写入 API 字段。

决定与原因见 [设计决策](docs/设计决策.md)。重复发送仍创建新条目，不保存 UUID 到 Twos ID 的映射，不更新、不去重、不修改已有 Twos 条目。

取消凭据授权、API key 为空或正文为空白时停止发送；API key 使用密码输入框。HTTP 失败会提示状态码，网络异常给出固定提示，不记录完整响应或凭据，不自动重试创建请求。创建成功要求 HTTP 201。

## 创建时间与日期页面

读取 Drafts 的 `draft.createdAt`，将 ISO 8601 时间写入官方 `created` 字段，并通过 `list: "YYYY-MM-DD"` 放入相应日期的页面。日期以本次确定的创建时区解释该创建时刻，不使用发送当天，也不直接截取 UTC 日期。读取不到有效创建时间时停止发送。

时间点与显示时区是两回事。例如 `2026-10-20 14:00 +08:00` 与 `2026-10-20 01:00 -05:00` 是同一时刻；传入 `created` 保留的是该时刻，不能强制 Twos 的界面保留中国时区。官方接口未提供条目原始时区的专用字段，Drafts 的 `createdAt` 也不携带创建地时区标识。

用户已选择正文不添加固定时间文字，接受 Twos 原生创建时间可能随查看设备时区变化。所选时区用于确定归档日期，不改变真实创建时刻。

## 自动判断与时区选择

“新记录”按草稿创建时间距发送时刻在 0 至 30 分钟内判断（含 30 分钟）；超过 30 分钟或创建时间在未来的草稿，默认需要选择创建时区，也可以在选择后暂时关闭后续询问。该规则是推断：长时间写作可能被归为旧稿；旧稿刚刚被修改仍按原创建时间判断。可在脚本顶部修改 `FRESH_DRAFT_MINUTES`。

| 情况 | 行为 |
| --- | --- |
| 首次发送新记录，或上次发送设备时区与当前相同 | 使用当前设备时区，直接发送 |
| 新记录，设备时区发生变化 | 显示上次与当前时区，确认后按当前时区发送；取消则停止 |
| 旧稿，无有效提醒偏好 | 选择创建时区，默认不预选 |
| 旧稿，提醒偏好有效且设备时区未变化 | 直接沿用该偏好保存的创建时区 |
| 旧稿且设备时区变化 | 在同一个选择窗口显示变化，只弹一次 |

旧稿候选顺序为 `Asia/Shanghai`（中国）、`America/Chicago`（美国中部）、当前设备时区（去重），最后为“其他时区”。选择“其他时区”时填写 IANA 名称，例如 `America/Los_Angeles`。芝加哥日期按草稿创建时刻的夏令时规则计算，不固定使用 UTC−6。没有选择、填写无效时区或取消时不会发送。

选好创建时区后，有三个发送按钮：

- **按所选时区发送**：只处理当前记录，下次旧稿仍询问。
- **今天不再询问（午夜恢复）**：后续旧稿沿用本次创建时区，到发送设备时区的下一个当地午夜恢复询问，按实际日期边界处理夏令时。
- **7 天内不再询问**：从选择时刻持续 168 小时；中间再次发送不会延长到期时间。

设备时区变化会使旧偏好失效并重新确认。新记录始终按当前设备时区处理；它不会使用旧稿偏好中的创建时区。批量补发中若包含不同创建时区的记录，应选择单次发送；已设置暂停时，可以使用下面的本地状态重置方法提前恢复询问。

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

选择暂时关闭旧稿询问时，同一文件增加可选的 `oldDraftReminder` 对象：

```json
{
  "creationZone": "Asia/Shanghai",
  "deviceZone": "America/Chicago",
  "selectedAt": "2026-10-20T12:00:00.000Z",
  "expiresAt": "2026-10-27T12:00:00.000Z"
}
```

`creationZone` 是后续旧稿沿用的时区，`deviceZone` 是选择偏好时的设备时区；两者用途不同。偏好只在发送成功后保存，取消或失败不会保存新选择。到期、设备时区变化、选择时间在未来或可选偏好数据无效时恢复询问，并在下次发送成功时清除无效偏好。旧版只有三个基础字段的状态文件无需迁移。

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

用户已确认简洁显示及全量原生标签符合预期，Milestone 1 已验收。当前 69 项模拟测试进一步覆盖提醒暂停、到期边界、夏令时 23/25 小时日、固定 168 小时、设备时区变化和旧状态兼容；新增按钮及偏好保存尚待实机验证。已有 Twos 条目不自动修改。创建失败后不会自动换参数重发，避免重复条目。

官方参考：[Twos API](https://www.twosapp.com/developers)、[Twos 时区](https://twosapp.com/docs/customize/time-zones)、[Drafts 创建时间](https://scripting.getdrafts.com/classes/Draft#createdat)。
