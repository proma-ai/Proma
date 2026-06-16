## 补丁体系

> 以下补丁在 Proma 商业版 v0.12.23 的 `main.cjs` 上验证通过。

### 基础补丁（每次重建都要打）

#### 补丁 1：DeepSeek 子 Agent 使用 V4 Pro

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' main.cjs
```

#### 补丁 2：PROMA_DEV userData 隔离

```bash
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' main.cjs
```

#### 补丁 3：托盘图标白色

```bash
sed -i 's/"iconTemplate.png"/"proma-white.png"/g' main.cjs
```

### 插件系统补丁

#### 补丁 A：MCP 钩子

注入点：`sendMessage()` 方法内，`customMcpServers` 合并块之后

```bash
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' main.cjs
```

#### 补丁 B：API 桥接 + 插件加载

注入点：`init_index();` 之后

```bash
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces,getAgentSessionSDKMessages,runAgentHeadless};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' main.cjs
```

#### 补丁 B2：runAgentHeadless 桥接（v0.9.1）

```bash
sed -i 's/getAgentSessionSDKMessages};/getAgentSessionSDKMessages,runAgentHeadless};/' main.cjs
```

#### 补丁 B3：listAgentWorkspaces 桥接（v0.10）

```bash
sed -i 's/listChannels,getChannelById,getAgentWorkspace/listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces/' main.cjs
```

#### 补丁 C1-5：频道 + 模型元数据覆盖

```bash
# C1: channel lookup — 优先用元数据的 channelId
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' main.cjs

# C2: API key decrypt — 用覆盖后的 channelId
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' main.cjs

# C3: autoGenerateTitle — 用覆盖后的 channelId
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' main.cjs

# C4: modelId — 优先用元数据的 modelId
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' main.cjs

# C5: SDK query model — 用 resolvedModel 而非 modelId
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' main.cjs
```

### 渲染器补丁

#### 补丁 D：Renderer 版本同步

每次正式版升级后同步 renderer：

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/
```

#### 补丁 E：hydration 幂等守卫移除

```bash
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js
```

## 插件文件放置

将 `proma-dev-patches.cjs` 和 `proma-mcp-server.cjs` 复制到：

```
D:\Proma-dev\resources\app\dist\
```

## 启动

```bat
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
```

## 验证

启动后检查：
1. `~/.proma-dev/mcp-bridge-port.json` 已生成
2. 控制台日志 `[proma-dev-patches] ... loaded`
3. 外部 MCP 可正常调用
