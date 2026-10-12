# AGENTS.md

Bilibili DLC Getter —— 纯前端 React 单页应用，抓取 B 站数字周边 / 个性装扮图片素材，并提供表情包网格切割与头像挂件合成两项图像加工能力。

## 概述

- **本项目是什么**：一个部署在 GitHub Pages 上的静态单页应用。无后端、无数据库、无状态持久化、无构建期数据。
- **运行形态**：浏览器里完成全部工作 —— 通过第三方 CORS 代理请求 B 站公开 API 拿到图片 URL 列表，图片本身由浏览器直接 `fetch` B 站 CDN，加工在 Canvas 上进行，产物经 `file-saver` 落到用户本地。
- **代码规模**：约 2800 行 TypeScript（含 e2e），单页面、单状态机、无路由（地址栏用 RESTful 路径做分享直达，但不使用前端路由库）。

## 边界与范围

### 范围内

- 解析两类 B 站链接：DLC 数字周边活动页（含 `lottery_id`）、个性装扮详情页（无 `lottery_id`，`id` 即 `item_id`）。
- 按分区陈列抓到的全部图片素材，支持右键另存与整区 ZIP 打包下载。
- **表情包网格切割**：从像素推断均匀网格参数（行/列数、四边外边距、行/列间距），用户在预览 dialog 中微调后，切出统一尺寸的 1:1 方片；动图逐格重编码为动画 GIF，静格退化为 PNG。
- **头像挂件合成**：推断模板镂空圆孔半径，把用户本地图 cover 缩放 + 圆形裁剪后叠加模板，输出 PNG。
- Material Design 3 主题（浅色 / 深色 / 跟随系统）与移动端响应式布局。

### 非目标（明确排除）

- **不做后端 / 代理服务**：CORS 代理是外部既有服务（`https://p.xrl.im`），本项目不实现、不托管、不改造它。
- **不做账号体系与鉴权**：不携带 Cookie，不请求任何需要登录态的接口，只吃公开 API 返回的数据。
- **不做通用图像编辑器**：切割与合成都是**参数化、单一用途**的工具，不提供自由裁剪、图层、滤镜等能力。
- **不做数据持久化**：不写 localStorage、不存历史记录、不缓存抓取结果（浏览器 HTTP 缓存除外）。
- **不引入状态管理库**：全局只有一个 `useDlcData` hook 持有的 `FetchState`，不需要 Redux / Zustand 之类。
- **不 mock B 站 API**：e2e 一律打真实接口、真实活动链接。这是刻意的取舍（见 docs/DECISIONS.md）。

## Agent 操作指南

### 如何理解本项目

按这个顺序读，能在最短时间内建立正确心智模型：

1. `docs/PRD.md` —— 要解决什么问题、功能边界在哪。
2. `src/types/index.ts` —— 66 行，全部领域类型都在这里，是整个项目的词汇表。
3. `src/hooks/useDlcData.ts` + `src/App.tsx` —— 唯一的业务状态机（`idle | loading | success | error`）与页面装配。
4. `src/lib/parseUrl.ts` → `src/lib/fetchDlcData.ts` / `src/lib/fetchGarbSuit.ts` —— 数据获取链路。
5. `src/lib/gridAnalysis.ts` + `src/lib/imageProcessing.ts` —— 两个核心算法模块，**项目 80% 的复杂度集中在这 1080 行里**，动手前务必先读 `docs/specs/module-emoji-crop.md`。

### 全局规则 / 约定

- **`lib/` 是纯逻辑层，`components/` 是表现层，两者单向依赖**。`gridAnalysis.ts` 刻意做成零 DOM 依赖的纯计算模块（可在 Node 中直接跑），不要往里塞 `document` / `canvas`。需要画布的逻辑放 `imageProcessing.ts`。
- **几何只有一个真相来源**：`gridCellRects(params, W, H)`。预览绘制与实际切割必须共用它，绝不允许两处各算一套格子。改动网格语义时先改它。
- **推断只求「接近」，精确对齐交给人**。`inferGridParams` 的输出只是 dialog 的初始值，用户在 `ParamStepper` 里微调后即完全接管。不要试图把推断做到 100% 自动 —— 那会引入大量脆弱启发式。
- **如实回报，不粉饰**。裁切窗算出来 `w ≠ h` 就取消「（1:1）」标注，不强制补方；推断不出格线就退回兜底层，不硬编一个行列数。这条原则贯穿全部算法代码与 UI 文案。
- **UI 组件一律用 `@m3e/react`**，不引入第二套 UI 库。设计令牌只用 `--md-sys-color-*` / `--md-sys-shape-*` 读取（`--m3e-*` 仅供组件 cssprop，写进 CSS 不会生效）。
- **文案口癖**：面向用户的提示文案统一带「喵」后缀（见 `useDlcData.ts` 的 `EMPTY_MESSAGES`、各 dialog 的 `onResult`），保持与现有语气一致。
- **改任何图像算法，必须跑 e2e 并核对产物**。`e2e-artifacts/` 下会落出全部切片，用眼睛核验比断言更可靠。诊断网格推断可跑 `node scripts/diagnose-crop.mjs`（需先 `pnpm preview`），它会逐活动打印推断出的 8 个参数与画布尺寸。
- **e2e 用 `msedge` channel**，不下载 Chromium。`fullyParallel: false`，单测超时 120s（真实网络请求 + 大图解码，不要调小）。
- **提交规范**：Conventional Commits，type / scope 用英文，描述用简体中文；subject ≤ 72 字符只概括改动类型，具体改动在 body 中逐条分点说明，subject 与 body 之间空一行。参照 `git log` 里已有的三次提交。
- **不要提交 `dist/`、`e2e-artifacts/`、`test-results/`、`node_modules/`**（已在 `.gitignore` 中，且当前均未被 git 跟踪）。`dist/` 只由 CI 在部署时构建，本地构建产物不入库。

## 目录速查

| 路径 | 职责 |
|------|------|
| `src/main.tsx` | React 入口，`StrictMode` 挂载 `App` |
| `src/App.tsx` | 页面装配：按 `FetchState.status` 四态切换渲染 |
| `src/index.css` | 全局样式：画廊网格、切割 dialog 布局、滚动条、入场动画、关闭态 dialog 移出布局 |
| `src/types/index.ts` | 全部领域类型：`GalleryImage` / `GallerySection` / `ParsedUrl` / 两个 API 响应结构 / `FetchState` |
| `src/hooks/useDlcData.ts` | 唯一业务状态机；按 `ParsedUrl.kind` 分派抓取器，持有 `lastParams` 支持重试；RESTful 路径回写与入口自启动 |
| `src/lib/parseUrl.ts` | 链接解析与类型判定（有 `lottery_id` → dlc，否则 → garb）；双向 RESTful 路径 ↔ 标准化参数转换 |
| `src/lib/fetchDlcData.ts` | DLC 数字周边 API 抓取；按收集品 `type_name` 嗅探 `service`（emoji / pendant） |
| `src/lib/fetchGarbSuit.ts` | 个性装扮 API 抓取；九分类排序、`properties` 图片字段白名单展开、递归子表情；`pendant` 分类 `properties.image` 标记 `service: 'pendant'` |
| `src/lib/gridAnalysis.ts` | **纯计算**：网格参数推断（内容带 / 间隙中点 lattice / 接缝剖面兜底）与格子几何 |
| `src/lib/imageProcessing.ts` | **依赖 DOM**：图片抓取解码、动图逐帧、切割重编码、头像合成、ZIP 打包下载 |
| `src/lib/downloadUtils.ts` | 分区批量 ZIP 下载（原图直存，不加工） |
| `src/lib/canvasUtils.ts` | 预览画布公共件：主题令牌取值、透明底棋盘格 |
| `src/lib/m3eSnackbar.ts` | 用 `@lit/react` 补齐 m3e snackbar 的 React 绑定（上游未提供） |
| `src/components/layout/AppShell.tsx` | MD3 主题壳、AppBar、主题切换（跟随系统 / 固定浅深）、GitHub 入口 |
| `src/components/ui/UrlInput.tsx` | 链接输入与解析按钮；无默认 placeholder；输入非空时右侧出现一键清除按钮（回焦输入框）；回车提交 |
| `src/components/ui/ImageGallery.tsx` | 通用分区渲染：标题 + 数量 + 批量下载 + 卡片网格 |
| `src/components/ui/ImageCard.tsx` | 单张图卡片；展示图片原始像素尺寸（W×H）；按 `service` 决定是否挂载切割 / 合成入口；dialog 首开后保持挂载以保留微调 |
| `src/components/ui/EmojiCropDialog.tsx` | 表情切割 dialog：预览（红蒙层 + 白描边）+ 8 参数微调 |
| `src/components/ui/AvatarEmbedDialog.tsx` | 头像合成 dialog：所见即所得预览 + 半径微调 |
| `src/components/ui/ParamStepper.tsx` | `[−] 值 [+]` 步进器，两个 dialog 共用；不做范围钳制，语义交给调用方 |
| `src/components/ui/BatchDownloadButton.tsx` | 分区批量下载按钮 + 进度 + snackbar |
| `src/components/ui/{EmptyState,ErrorState,LoadingSkeleton}.tsx` | 空态 / 错误态（带重试）/ 加载骨架 |
| `e2e/gallery.spec.ts` | 全部 16 个 e2e 用例（真实活动链接 + 产物字节级断言） |
| `scripts/diagnose-crop.mjs` | 网格推断诊断脚本：逐活动导出推断参数与画布尺寸 |
| `docs/` | PRD / ARCHITECTURE / DECISIONS / specs |
| `.github/workflows/deploy.yml` | push main → pnpm build → GitHub Pages |
