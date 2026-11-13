# 上架目录选择已上传文件的来源合同

本记录区分官方合同、已安装 SDK 源码与 2026-10-27 只读探针，不将 Mock 或界面参考当成
Provider 的事实。实现只调用 SDK 公开面，不复制历史项目代码或引入内网请求。

## 文件来源与可用状态

官方 [Upload Files](https://docs.agent.bailian.aliyun.com/en/api/managed-agents/file/upload) 与
[Get File](https://docs.agent.bailian.aliyun.com/en/api/managed-agents/file/get) 说明：普通上传文件
为工作空间资源，不返回 `scope`；挂载到 Session 后产生带 `scope.type=session` 的内部副本。
普通上传与内部副本均可能 `downloadable=false`，因此仅判断不可下载不足以证明是普通上传。
只有 `status=available` 的文件可挂载，`checking`、`rejected`、`type_rejected` 不可选择。

Kit 对来源采用保守判断：始终排除带 `scope` 的记录；若返回显式 `origin`，只接受
`user_upload`；缺少 `origin` 时，只接受明确 `downloadable=false` 且没有 `scope` 的记录。
下载标志缺失、未知来源和 Session 输出均不进入选择列表。来源判断仅在 gateway，浏览器
不能提交来源标志让服务端信任。

已安装 `@openagentpack/sdk@0.8.0-beta-7a98e0f-59c5b175-20261022` 的公开
`listRemoteFiles` 使用 `limit/page/scope_id`，返回 `data/has_more/next_page`。
SDK 保留 `ProviderFileInfo.attributes`，但不提供 `origins` 查询参数；Kit 逐页读取、按 ID
去重后进行来源过滤。`getFileInfo` 公开入口在保存时重新核实选中项，文件名与大小采用
Provider 值。扫描状态复用公开 `@openagentpack/sdk/file-lifecycle` 的归一化，并要求明确可用。

只读探针查询第一页 100 项：90 项为 Session scope 且可下载，10 项无 scope 且不可下载；
全部状态为 available。列表与两类代表性文件的详情均无 `origin/purpose`；`type` 为 file。
探针只输出字段名和状态组合计数，没有输出凭据、文件 ID、名称、URL 或内容，也没有远端写请求。
该样本辅助核对实际字段，不独自承担来源定义。

## 挂载与成员隔离

目录 `files` 是管理员维护的服务端白名单，保存为引用与显示元数据，不保存文件内容。
创建体验 Session 时，先独立校验请求 `files` 的本人上传归属，再将目录文件放在前面合并，
按文件 ID 去重，最多 10 项。客户端不能以“目录里也有该文件”为理由直接请求其他成员文件。
目录文件不写入成员上传账本，也不因此获得直接下载或在其他目录中使用的权限。

默认路径继续采用已有 live 验证的 `/mnt/session/uploads/<安全文件名>`，见
`bailian-session-file-mount.md`。管理员可填绝对文件路径；拒绝 `..`、控制字符、重复文件和
规范化后重复路径。目录与成员附件名称冲突时，既有解析器保留目录路径，为成员附件添加后缀。
挂载仍走既有 `file_resource` REST 窄口子，不新增 Provider 直连接口，也不修改已有 Session。

`tests/sdk-files.test.ts` 用 HTTP fixture 验证完整分页、来源过滤、扫描状态与失败关闭；
`tests/catalog-files.test.ts` 验证持久化、服务端校准、清空、共享白名单与成员归属隔离。
