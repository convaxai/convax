# Convax

[English](README.md) · **简体中文**

Convax 是一个桌面端可视化工作空间，用来把项目文件、创意和 AI 协作过程组织成彼此关联、可以持续编辑的画布。它把本地文件、多画布、Agent 和可安装的创作工具放进同一个工作空间中。

## 主要能力

### 围绕真实项目工作

- 新建一个干净的 Project，或者直接打开已有的本地文件夹。
- 在目录树中浏览文件和文件夹，并通过悬停快速预览支持的文件。
- 在 Convax 中新建、导入、重命名、移动和删除项目文件，也可以通过系统应用打开文件或在文件管理器中定位。
- 在项目目录树内移动文件与文件夹，或将它们从目录树拖到 Canvas 和 Agent 上下文中。

### 在一个项目中使用多画布

- 每个 Project 可以拥有多个彼此独立的 Canvas。
- 切换 Project 时，文件和对应的画布集合会一起切换。
- 在无限画布上组织文本、图片、音频、视频、文件、文件夹和 Agent 节点。
- 连接、移动、缩放、复制或删除节点，并按需平移、缩放、定位或适配画布视图。
- 重新打开 Project 后，可以继续编辑已经持久化的画布内容。

### 与理解项目上下文的 Agent 协作

- 把项目文件、文件夹、Canvas 和 Skill 直接附加到对话中。
- 让 Agent 查看画布内容、添加资源、调整关联关系，或者选中并定位相关节点。
- Agent 与可视化界面复用同一套 Canvas 操作，确保自动化行为和产品交互保持一致。

内置 Coding Agent 基于 OpenCode。

### 通过 Skill 和 Plugin 扩展能力

- 在全局能力中心发现并管理可复用的 Agent Skill。
- 通过 Plugin 增加自定义画布卡片、工具栏操作和交互式创作界面。
- 经过授权的 Plugin 可以在明确范围内调用当前 Project、Canvas 或 Agent 的能力。
- Plugin 节点的可移植状态会跟随 Canvas 保存，复制节点或重新打开 Project 后仍可继续使用。

当前内置示例包括：

- **3D Director Desk**：在交互式 3D 场景中布置角色、道具和相机，场景状态会跟随 Canvas 节点保存。
- **Panorama Viewer**：查看本地或与节点连接的全景图片，支持拖拽环视、缩放、自动旋转和全屏浏览。

### 根据任务调整工作区

- 调整或收起 Project 与 Agent 侧边栏，同时为 Canvas 保留可见区域。
- 拖动调整项目侧边栏中 Files 与 Canvases 两个区域的大小。
- 在全局设置中管理语言、Skill 和 Plugin。

## 从源码运行

Convax 使用 Bun 管理工作区脚本。

```bash
bun install
bun dev
```

运行完整检查：

```bash
bun check
```

编译工作区、构建当前平台的原生安装介质，或从最终打包可执行文件（而不是
Electron SDK）启动自动化 smoke：

```bash
bun run build
bun run package
bun run smoke:packaged
```

`build` 只编译代码。`package` 在 `packages/desktop/dist/` 生成当前平台的
DMG/ZIP、NSIS 或 Linux 安装介质。打包时会从固定的官方 Registry 下载当前
`ffmpeg-tools` Plugin ZIP 和与宿主平台精确匹配的 companion，校验声明大小、
SHA-256、目标平台和安全 ZIP 内容后，以“远程来源的首次安装 seed”随包内置；
目标缺失或校验失败会直接让打包失败。`smoke:packaged` 为了缩短 CI 时间只生成
解包后的应用，并临时开启一个仅回环地址可用的 DevTools Protocol 端口执行断言；
该调试端口不会写入或改变产物。smoke 使用全新用户目录，并在 Registry 网络不可用时
验证 FFmpeg 能从内置 seed 完成安装；macOS smoke 使用 Electron 的测试钥匙串，
不会读取或修改开发机的登录钥匙串。结束后会打印保留的应用包和可执行文件绝对路径。

本地和 PR 产物默认不签名。`CONVAX_CHANNEL` 可选择相互隔离的 `dev`、`beta`
或 `prod` 身份。面向普通用户的正式版本应在各目标平台注入签名凭据并打开
release gate：

```bash
CONVAX_CHANNEL=prod CONVAX_RELEASE=true bun run package
```

release gate 会在平台支持时强制代码签名，并在 macOS 启用公证；源码开发和
packaged smoke 不需要签名证书。

### 编译期功能开关

“服务”和“技能与插件”设置默认都会展示。产品构建可以通过以下编译期环境变量独立隐藏任一设置；关闭后，
全局设置页和左下角应用菜单中的对应入口会同时隐藏：

- `CONVAX_FEATURE_SERVICES`
- `CONVAX_FEATURE_SKILLS_AND_PLUGINS`

例如，在 Desktop 构建中同时隐藏两项设置：

```bash
CONVAX_FEATURE_SERVICES=0 CONVAX_FEATURE_SKILLS_AND_PLUGINS=0 bun --cwd packages/desktop build
```

开关只接受 `true`、`false`、`1` 和 `0`，拼写错误会直接让编译失败。

## 项目文档

- [架构说明](docs/architecture.md)
- [Plugin 与 Skill 平台](docs/plugin-skill-platform.md)
- [Canvas 选择与操作](docs/canvas-selection-context.md)
