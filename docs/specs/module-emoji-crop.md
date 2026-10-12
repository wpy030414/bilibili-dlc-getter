# Spec — 表情包网格切割（module-emoji-crop）

对应源码：`src/lib/gridAnalysis.ts`（纯计算）、`src/lib/imageProcessing.ts`（切割与编码部分）、`src/components/ui/EmojiCropDialog.tsx`（交互）。

## 要构建什么

- **目标**：把一张表情包**拼图大图**（N 行 × M 列的均匀网格，静态 PNG 或动画 GIF / WebP / APNG）切割成 N×M 张独立的、统一尺寸的 1:1 方片；动图逐格重编码，动的格保持动画、静止的格退化为静态图；打包为 ZIP 下载。
- **核心难点**：网格参数（行列数、四边外边距、行列间距）**每张图都不一样且肉眼不可靠**。系统从像素自动推断一组接近的初始值，用户在预览中微调后执行切割。

## 行为

### 网格推断（`inferGridParams`）

不假设任何固定行列数，分三层：

1. **常规层**：
   - 行轴：对主 alpha（`alphas[0]`）做行投影，取连续非零区间为「内容带」（`contentBands`）；`mergePhantoms` 把远小于常规尺寸且紧贴邻居的碎带（动画飞行道具探出到行间形成的细带）并回邻居，避免一行错拆成两行。
   - 列轴（`fitColumns`）：整幅列投影常粘连，故逐帧逐行采集「内容间隙中点」，用 `estimateLattice` 对全部中点做周期搜索拟合格线 lattice。动画里贴纸接触时断时连，联合 alpha 上整行粘连的图能在分裂帧里恢复格线。
   - `estimateLattice` 三判据从粗到细决胜候选周期：① 相位集中度（圆均值，<0.5 直接放弃）；② 覆盖率（内部格线是否条条有中点佐证，抑制因子谐波引入的假格线）；③ 截断残差（中点到最近格线距离之和，8px 截断抑制离群点）；完全平局（半周期谐波）取更大周期。
   - `finishAxis` 收尾：格尺寸与首格起点由**内容跨度锚定**（外圈格外缘 = 内容外缘），用「覆盖修正后的最终间距」而非最小内容间隙，避免各格贴纸在格内高低偏移累积出的 ±1~3px 噪声把格顶大 1px。间距下限保证尾边距不透支，上限取最小内容间隙（窗口宁可多带空白，也不切进贴纸）；末窗够不到内容末端时逐 px 把间距让给格子（覆盖修正）。

2. **兜底层（满幅零间隙）**：内容满幅且完全无间隙时没有内容边界可依（`rowBands.length===1 && colBands.length<=1 && 跨度≥60%`），改用接缝颜色剖面（`seamProfile` / `seamCuts`）：相邻列 / 行的颜色差沿垂直方向取中位数聚合，真实接缝处整条剖面色差大、格子内部只有局部色差，中位数聚合后相差一个数量级；对候选段数 N(2..10) 扫描，边界吸附到理想等分位附近的剖面局部最大，取对比度最高的 N。

3. **格间距去噪**：`snapGap` 把 ≤1px 的间隙归 0 —— 相邻贴纸抗锯齿边缘相接时逐像素投影会偶现 1px 透明缝，但真实排版里格间距要么 0 要么 ≥3px，不存在真正的 1px 缝；若当格间距会把列格压小 1px、与行格不等、窗口变非方。

### 几何（`gridCellRects`，预览与切割共用的唯一来源）

- 单轴自然格尺寸 `axisCellSize = ceil(内宽 / 格数)`，再收缩到「n 格 + (n−1) 间隙」放得下 `[lead, extent]`（满幅 trail=0 时的越界保护）；恒为整数 ≥1，整除不尽的余量留在末格右侧。
- 每格起点 `axisStarts`：格距 = 自然格尺寸 + 间隙，自 lead 起（起点间距 ≠ 格宽，差一个 gap）。
- 同轴内格尺寸统一整数、无逐格抖动、不强制补方；两轴恰相等时即严格 1:1。

### 切割（`sliceEmojiSheet`）

- 把 `gridCellRects` 的每个矩形转成 `CellBox`，按格补成 1:1 方形（`squareGeometry`：取长边为边长，内容居中、透明填充）。
- **静态路径**（`sliceStillPack`）：每格 `cropSquareToBlob` → PNG。
- **动图路径**（`sliceAnimatedPack`）：每格逐帧用**同一裁剪几何**画到 s×s 方画布（帧间帧内几何完全对齐）→ `imageDataEqual` 去除与前一帧完全相同的帧（时长并入前帧）→ 有效帧 ≤1 输出 PNG，否则 `encodeCellGif`（逐帧量化 255 色 + 1 透明槽，alpha 按 cutoff=128 二值化）输出动画 GIF。

### 预览（`EmojiCropDialog.drawPreview`）

棋盘格透明底 → 源图（动图取首帧 `anim.canvases[0]`）→ 整幅铺 error 色（`globalAlpha=0.45`）后逐格 `clearRect` 挖去保留格的蒙层（保证格边缘半像素不被误标）→ 保留格白描边（线宽随图宽缩放）。参数变化即重绘。

## 输入 / 输出

- **输入**：
  - 表情大图 URL（`GalleryImage.img`，`service==='emoji'`）。
  - `GridInput { rgba: Uint8ClampedArray, alphas: Uint8ClampedArray[], W, H }` —— `alphas[0]` 为主 alpha（静态图 alpha / 动图全帧联合 alpha），动图时 `alphas[1..]` 为各帧 alpha。
  - `GridParams { rows, cols, marginTop/Bottom/Left/Right, rowGap, colGap }`（全 px 整数）。
- **输出**：
  - `inferGridParams(GridInput) → GridParams`（推断初始值）。
  - `gridCellRects(GridParams, W, H) → CellRect[]`（`{x,y,w,h}`；参数非法返回 `[]`）。
  - `gridCellSize → {w,h} | null`（dialog 展示「格 W×H px」，是否标「（1:1）」由调用方据 `w===h` 判定）。
  - `sliceEmojiSheet → Blob[]`；`downloadEmojiPack → { total, animated }` 并触发 ZIP 下载（`01.png` / `01.gif` 命名，`${name}.zip`）。

## 约束

- `gridAnalysis.ts` **零 DOM 依赖**：只吃 `Uint8ClampedArray` 与宽高，只吐参数与矩形；像素提取（`getImageData`）全在 `imageProcessing.ts` 完成（ARCHITECTURE 技术边界 2）。
- `ALPHA_THRESHOLD = 10`：alpha 高于此值才算「内容像素」。
- `gridParamsValid`：全部非负整数、行列 ≥1、每格至少 1px（`innerW ≥ cols && innerH ≥ rows`）。非法时 `gridCellRects` 返回 `[]`，dialog 禁用确认并提示「格子不足 1px」。
- `estimateLattice` 候选周期 `p ∈ [max(24, span/12), span/2]`，格数 `n ∈ [2,12]`，跨度偏差 `|span − n·p| ≤ p·0.3`。
- GIF 仅 1-bit 透明；`GIF_ALPHA_CUTOFF = 128`；每帧时长下限 `Math.max(10, round(durationMs))`。
- dialog `disableClose`：背景 / 右上角叉 / ESC 均不可关闭，只能走「取消」或确认完成。
- dialog 首开后**保持挂载**（`openedOnce`），重开保留用户微调（迭代式工作流）。

## 边界条件

| 排版类型 | 处理 | e2e 回归 |
|----------|------|----------|
| 常规带间隙网格（5×5 / 4×5 / 3×5） | 常规层：内容带 + 间隙中点 lattice | 静态 25 张、动态 20 张 GIF |
| 贴纸紧贴（1px 缝隙） | `snapGap` 归 0，列间距如实推断为 0 | `id=112538`：边距 56/40、格 200×200（1:1） |
| 跨格宽构图（语义 2:1 的双人格宽贴纸） | 仍按单格 1:1 裁切，不合并 | 粘连型 20 张，切片尺寸统一 |
| 动画道具越界行间 | `mergePhantoms` 并回碎带；联合 alpha 覆盖越界范围 | 动态 20 张 GIF，道具不截断 |
| 满幅零间隙（行列均无间隙，5×5 满幅 200px 格） | 兜底层：接缝颜色剖面数行列 | 紧贴型 25 张，尺寸 190~210 |
| 行内大面积粘连（联合 alpha 整行 500px 连续带） | 列数从各分裂帧的间隙中点恢复格线 | 魔女审判 15 张 GIF，屏宽 ≤110（非整行粘连带） |
| 竖版（3×5 与 5×1 单列混排） | 两轴自然格分别计算，各自统一 | 夜奏未终 15 + 5 张，尺寸分档 |
| `ImageDecoder` 不可用 / 非动图 | `decodeAnimatedFrames` 返回 null，退回 `createImageBitmap` 首帧静态路径 | —— |
| 图片解码失败 | `loadEmojiSheet` 抛错，dialog 显示 `loadError` | —— |
| 参数改到格子 <1px | `gridParamsValid` 为假，禁用确认 + 红字提示 | dialog 用例覆盖 |
| 非方窗（用户改参数致 w≠h） | 如实取消「（1:1）」标注，不强制补方 | dialog 用例：行数 5→2 后 `w≠h` 且无「（1:1）」 |

## 验收标准

> 以下标准均由 `e2e/gallery.spec.ts` 现有用例覆盖，`git log` 记录于提交 `353db25` 通过（16/16）。本次文档梳理**未重跑测试**；勾选前请执行 `pnpm test:e2e` 复核。

- [ ] 常规 / 紧贴 / 跨格宽 / 动画越界 / 满幅零间隙 / 行内粘连 / 竖版七类排版均能切出正确格数（e2e 字节级断言）。
- [ ] 全部切片同轴尺寸统一，静态 1:1 时 `w===h`（PNG IHDR 断言）。
- [ ] 动图逐格保持动画：GIF 帧数、每帧时长、透明标记正确（`parseGifAnim` 断言）；静止格退化为 PNG。
- [ ] `id=112538` 回归：行间距 56、列间距 0、上下边距 56、左右边距 40、格 200×200（1:1）。
- [ ] dialog：8 参数输入框齐全、红蒙层像素存在、背景 / ESC 不关、取消不下载、重开保留微调、改行数切出对应格数、非方窗取消「1:1」标注。
- [ ] 预览与产物同源（共用 `gridCellRects`），不存在「预览对、产物错」。
- [ ] `gridAnalysis.ts` 保持零 DOM 依赖（可 `node scripts/diagnose-crop.mjs` 离线诊断推断参数）。

## 完成定义

- 判定已完成：`pnpm test:e2e` 中全部表情切割用例通过（当前 16/16），且 `e2e-artifacts/` 下落出的切片经肉眼核验切割线贴合格界、动图正常播放、静止格为 PNG。改动推断算法后需额外跑 `node scripts/diagnose-crop.mjs`（先 `pnpm preview`）对照 5 个活动的推断参数未回退。
