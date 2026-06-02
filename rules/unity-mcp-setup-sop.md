# SOP: Unity MCP Bridge 从零配置

**版本：** 1.0
**更新日期：** 2026-06-02
**负责人：** 开发人员
**适用对象：** 需要让 Claude Code 控制 Unity 编辑器的开发者

---

## 1. 目的

配置 Unity MCP Bridge，让 Claude Code 可以通过自然语言直接控制 Unity 编辑器（操作场景对象、组件、检查编译错误、运行测试等）。

## 2. 谁来做

Unity 开发者，熟悉 VS Code + Claude Code 环境。

## 3. 需要的工具

- VS Code（安装了 Claude Code 扩展）
- Unity 2021.3 或更新版本
- Node.js 16+
- Git

## 4. 开始前的准备

开始前确认以下条件：

- [ ] Claude Code 可以在 VS Code 中正常使用
- [ ] `node --version` 返回 v16+
- [ ] `npm --version` 返回正常版本号
- [ ] 有一个 Unity 项目可用来验证

---

## 5. 逐步操作指南

### 阶段一：全局安装 Node.js MCP Server（只需做一次）

> 这一步在你的开发机上做一次即可，以后所有 Unity 项目共用。

#### 步骤 1：克隆仓库

```cmd
cd C:\Users\LaiYangLi\.claude\mcp-servers
git clone https://github.com/aiacats/unity-mcp.git unity-mcp
```

**预期结果：** `unity-mcp` 目录出现在 `mcp-servers/` 下

#### 步骤 2：安装 Node 依赖

```cmd
cd unity-mcp/Packages/com.aiacats.unity-mcp/Server~
npm install
```

**预期结果：** 显示 `added X packages`，`node_modules` 目录创建成功

#### 步骤 3：注册到 Claude Code 全局配置

打开 `C:\Users\LaiYangLi\.claude.json`，在 `mcpServers` 中添加：

```json
"claude-code-mcp-unity": {
  "command": "node",
  "args": [
    "c:/Users/LaiYangLi/.claude/mcp-servers/unity-mcp/Packages/com.aiacats.unity-mcp/Server~/index.js"
  ],
  "env": {
    "MCP_UNITY_HTTP_URL": "http://localhost:8090"
  }
}
```

**预期结果：** `.claude.json` 的 `mcpServers` 中增加了一条 `claude-code-mcp-unity` 配置

#### 步骤 4：Reload 窗口

在 VS Code 中按 `Ctrl+Shift+P` → `Developer: Reload Window`

**预期结果：** 新 MCP 服务加载完成

---

### 阶段二：每个 Unity 项目安装 UPM 包（每个项目做一次）

#### 步骤 1：打开项目 manifest.json

进入 Unity 项目目录，打开 `Packages/manifest.json`。

#### 步骤 2：添加依赖

在 `dependencies` 中添加以下两行：

```json
"com.aiacats.unity-mcp": "https://github.com/aiacats/unity-mcp.git?path=Packages/com.aiacats.unity-mcp",
"org.khronos.unitygltf": "https://github.com/KhronosGroup/UnityGLTF.git",
```

**预期结果：** `dependencies` 中新增两个包

#### 步骤 3：启动 Unity 编辑器

双击打开 Unity 项目。Unity 会自动从 Git 下载并解析这两个包。

**首次启动可能需要等待 1-3 分钟。**

#### 步骤 4：验证 UPM 包安装成功

打开 Unity 菜单 `Window > Package Manager`，在列表中找到：
- `Claude Code MCP Unity`
- `UnityGLTF`

**预期结果：** 两个包都在已安装列表中，无红色错误标记

#### 步骤 5：关闭自动安装（推荐）

在 Unity 菜单中点击：
`Tools > Claude Code MCP > Setup: Toggle Auto Install on Editor Load`

点一次即可关闭。以后每次启动不再弹 `npm install` 错误。

> **为什么？** MCP server 已经安装在全局 `.claude` 下，Unity 不需要再装一份。这个开关只关掉 Unity 侧的自动安装，不影响功能。

---

### 阶段三：验证连接

#### 步骤 1：确认 Unity 编辑器在运行

Unity 编辑器必须打开且不在后台编译中。

#### 步骤 2：在 Claude Code 中测试

输入以下命令：

```
检查 Unity 编译状态
```

**预期结果：** 返回 `isCompiling: false`，`hasErrors: false`

也可以试：

```
查找 Assets 下的所有 C# 脚本
```

**预期结果：** 返回脚本列表

---

## 6. 验证清单

全部完成后确认：

- [ ] `claude-code-mcp-unity` 已注册到 `.claude.json`
- [ ] `npm install` 在 `Server~/` 执行成功
- [ ] Unity 项目 `manifest.json` 包含 unity-mcp 和 unitygltf
- [ ] Unity 编辑器启动后无编译错误
- [ ] `check_compilation_status` 返回成功
- [ ] `find_assets` 能搜到文件

---

## 7. 常见问题

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `npm install` 报错 exit code 1 | Unity 侧 MCPAutoBootstrap 尝试在自己的 PackageCache 路径装依赖 | 关掉自动安装：Tools > Claude Code MCP > Toggle Auto Install |
| `'ClearReference' does not exist` | unitygltf 需要 Visual Scripting >= 1.9 | 升级 Unity 到 6000.0+，或手动升级 Visual Scripting 包 |
| `UnityGLTF namespace not found` | 项目中没装 unitygltf 包 | 在 manifest.json 添加 unitygltf 依赖 |
| MCP 工具返回"连接失败" | Unity 编辑器不在运行，或 8090 端口被占用 | 确认 Unity 已打开，检查 8090 端口是否有其他程序 |
| UPM 包解析后报黄字"Failed to resolve packages" | Git URL 无法访问（网络问题） | 检查科学上网，或改用本地路径安装 |

---

## 8. 备注

**关于 Unity 版本要求：**

| Unity 版本 | Visual Scripting 版本 | unitygltf 兼容 | 说明 |
|-----------|----------------------|---------------|------|
| 2022.3 LTS | 1.8.x | ❌ 无 ClearReference | 需要锁 unitygltf 早期版本或升 Unity |
| 2023.2 | 1.8.x | ❌ 无 ClearReference | 同上 |
| 6000.0+ | 1.9.x | ✅ 完全兼容 | 推荐 |

**关于全局配置的说明：**
- `.claude.json` 是全局 MCP 配置，所有项目共用
- Unity 端 UPM 包是项目级别的，每个 Unity 项目都要装一次
- MCP server（Node.js）只需安装一次，UPM 包（C#）每个项目都要装

**关于自动安装开关：**
- 关闭后 Unity 不会自动在 PackageCache 路径下跑 npm install
- MCP 通信走全局 server → HTTP → Unity 8090 端口，不受开关影响

**关于 vs package安装：**
- 也可以打开 Package Manager → `+` → `Add package from git URL...` 手动添加两个包
- 但直接改 manifest.json 更快

---

## 9. Unity MCP 工具速查

安装完成后，以下工具可通过 Claude Code 直接调用：

| 分类 | 工具 | 作用 | 示例 |
|------|------|------|------|
| **场景** | `open_scene` | 打开场景 | "打开 MainScene" |
| | `save_scene` | 保存当前场景 | "保存场景" |
| | `add_asset_to_scene` | 添加资源到场景 | "把 Cube 预制体放到原点" |
| **对象** | `get_gameobject_info` | 查看对象详情 | "选中的对象是什么" |
| | `update_gameobject` | 修改对象属性 | "把 Main Camera 移到 (0,2,-5)" |
| | `delete_gameobject` | 删除对象 | "删除这个 Cube" |
| | `select_gameobject` | 在编辑器选中对象 | "选中 Player 对象" |
| **组件** | `get_component_properties` | 查看组件属性 | "看下这个 Rigidbody 的参数" |
| | `update_component` | 修改或添加组件 | "给 Player 加个 BoxCollider" |
| | `remove_component` | 移除组件 | "去掉这个 MeshRenderer" |
| **材质** | `create_material` | 创建材质 | "建一个红色金属材质" |
| | `get_material_properties` | 查看材质属性 | "这个材质用了什么贴图" |
| | `set_material_property` | 设置材质属性 | "把颜色改成蓝色" |
| **编译** | `check_compilation_status` | 检查编译中 | "编译完了吗" |
| | `get_compilation_errors` | 查看编译错误 | "有哪些编译错误" |
| | `force_compilation` | 强制重新编译 | "重新编译一下" |
| | `wait_for_compilation_done` | 等待编译完成 | 自动等待 |
| | `hot_reload` | 热重载脚本 | "热重载" |
| **运行** | `enter_play_mode` / `exit_play_mode` | 进入/退出播放模式 | "运行游戏" / "停止" |
| | `get_play_state` | 查看当前状态 | "是在运行中吗" |
| **测试** | `run_tests` | 运行单元测试 | "跑一下 EditMode 测试" |
| **日志** | `get_console_logs` | 获取控制台日志 | "有什么报错" |
| | `clear_console` | 清空控制台 | "清掉日志" |
| **构建** | `build_player` | 构建玩家包 | "打包 Windows 版" |
| | `wait_for_build_done` | 等待构建完成 | 自动等待 |
| **包** | `add_package` / `remove_package` | 管理 UPM 包 | "装上 TextMeshPro" |
| | `resolve_packages` | 重新解析包 | "重新解析包" |
| **菜单** | `execute_menu_item` | 执行菜单命令 | "执行 GameObject/Create Empty" |

### 快速体验

在 Claude Code 中输入以下命令验证连接：

```
检查 Unity 编译状态
```
返回 `isCompiling: false` 表示连接正常。

## 10. 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1 | 2026-06-02 | Process Owner | 新增第 9 节工具速查表 |
| 1.0 | 2026-06-02 | Process Owner | 初始版本 |
