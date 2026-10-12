# ARCHITECTURE — Bilibili DLC Getter

## 系统概述

纯前端单页应用，**无自有服务端**。所有跨域能力来自两个外部前提：第三方 CORS 代理（`https://p.xrl.im`）转发 B 站 API，以及 B 站 CDN 自身返回 `Access-Control-Allow-Origin: *`（配合文档级 `no-referrer` 绕过防盗链）。

### 分层结构

```
┌──────────────────────────────────────────────────────────────────────┐
│  index.html   <meta name="referrer" content="no-referrer">            │
│               Material Symbols 字体 · #root · 全局 reset              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  入口层        src/main.tsx  →  src/App.tsx                           │
│                StrictMode 挂载；按 FetchState.status 四态装配          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  壳层          components/layout/AppShell.tsx                         │
│                M3eTheme(色 #9c4146, scheme auto/light/dark)           │
│                AppBar · 主题切换 · GitHub 入口 · <main> 容器           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  状态层        hooks/useDlcData.ts   ← 全项目唯一业务状态机            │
│                FetchState = idle | loading | success | error          │
│                submit(url) / retry() / lastParams(ref)                │
└──────────┬────────────────────────────────────────────┬──────────────┘
           │ parseUrl                                    │ fetch
┌──────────▼──────────────────┐          ┌──────────────▼──────────────┐
│  数据获取层  lib/            │          │  表现层  components/ui/      │
│  parseUrl.ts   链接→ParsedUrl│          │  UrlInput                   │
│  fetchDlcData  → Section[]   │          │  ImageGallery               │
│  fetchGarbSuit → Section[]   │          │  ImageCard ─┬─ EmojiCropDialog
│         ↓ 统一 GallerySection│          │             └─ AvatarEmbedDialog
│                              │          │  BatchDownloadButton        │
│                              │          │  Empty/Error/LoadingSkeleton│
│                              │          │  ParamStepper（公共件）      │
└──────────────────────────────┘          └──────────────┬──────────────┘
                                                         │ 图像加工
                                          ┌──────────────▼──────────────┐
                                          │  算法层  lib/                │
                                          │  gridAnalysis.ts  纯计算     │
                                          │    ↑ 无 DOM，可在 Node 跑    │
                                          │  imageProcessing.ts  依赖DOM │
                                          │    canvas / ImageDecoder     │
                                          │  downloadUtils.ts  ZIP       │
                                          │  canvasUtils.ts    公共件    │
                                          └─────────────────────────────┘
                                                         │
                                          ┌──────────────▼──────────────┐
                                          │  产物   jszip + file-saver   │
                                          │         → 用户本地磁盘        │
                                          └─────────────────────────────┘
```

### 依赖方向（单向，不可逆）

```
components/ui  ──►  hooks  ──►  lib/{parseUrl, fetch*}
      │
      └──────────────────────►  lib/{gridAnalysis, imageProcessing, downloadUtils, canvasUtils}
                                         │
                            imageProcessing ──► gridAnalysis      ✅
                            gridAnalysis    ──► imageProcessing   ❌ 禁止
```

`gridAnalysis.ts` 是**叶子模块**：只导出纯函数与类型，不 import 任何依赖 DOM 的东西。这是刻意维持的边界（见 DECISIONS ADR-004），保证网格算法可以在 Node 里直接跑单测、可以在 `scripts/diagnose-crop.mjs` 里离线诊断。

## 核心模块

| 模块 | 职责 |
|------|------|
| `src/App.tsx` | 页面装配。读 `useDlcData()` 的 `state.status`，在 `idle` / `loading` / `error` / `success` 四态间切换渲染；`success` 态将 `state.title` 同步到 `document.title`，并汇总各分区图片总数。**不含任何业务逻辑。** |
| `src/hooks/useDlcData.ts` | 唯一业务状态机。`submit(url)` → `parseUrl` → `history.pushState` 写入 RESTful 路径 → 按 `kind` 分派抓取器 → 落 `FetchState`（含 `title`）；`lastParams` 用 `useRef` 存上次解析结果供 `retry()` 复用；页面入口 `useEffect` 从地址栏反向提取标准化参数自动发起抓取；抓取器返回空数组时转成 error 态并给出**按 kind 区分**的业务文案。 |
| `src/types/index.ts` | 领域词汇表（66 行，全项目类型单一来源）：`GalleryImage`（`fit: cover\|contain`、可选 `service: emoji\|pendant`）、`GallerySection`、可辨识联合 `ParsedUrl`、两个 API 响应结构、`FetchState`。 |
| `src/lib/parseUrl.ts` | 链接 → `ParsedUrl`。取 `id`（回退 `act_id`）；有 `lottery_id` 判为 `dlc`，否则判为 `garb`（`id` 即 `item_id`）。任何解析失败返回 `null`，由上层转错误文案。另外导出 `paramsToPath`（标准化参数 → RESTful 路径，含 Vite base 前缀）与 `paramsFromPathname`（当前页面 pathname → 标准化参数），实现地址栏与内部状态的**双向转换**。
| `src/lib/fetchDlcData.ts` | DLC 数字周边。代理请求 `x/vas/dlc_act/lottery/home_detail/v2`，返回 `{ title, sections }`；`card_list` → 「卡片」区（`fit: cover`）、`collect_list` → 「收集品」区（`fit: contain`）；`collectService()` 按 `redeem_item_type_name` 嗅探特殊服务（含「表情」→ emoji，含「头像框」/「头像挂件」→ pendant）。 |
| `src/lib/fetchGarbSuit.ts` | 个性装扮。代理请求 `x/garb/v2/mall/suit/detail`，返回 `{ title, sections }`；遍历 `data.suit_items`；已知九分类按 `CATEGORY_LABELS` 预设顺序输出（头像挂件前移至第三位）、未知分类追加在后；`itemImages()` 按扩展名白名单展开每个条目的 `properties` 图片字段、`pendant` 分类的 `properties.image` 统一标记 `service: 'pendant'`（用条目自身 `name` 作卡片标题），并**递归 `items[]`** 展开子表情（子项标题用自身 `name`，顶层用字段名）。 |
| `src/lib/gridAnalysis.ts` | **网格推断与几何（608 行，纯计算）**。三层推断：① 常规层 —— 行轴按 alpha 内容带分段（`mergePhantoms` 并回幻影带），列数由全部帧全部行的「内容间隙中点」拟合周期 lattice（`estimateLattice`，三判据决胜：覆盖率 → 截断残差 → 大周期）；② 兜底层 —— 满幅零间隙时用接缝颜色剖面中位数（`seamProfile` / `seamCuts`）数行列；③ 对齐层 —— `finishAxis` 以内容跨度锚定格尺寸与起点，间距自最小内容间隙起、以覆盖修正收尾。`gridCellRects` 是**预览与切割共用的唯一几何来源**。详见 `docs/specs/module-emoji-crop.md`。 |
| `src/lib/imageProcessing.ts` | **图像加工（473 行，依赖 DOM）**。`loadEmojiSheet`：抓字节 → `sniffMime` 嗅探格式 → `decodeAnimatedFrames`（WebCodecs `ImageDecoder` 解出全部已合成帧，并合成**全帧联合 alpha**）→ 静态退回 `createImageBitmap`。`sliceEmojiSheet`：按 `gridCellRects` 切格、补 1:1；静图走 `sliceStillPack`，动图走 `sliceAnimatedPack`（逐帧同几何裁剪 → 去除与前一帧完全相同的帧并累加时长 → 有效帧 ≤1 输出 PNG，否则 `encodeCellGif` 逐帧量化编码）。头像挂件：`detectAvatarRadius` 四向扫描取次大值、`composeEmbeddedAvatar` cover 缩放 + 圆形裁剪 + 模板叠加。下载：`downloadEmojiPack` / `downloadEmbeddedAvatar`。 |
| `src/lib/downloadUtils.ts` | 分区批量 ZIP（原图直存，不加工）。逐张 `fetch` → `blob.type` 决定扩展名 → `safeFilename` 清洗非法字符 + 补序号；单张失败仅 `console.warn` 跳过，不中断整批；`onProgress` 回调百分比。 |
| `src/lib/canvasUtils.ts` | 两个 dialog 共用的画布公共件。`resolveCssToken`（从元素读 M3eTheme 注入的令牌，取不到用 MD3 兜底值）、`drawCheckerboard`（透明底棋盘格，tile 尺寸随图自适应）。 |
| `src/lib/m3eSnackbar.ts` | 用 `@lit/react` 的 `createComponent` 补齐 m3e snackbar 的 React 绑定（上游 `@m3e/react` 只 re-export 元素类，未提供绑定），映射 `toggle` 事件为 `onToggle`。 |
| `src/components/layout/AppShell.tsx` | MD3 主题壳。`usePrefersDark` 实时跟随系统偏好；`forced` 为 `null` 时 `scheme='auto'`，点击后在浅色 / 深色间固定。主题子树内自铺满视口的 `background` / `on-background`（`m3e-theme` 只有直挂 `<body>` 才会给 body 上色）。 |
| `src/components/ui/ImageCard.tsx` | 单张图卡片。按 `item.fit` 决定 `object-fit`（cover 满幅无内边距 / contain 带 12px 内边距）；展示图片原始像素尺寸（W×H）在卡片标题下方；按 `item.service` 决定是否渲染 ✂️ 或嵌入按钮；`openedOnce` 标记让 dialog 首开后**保持挂载**（重开保留用户微调）；`setImgRef` 补一次 `complete` 检查（缓存命中时 `onLoad` 不再触发）；snackbar 反馈加工结果。 |
| `src/components/ui/EmojiCropDialog.tsx` | 切割 dialog（295 行）。`loadEmojiSheet` → `inferGridParams` 填初始值 → 此后完全由用户接管；`drawPreview` 画棋盘格 + 源图（动图取首帧）+ 整幅铺红后 `clearRect` 挖去保留格的蒙层 + 白描边；参数变化即重绘；`gridParamsValid` 为假时禁用确认并提示「格子不足 1px」；`disableClose` —— 背景 / 叉 / ESC 均不可关闭。 |
| `src/components/ui/AvatarEmbedDialog.tsx` | 合成 dialog（217 行）。模板与用户头像分别加载，两图就绪后填入推断半径；`drawPreview` 画棋盘格 + `composeEmbeddedAvatar` 结果，**严格所见即所得**（预览像素即最终产物）；换文件重置半径；`disableClose`。头像合成的完整规格见 `docs/specs/module-avatar-embed.md`。 |
| `src/components/ui/ParamStepper.tsx` | `[−] 值 [+]` 步进器，值可直接键入（`type=number` + `inputMode=numeric`），触摸目标 ≥ 40px。**只管增减与键入，不做范围钳制** —— 语义不同的两个 dialog 各自钳制（网格参数按 `key` 的 `min`，半径走 `clampAvatarRadius`）。 |
| `src/components/ui/ImageGallery.tsx` | 通用分区渲染。`sections.map` → 标题（`label（count）`）+ 可选 `BatchDownloadButton` + `.gallery-grid` 卡片网格。**不感知数据来源**，DLC 与装扮共用。 |
| `e2e/gallery.spec.ts` | 16 个 Playwright 用例（859 行），打真实活动链接，对下载产物做字节级断言（ZIP 条目数、PNG/GIF 魔数、`w === h`、GIF 帧数与每帧时长、透明标记）。 |
| `scripts/diagnose-crop.mjs` | 网格推断诊断脚本。对 5 个真实活动逐个打开全部表情卡的切割 dialog，导出 8 个推断参数与画布尺寸到 stdout，供调参对照。 |

## 模块关系

### 关键耦合点

1. **`gridCellRects` 是几何单点**。`EmojiCropDialog.drawPreview`（画蒙层与描边）和 `imageProcessing.sliceEmojiSheet`（实际切割）都调它，参数一致则预览与产物必然一致。任何网格语义改动只改这一处。

2. **`GridParams` 是算法层与 UI 层的契约**。`inferGridParams` 产出它、`ParamStepper` 编辑它、`gridParamsValid` 校验它、`gridCellRects` 消费它。8 个字段全部为 px 整数，`rows` / `cols` 是格数，其余 6 个是边距与间距。

3. **`alphas[0]` 是「主 alpha」约定**。静态图为整图 alpha，动图为**全帧联合 alpha**（逐像素取各帧最大值）—— 因为动画动作可能超出单帧的静止范围，只看首帧会漏掉格线。`alphas[1..]` 是各帧 alpha，供列轴在分裂帧里恢复被粘连吞掉的格线。这个约定由 `loadEmojiSheet` 建立、`inferGridParams` 依赖，改一处必须改两处。

4. **`GalleryImage.service` 是数据层向 UI 层的能力声明**。由 `fetchDlcData.collectService()` 按 `type_name` 嗅探设定，以及 `fetchGarbSuit.itemImages()` 对 `pendant` 分类的 `properties.image` 统一标记 `service: 'pendant'`。`ImageCard` 据此决定挂哪个 dialog。

### 组件挂载策略

`ImageCard` 用 `cropOpenedOnce` / `avatarOpenedOnce` 控制 dialog 的**条件挂载**：首次打开前不挂载（避免每张卡都预加载大图），首次打开后即使关闭也保持挂载（保留用户的参数微调，支持「切 → 看产物 → 改 → 再切」的迭代工作流）。`open` prop 只控显隐。

## 数据流

### 主链路：链接 → 画廊

```
用户粘贴链接
   │
   ▼ UrlInput.onSubmit(trimmed)
useDlcData.submit(url)
   │
   ▼ parseUrl(url) → ParsedUrl | null
   ├── null → setState(error, '无法从链接中提取 id / lottery_id…')   ✗ 终止
   │
   ▼ lastParams.current = params（供 retry）
    ▼ history.pushState(null, '', paramsToPath(params))  ← RESTful 路径写入地址栏
run(params) → setState(loading)
   │
   ▼ kind === 'dlc' ? fetchDlcData(id, lottery_id) : fetchGarbSuit(itemId)
   │
   │   ┌─ fetch ─► https://p.xrl.im/?url=<encodeURIComponent(B站API)>
   │   │            │
   │   │            ▼ response.json()
   │   │           json.code !== 0 → throw Error(json.message)         ✗
   │   │           !response.ok    → throw Error(HTTP xxx)             ✗
   │   │            │
   │   ▼            ▼ 映射为 { title: string, sections: GallerySection[] }
│   dlc:   data.name→title
   │   dlc:   card_list    → {key:'card',    label:'卡片',   fit:'cover'}
   │          collect_list → {key:'collect', label:'收集品', fit:'contain', service?}
   │   garb:  data.name→title
│          suit_items   → 九分类按预设顺序 + 未知分类追加
   │          每条目 properties 白名单图片字段 + 递归 items[] 子表情
   │
   ▼ sections.length === 0 ? error(EMPTY_MESSAGES[kind]) : success(title, sections)
   │
   ▼ App.tsx 按 status 渲染 → document.title = title
ImageGallery → sections.map → 标题 + BatchDownloadButton + ImageCard[]
   │
   ▼ <img src={item.img}>  ← 浏览器直连 B 站 CDN（no-referrer 绕防盗链）
```

**关键：API 走代理，图片不走代理。** API 响应体是 JSON、必须绕过 CORS；图片本身 CDN 已放行 `*`，直接 `<img src>` 与 `fetch` 即可，多绕一层代理只会拖慢并增加故障面。

### 入口自启动链路：地址栏 → 自动抓取

```
页面首次加载 / 用户打开分享链接
   │
   ▼ useDlcData mount → useEffect (one-shot)
paramsFromPathname()
   │  摘 Vite base 前缀 → 匹配 /dlc/<id>/<lottery_id> → ParsedUrl(dlc)
   │  或匹配 /garb/<itemId> → ParsedUrl(garb)
   └── null → 不做任何事（页面停留在 idle 态）
   │
   ▼ 匹配成功 → run(params) → 等同于用户手动粘贴后的抓取链路
```

### 加工链路 A：表情包切割

```
ImageCard（service==='emoji'）点 ✂️
   │  setCropOpenedOnce(true); setCropOpen(true)
   ▼ EmojiCropDialog 挂载
useEffect[url] → loadEmojiSheet(url)
   │  fetch 原图字节 → sniffMime（GIF/PNG/WebP/JPEG 魔数）
   │  ├─ decodeAnimatedFrames：ImageDecoder 逐帧 decode → canvas + alpha + duration
   │  │     frames > 1 → 合成全帧联合 alpha → { alphas:[union, ...frames], anim }
   │  └─ 非动图 / 不支持 / 解码失败 → createImageBitmap → { alphas:[alpha], stillCanvas }
   ▼ EmojiSheet { W, H, rgba0, alphas, stillCanvas, anim }
useEffect[sheet] → setParams(prev ?? inferGridParams({rgba0, alphas, W, H}))
   │                              │
   │        ┌─────────────────────┴─────────────────────┐
   │        ▼ 行轴：mergePhantoms(contentBands(projectAlpha(alphas[0], 'row')))
   │        ▼ 列轴：fitColumns —— 逐帧逐行采间隙中点 → estimateLattice 拟合周期
   │        ▼ 满幅兜底：rowBands==1 && colBands<=1 && 跨度≥60% → seamCuts 数行列
   │        └─ finishAxis：内容跨度锚定格尺寸，覆盖修正间距，首格中心对齐（无累积漂移）
   ▼ GridParams { rows, cols, marginTop/Bottom/Left/Right, rowGap, colGap }
useEffect[sheet, params] → drawPreview(canvas, sheet, params)
   │  棋盘格 → 源图（stillCanvas ?? anim.canvases[0]）
   │  → overlay: globalAlpha .45 铺 error 色 → 逐格 clearRect 挖空 → 叠回
   │  → 保留格白描边（lineWidth 随图宽缩放）
   │
   │  ◄──── 用户改 ParamStepper ──── 参数变化即重绘（实时反馈闭环）
   ▼
点「确认切割」→ gridParamsValid 为真才放行
   ▼ downloadEmojiPack(sheet, params, name)
sliceEmojiSheet：gridCellRects(params,W,H).map(→ CellBox)
   ├─ anim 存在 → sliceAnimatedPack
   │     每格：逐帧同几何 drawImage 到 s×s 方画布（帧间帧内几何完全对齐）
   │           → 去除与前一帧完全相同的帧（imageDataEqual），时长并入前帧
   │           → kept.length ≤ 1 ? PNG : encodeCellGif（逐帧量化 255色+1透明槽，
   │                                                alpha 二值化 cutoff=128）
   └─ 静态 → sliceStillPack：cropSquareToBlob（内容补 1:1、透明填充、居中）
   ▼ JSZip.file(`01.png` / `01.gif`) → generateAsync(blob) → saveAs(`${name}.zip`)
   ▼ onResult(`已切割下载 N 张表情（含 M 张动图）喵～`) → ImageCard snackbar
```

### 加工链路 B：头像挂件合成

```
ImageCard（service==='pendant'）点嵌入 → <input type=file> → handleFileChosen
   │  setAvatarFile(file); setAvatarOpenedOnce(true); setAvatarOpen(true)
   ▼ AvatarEmbedDialog 挂载（需 url + file 两个输入）
useEffect[url]  → loadPendantTemplate(url)
   │   loadImage(crossOrigin=anonymous) → toCanvasData → detectAvatarRadius
   │   四向扫描首个 alpha>20 的距离 → 降序取 [1]（次大值）→ clampAvatarRadius
   ▼ PendantTemplate { image, W, H, radius }
useEffect[file] → loadUserImage(file) → objectURL → HTMLImageElement（用完 revoke）
   ▼ userImg
useEffect[template,userImg,radius===null] → setRadius(template.radius)
useEffect[template,userImg,radius] → drawPreview
   │   棋盘格 → composeEmbeddedAvatar(template, userImg, radius)
   │            arc clip(r) → cover 缩放居中 drawImage → 叠加模板
   │   ▲ 所见即所得：预览像素 === 最终产物
   │  ◄──── 用户改半径（clampAvatarRadius 钳到 [1, min(W,H)/2]）──── 实时重绘
   ▼
点「确认合成」→ downloadEmbeddedAvatar → canvasToBlob(PNG) → saveAs(`${name}-头像.png`)
   ▼ onResult('头像已合成下载喵～') → snackbar
```

### 批量下载链路

```
BatchDownloadButton 点「打包下载」
   ▼ downloadZip(images, setProgress)
for 每张：fetch(img.img) → res.blob()
   │  ext = blob.type.split('/')[1]（jpeg→jpg，缺省 jpg）
   │  safeFilename(i, name, ext) = `${01}-${清洗后≤60字符}.${ext}`
   │  失败 → console.warn 跳过（不中断整批）
   │  onProgress(round((i+1)/n*100))  → 按钮显示百分比 + 右下角固定进度浮层
   ▼ JSZip.generateAsync(blob) → saveAs('bilibili-dlc-images.zip')
   ▼ snackbar：`成功下载 N 张卡片喵～` / `打包失败，请重试喵……`
```

## 外部系统

| 外部依赖 | 用途 | 失败后果 | 缓解 |
|----------|------|----------|------|
| **`https://p.xrl.im/?url=<encoded>`** | 转发 B 站 API 请求，解决浏览器 CORS 拦截 | 解析功能整体失效（error 态） | 无。单点故障，见 README「已知限制」 |
| **`api.bilibili.com/x/vas/dlc_act/lottery/home_detail/v2`** | DLC 数字周边活动详情（`act_id` + `lottery_id`） | 该链接类型不可用 | `json.code !== 0` 时把 API 的 `message` 直接抛给用户 |
| **`api.bilibili.com/x/garb/v2/mall/suit/detail`** | 个性装扮详情（`item_id`） | 该链接类型不可用 | 同上；`data.suit_items` 为 `null`（下架）时返回空数组，由上层转业务空态文案 |
| **B 站 CDN（`*.hdslb.com` 等）** | 图片本体：`<img>` 展示、`fetch` 下载与切割 | 图片不显示 / 无法切割 | 依赖 CDN 返回 `Access-Control-Allow-Origin: *`；`<meta name="referrer" content="no-referrer">` 使请求不带 `Referer`，通过防盗链 |
| **Google Fonts（Material Symbols Outlined）** | MD3 图标字形 | 图标显示为方块 / 文字 | `index.html` 直链 `<link>`，无本地兜底。AppShell 里的 GitHub mark 是内联 SVG，不受影响 |
| **WebCodecs `ImageDecoder`** | 动图（GIF / 动画 WebP / APNG）逐帧解码 | 动画包退化为静态单帧切割 | `typeof ImageDecoder === 'undefined'` 或解码抛错 → `decodeAnimatedFrames` 返回 `null`，静默退回 `createImageBitmap` 首帧路径 |
| **GitHub Pages + Actions** | 静态托管与自动部署 | 线上不可访问 | `base: '/bilibili-dlc-getter/'` 必须与仓库名一致；`concurrency: pages` + `cancel-in-progress` 防并发部署 |

## 重要技术边界

### 1. `lib/` 纯逻辑 vs `components/` 表现层

`lib/` 不 import React、不持有状态；`components/` 不写算法、不算几何。唯一的例外是 `imageProcessing.ts` 依赖 DOM（`document.createElement('canvas')`、`ImageDecoder`、`createImageBitmap`）—— 它是「算法 + 浏览器能力」的适配层，但仍不含任何 React 概念。

### 2. `gridAnalysis.ts` 零 DOM 依赖（硬边界）

只吃 `Uint8ClampedArray` 与宽高数字，只吐 `GridParams` / `CellRect[]`。所有像素提取（`getImageData`）都在 `imageProcessing.ts` 里完成后传入。**不要为了「方便」把 canvas 传进 gridAnalysis。**

### 3. 推断 vs 精调的责任划分

`inferGridParams` 的契约是「给出接近的初始值」，**不承诺精确**。精确对齐由用户在 dialog 中完成。这条边界决定了算法可以大胆使用启发式而不必穷尽 corner case —— 但也意味着任何推断失准都必须能被用户手动纠正，因此 8 个参数必须全部可编辑，且预览必须实时。

### 4. 预览与产物同源

`drawPreview` 与 `sliceEmojiSheet` 共用 `gridCellRects`。头像侧更强：`drawPreview` 直接调 `composeEmbeddedAvatar`，预览画布上的像素就是最终下载的像素（棋盘格只是透明区底衬）。**不存在「预览好看但产物不对」的可能。**

### 5. 如实标注，不粉饰结果

- 裁切窗 `w !== h` 时，`（1:1）` 标注消失（`gridCellSize` 如实返回算出的 w/h，绝不硬写方片）。
- 推断不出格线时退回兜底层或 `fitBands`，不硬编行列数。
- 1px 的「间隙」判为像素噪声归 0（`snapGap`）—— 因为真实排版里格间距要么 0 要么 ≥3px，不存在真正的 1px 缝。
- 格子不足 1px 时禁用确认按钮并明确提示，不静默产出空图。

### 6. 主题令牌的读取边界

**只读 `--md-sys-color-*` / `--md-sys-shape-*`**（这些是 M3eTheme 注入到子树的真实设计令牌）。`--m3e-*` 前缀的变量只作为组件 cssprop 传给 m3e 组件、由其 shadow DOM 按名读取（dialog 尺寸、进度环直径、app-bar 容器色等）—— 写进普通 CSS 规则里**不会生效**。历史上曾误用 `--m3e-surface` / `--m3e-outline` 做读取，一直靠浅色兜底值硬撑，深色模式下黑字陷深底。

Canvas 内需要主题色时走 `resolveCssToken(el, name, fallback)`，从元素上解析，取不到用 MD3 兜底值 —— 保证脱离主题子树时也能画出可辨识的预览。

### 7. m3e 组件的两个已知陷阱

- **`m3e-card` 的图片必须作为 `<img slot="header">` 直接子元素**。默认 slot 藏在 `<slot name="content">` 的 fallback 里，与显式 `slot="content"` 同时使用会导致图片不渲染（0×0，`loading="lazy"` 永不触发）。
- **关闭态的 `m3e-dialog` 必须移出布局**。其 shadow 内的 `<dialog>` 关闭时仍是 `display:flex`，会给页面凭空垫高一块空白。由 `index.css` 的 `m3e-dialog:not([open]) { display: none; }` 兜住。

### 8. GIF 编码的透明度处理

GIF 只支持 1-bit 透明。`encodeCellGif` 先把 alpha 按 `GIF_ALPHA_CUTOFF = 128` 二值化（半透明边缘压到全透明 / 全不透明两侧），颜色量化走 `rgb565` 取 255 色，再把调色板每项 alpha 补成 255 并追加一个 `[0,0,0,0]` 纯透明槽位，最后用 `rgba4444` 映射 —— 透明像素与追加槽位精确相等，保证落位到透明索引。

### 9. 动图去重与时长合并

同一格里可能只有部分帧真的在动。`sliceAnimatedPack` 逐帧 `imageDataEqual` 比较（用 `Uint32Array` 视图按 32 位整块比，快于逐字节），与前一帧完全相同则丢弃并把时长累加到前一帧。有效帧 ≤ 1 时整格输出 PNG 而非 GIF。每帧时长下限 `Math.max(10, round(durationMs))`。

### 10. 测试边界

- **只跑 `vite preview`（4173）而非 dev server**：e2e 测的是构建产物，与线上一致。
- **`msedge` channel，不下载浏览器**：Playwright 直接驱动本机 Edge。
- **`fullyParallel: false`**：用例打真实网络，串行避免相互干扰与限流。
- **`reuseExistingServer: true`**：本地已起 preview 时复用。
- **断言打在产物字节上**，而非截图或 DOM 文本：ZIP 条目数、PNG/GIF 魔数、IHDR 的 `w === h`、GIF 逻辑屏尺寸、帧数、每帧 delay、每帧透明标记。截图只作人工核验材料落到 `e2e-artifacts/`。
