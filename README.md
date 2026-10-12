# Bilibili DLC Getter

纯前端的 Bilibili「数字周边」与「个性装扮」图片抓取、浏览与加工工具。

## 这是什么？

- **定位**：单页 Web 应用，无后端、无数据库、无登录。粘贴一个 B 站链接，把该活动 / 装扮下的全部图片素材抓出来，分区陈列，按需下载或二次加工。
- **解决的核心问题**：B 站的数字周边（DLC 活动）与个性装扮素材只能通过活动页逐张右键另存，且两类关键素材**拿到手也没法直接用**：
  - **表情包**是一张 5×5 / 4×5 的拼图大图（静态 PNG 或动画 GIF / WebP），微信、QQ 等平台需要的是切好的单张；
  - **头像挂件**是一张中心镂空的环形装饰图，需要把自己的头像圆形裁剪后嵌进去才成一张可用头像。

  本工具把这两步加工也一并做掉了。

## 为什么存在？

- 手动另存一个活动包的几十张图，再手动切割表情拼图，是纯粹的重复劳动；
- 动画表情包的切割尤其麻烦——需要逐帧解码、逐格重编码，且要保证动格仍为动图、静格退化为静态图；
- 表情拼图的网格参数（行列数、外边距、间距）每张图都不一样，肉眼数格子容易错；本工具用像素级分析推断初始值，再让人在预览里微调。

## 如何安装和运行？

### 前置要求

- Node.js ≥ 20（CI 使用 22）
- pnpm（仓库含 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`）
- 运行 e2e 时需要本机安装 Microsoft Edge（Playwright 走 `channel: 'msedge'`，不下载浏览器）

### 安装步骤

```bash
pnpm install --frozen-lockfile
```

> 国内网络若拉取缓慢，可先配置镜像：`pnpm config set registry https://registry.npmmirror.com`

### 运行 / 启动

```bash
pnpm dev        # 开发服务器，http://localhost:5173（自动打开浏览器）
pnpm build      # tsc 类型检查 + vite 构建，产物在 dist/
pnpm preview    # 预览构建产物，http://localhost:4173
pnpm test:e2e   # Playwright e2e（自动拉起 vite preview）
```

线上地址：GitHub Pages 项目站点，构建 `base` 固定为 `/bilibili-dlc-getter/`。推送到 `main` 分支即由 `.github/workflows/deploy.yml` 自动构建部署。

### 使用方式

1. 粘贴链接，点「解析」（或回车）：
   - 数字周边活动页：`...activity-xxx.html?type=dlc&id=104978&lottery_id=105056`
   - 个性装扮详情页：`https://www.bilibili.com/h5/mall/suit/detail?id=67790`
2. 图片按分区陈列（卡片 / 收集品；或装扮的九个分类），可右键原生菜单另存，或用分区右上角「打包下载」拉 ZIP。每张卡片展示原始像素尺寸（W×H）。
3. 特殊素材卡右下角有额外按钮：
   - ✂️ **切割表情包** → 打开参数预览 dialog，微调 8 个网格参数后确认，下载切好的 ZIP。
   - **嵌入头像** → 选本地头像 → 打开合成预览 dialog，微调头像半径后确认，下载合成 PNG。
4. 抓取成功后地址栏自动更新为 RESTful 路径（`/dlc/<id>/<lottery_id>` 或 `/garb/<itemId>`），可直接复制分享；对方打开后页面自动发起抓取，浏览器标签页标题同步为活动 / 装扮名。

## 当前状态

- **阶段**：稳定（v1.0.0），核心链路已由 16 个 e2e 用例覆盖真实活动数据。
- **已知限制**：
  - **依赖第三方 CORS 代理**：B 站 API 请求经 `https://p.xrl.im/?url=...` 转发（浏览器直接跨域请求 B 站 API 会被 CORS 拦截）。该代理不可用时，解析功能整体失效，属单点故障。
  - **依赖 B 站 CDN 的 CORS 放行**：图片下载与切割直接 `fetch` CDN 原图，靠 CDN 返回 `Access-Control-Allow-Origin: *` + 文档级 `no-referrer` 绕过防盗链。CDN 策略收紧即失效。
  - **e2e fixture 会腐烂**：测试用例直接打真实 B 站活动链接，活动下线或素材变更会导致用例失败。
  - **网格推断是启发式的**：只做「接近」，精确对齐依赖用户在 dialog 里微调。已覆盖常规网格、贴纸紧贴、跨格宽构图、动画道具越界、满幅零间隙五类排版，仍可能有新排版推断失准。
  - **动图切割需要 WebCodecs**：`ImageDecoder` 不可用的环境（旧版 Safari 等）会退回只解首帧，动画包退化为静态单帧切割，不会报错但产物丢失动画。
  - **抓不到登录态内容**：不携带 Cookie，仅能取公开 API 返回的素材。

## 核心技术

| 类别 | 选型 |
|------|------|
| 语言 / 框架 | TypeScript 5.8 + React 18 |
| 构建 | Vite 8 |
| UI | `@m3e/react` / `@m3e/web`（Material Design 3 Expressive，Lit Web Components + `@lit/react` 绑定） |
| 图像处理 | 原生 Canvas 2D + WebCodecs `ImageDecoder`（动图解帧）、`gifenc`（GIF 重编码） |
| 打包下载 | `jszip` + `file-saver` |
| 测试 | Playwright（`msedge` channel），16 个 e2e 用例 |
| 部署 | GitHub Actions → GitHub Pages |

完整职责划分与数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；产品目标与范围见 [docs/PRD.md](docs/PRD.md)。
