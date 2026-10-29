# 取件箱 · Delivery Box

> **给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的「取件箱」。**
> AI 每次交付的文件统一落进一个文件夹；左侧栏加一个面板，先看分类（项目）→ 点开才看这个分类下
> **每个对话产出的文件**；支持图片/视频/PDF/文本预览，一键把图片或文件**复制到剪贴板**（微信里 `Ctrl+V` 直接发）。
> 主要面向 Windows 桌面版；面板/分类/预览在任意 dsh Web 上都能用。

独立社区插件，不是 DeepSeek 官方产品。实测环境：**DSH 0.2.1-rc.3 + Windows 11**。

![分类首页](docs/assets/panel-categories.png)

![点开分类：文件按产出它的对话分组](docs/assets/panel-files-by-conversation.png)

![面板内直接预览视频，进度条可拖](docs/assets/panel-video-preview.png)

## 它解决什么

AI 出一张图、一份文档、一段视频，文件总散落在项目目录里，得自己去翻；就算对话界面很漂亮，
「文件在哪」和「怎么发到微信」还是手工活。

取件箱给「交付」一个固定目的地，再配一个界面：

- **一个取件文件夹**：AI（或你）把成品丢进去就行。
- **两级浏览，跟项目列表同款**：一级 = 分类（项目：色点、名字、件数、几个对话、最新时间、缩略图）；
  二级 = 这个分类的文件，**再按产出它的对话分组**，哪个对话产了什么一目了然。
- **不用打开文件就能看**：图片、视频（可拖进度条）、音频、PDF、纯文本。
- **复制到剪贴板**：图片进图像剪贴板，其它进文件剪贴板 —— 到微信里一个 `Ctrl+V` 就发出去。
- **在文件夹中显示 / 打开 / 删到回收站**（绝不硬删）。
- **自动刷新**：面板每 5 秒扫一次文件夹，别的会话/你丢进去的文件会自己出现。

## 安装

### A. 从插件仓库安装（推荐，需要 dsh 0.2+）

```sh
dsh plugin --profile desktop add dsh-delivery-box
```

还没上 npm 之前，可以直接从 GitHub 装：

```sh
dsh plugin --profile desktop add git+https://github.com/11zz-prog/dsh-delivery-box.git
```

然后重启 DSH，左侧栏出现 **取件箱 / Delivery Box**。

### B. Windows 一键安装（不用命令行）

下载 Release 里的 ZIP，解压到任意位置，双击 **`install.cmd`**，然后**完全重启 DSH**。
安装器会自动找 DSH_HOME 和 profile、备份 manifest/lockfile、建立链接，并写 `inbox.config.json`
（默认取件箱 `%USERPROFILE%\取件箱`）；卸载双击 `uninstall.cmd`。
如果是 clone 仓库而不是用 Release 包，运行 `installer\install.cmd` 即可（识别仓库布局，直接链接当前目录）。

> 不需要管理员权限，也不需要单独装 Node：安装器会用 DSH 自带的 Node。

## 配置

取件箱目录按优先级取：

1. 环境变量 `DSH_INBOX_DIR`
2. 插件旁边的 `inbox.config.json`：`{ "inboxDir": "D:\\取件箱" }`
3. `%USERPROFILE%\取件箱`

改完重启 DSH 生效。

## 让 AI 自动投递

在你的工作区 `AGENTS.md` 里加一段，让每个会话把成品丢进取件箱：

```md
## 取件箱：每次交付都要放进去

产出成品（图片/视频/文档/报告/音频/压缩包）后，跑：

& "<插件目录>\tools\投递.cmd" add <文件> --origin "<本会话或项目>" --clip --json

- --origin：产出它的对话/项目名（面板按它分组，别省）
- --clip：顺手放剪贴板（图片→图像，其它→文件）
- --link：大视频用硬链接，不重复占空间
```

`tools\投递.cmd` 是安装器生成的（内嵌本机 Node 路径）。没跑安装器的话，用
`node <插件目录>\tools\inbox.mjs …`。模板见 [docs/AGENTS-snippet.md](docs/AGENTS-snippet.md)。

## 命令行（`tools/inbox.mjs`）

```text
inbox.mjs add <文件> [--name "新名字"] [--clip] [--reveal] [--link] [--origin "对话"] [--project "项目"] [--json]
inbox.mjs list [--json]
inbox.mjs copy [名字|latest] [--mode auto|image|file] [--json]
inbox.mjs reveal [名字|latest]
inbox.mjs tag [名字|latest] --origin "对话" [--project "项目"] [--json]
inbox.mjs open
```

命令与上面的英文 README 一致；`add` 会复制（重名自动 `-2`）、记录来源、可选复制到剪贴板；
`--link` 同盘硬链接（大视频不占额外空间）；失败返回非 0 退出码和明确原因。

## 实现

- **Host 半边**（`index.js`）：在 DSH 本机 Web 服务上注册 7 条 loopback 路由
  （list / file（单段 Range，视频可拖动）/ copy / reveal / open / delete / open-folder），只用 Node 内置模块。
- **Client 半边**（`client.js`）：免构建的手写 bundle，通过 slot 注册侧栏入口和主面板，React 从页面模块表取。
- **数据就是一个文件夹**：成品平铺，另有隐藏的 `.origins.json`（谁产出的）和可选的 `inbox.config.json`。
- 剪贴板走 Windows PowerShell（`-STA` + `-EncodedCommand`）：图片进图像剪贴板，其它进文件拖放列表。

## 兼容性 / 安全 / 卸载

- DSH 0.2.x（实测 0.2.1-rc.3）；Windows 10/11 才支持剪贴板、资源管理器定位和回收站，面板/分类/预览是普通 Web UI。
- 路由只在**本机 loopback** 的 DSH Web 服务上，**没有鉴权**：别把 DSH 的 Web 端口（或隧道）暴露到公网。
- 插件只读写取件箱目录、剪贴板、资源管理器选中；删除是删到回收站；不联网、不上传。
- 卸载：`dsh plugin --profile desktop remove dsh-delivery-box`，或桌面安装版双击 `uninstall.cmd`
  （只回滚配置、删链接，插件目录和取件箱里的文件都保留）。

## 开发

```sh
git clone https://github.com/11zz-prog/dsh-delivery-box.git
cd dsh-delivery-box
npm run check     # 语法 + manifest + 打包完整性，零依赖
```

## 许可

MIT，见 [LICENSE](LICENSE)。
