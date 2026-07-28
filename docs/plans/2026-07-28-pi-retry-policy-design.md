# Pi 原生重试策略设计

## 目标

修正 Pi Agent 对瞬时网络错误的自动恢复，使用户看到的状态与实际请求一致，同时限制一个用户请求在多次工具/模型回合中累计消耗的自动恢复资源。保留 Pi 的同 transcript `agent.continue()` 路径，绝不通过外层重放原始 prompt 恢复，避免重复执行已有副作用的工具。

## 方案

在 `@earendil-works/pi-coding-agent@0.82.1` 维护版本锁定 Bun patch。原有 `maxRetries` 继续表示单次连续失败段的上限；新增本次 `_runAgentPrompt()` 范围的 `maxTotalRetries` 与 `maxTotalDelayMs`。Proma 配置为：单段最多 8 次、整轮最多 8 次、累计退避等待最多 5 分钟。每次退避使用指数增长加 ±20% jitter，并在总等待预算内截断。Provider-level retry 继续保持 0，避免隐藏的嵌套请求重试。

Pi patch 保留兼容的 `auto_retry_start`，其语义明确为“已安排、正在等待”；在 sleep 完成且紧邻 `agent.continue()` 前新增 `auto_retry_attempt_start`。所有 native retry 事件带上单段与整轮的计数。`agent_end.willRetry` 与实际调度使用同一预算判断，保证耗尽预算时 Proma 不会吞掉真正的终态错误。

## 状态与展示

Proma 为 Pi retry event 绑定本轮 `startedAt`，拒绝迟到旧事件污染新流。Renderer 把已有 wire status 映射为 `scheduled`、`running`、`succeeded`、`exhausted`、`cancelled`；历史按 retry number upsert，终态不再追加重复的第 8 项。默认文案明确写“第 N/M 次继续当前回答”，在倒计时中说明尚未发起。动态数字使用 tabular numbers，成功状态在后续输出/完成事件到达后自然收起。

## 验收

1. 前 8 个总请求失败、第 9 个总请求成功时：只安排 8 次 retry，最后一次在实际请求前显示等待，成功后没有终态错误。
2. 连续失败到上限时：没有第 10 个总请求，原始错误正常显示。
3. 中间模型回合成功后：单段计数可重置，但整轮总 retry 不超过 8、累计等待不超过 5 分钟。
4. abort 在 backoff 或实际 retry 请求中发生时：不触发后续 retry，状态显示已取消而非成功。
5. 已有 partial delta 后发生断流并成功恢复时：恢复输出复用同一 assistant UUID，原地替换断流残片，不并排追加两段回答。
6. 旧 retry 终态不能清除新流的状态或错误。
