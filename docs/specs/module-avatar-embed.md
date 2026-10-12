# Spec — 头像挂件合成（module-avatar-embed）

对应源码：`src/lib/imageProcessing.ts`（头像合成部分）、`src/components/ui/AvatarEmbedDialog.tsx`（交互）。

## 要构建什么

- **目标**：把用户的本地头像嵌入 B 站的**头像挂件模板**（一张中心镂空的环形装饰图），合成一张可直接使用的头像 PNG。
- **核心难点**：挂件中心的透明圆孔半径每张模板都不一样，头像必须精确圆形裁剪到合适半径再叠加 —— 半径靠肉眼试错成本高，且换头像就得重做。

## 行为

### 半径推断（`detectAvatarRadius`）

从模板圆心向四个方向（左 / 右 / 上 / 下）扫描，各自遇到首个不透明像素（`alpha > 20`）的距离即该向内圆距离；四个距离降序排列后**取次大值（`distances[1]`）**作为头像半径。取次大而非最小，是为了与主体装饰留出安全距离、同时允许凸出装饰自然叠压头像。任一方向扫不到不透明像素（扫出画布）时该向距离记为 `min(W,H)`；四向都异常时回退 `floor(min(W,H)/4)`。

### 合成（`composeEmbeddedAvatar`）

返回模板尺寸（W×H）的画布：

1. 以模板中心 `(floor(W/2), floor(H/2))` 为圆心、`radius` 为半径 `arc` + `clip`。
2. 用户图按 **cover 缩放**（`scale = max(d/userW, d/userH)`，`d = radius*2`）居中绘制到裁剪区 —— 保证圆形被填满、不变形、超出部分裁掉。
3. 恢复裁剪后，把模板原图 `drawImage(image, 0, 0)` 叠加在最上层（中心透明圆孔透出头像）。

### 预览（`AvatarEmbedDialog.drawPreview`）

棋盘格透明底 → `composeEmbeddedAvatar` 结果直接画上。**严格所见即所得**：预览画布上的像素就是最终下载的像素，棋盘格只是透明区的可视化底衬。半径变化即重绘。

## 输入 / 输出

- **输入**：
  - 头像挂件模板 URL（`GalleryImage.img`，`service==='pendant'`）。
  - 用户选择的本地头像 `File`。
  - `radius`（px，用户可微调）。
- **输出**：
  - `loadPendantTemplate(url) → PendantTemplate { image, W, H, radius }`（`radius` 为推断初始值）。
  - `loadUserImage(file) → HTMLImageElement`（经 objectURL，用完 `revokeObjectURL`）。
  - `composeEmbeddedAvatar(template, userImg, radius) → HTMLCanvasElement`。
  - `downloadEmbeddedAvatar(...) → void`，产出 PNG 并 `saveAs(`${name}-头像.png`)`。
  - `clampAvatarRadius(radius, W, H) → number`（钳制到 `[1, floor(min(W,H)/2)]`，非有限值归 1）。

## 约束

- 半径钳制范围：至少 1px，至多不超模板短边半幅（圆心居中时圆不出画布）。`updateRadius` 每次改值都过 `clampAvatarRadius`。
- 模板原图加载需 `crossOrigin='anonymous'`（B 站 CDN 放行 `*`），否则画布被污染无法 `toBlob`。
- dialog `disableClose`：背景 / 叉 / ESC 均不可关闭，只能走「取消」或确认完成。
- dialog 需 `url` + `file` 两个输入就绪（`ready = template && userImg && radius !== null`）才显示预览与启用确认。
- dialog 首开后**保持挂载**（`avatarOpenedOnce`），重开保留半径微调；换文件（`useEffect[file]`）重载用户图并把半径重置为 `null`（待重新初始化）。

## 边界条件

| 情况 | 处理 |
|------|------|
| 模板加载失败 / 非图片 | `loadPendantTemplate` 抛错 → dialog 显示 `loadError`（「模板加载失败喵……」） |
| 用户头像读取失败 | `loadUserImage` reject → `loadError`（「头像读取失败喵……」） |
| 模板无透明圆孔（四向都扫到不透明或都扫空） | `detectAvatarRadius` 回退 `floor(min(W,H)/4)`，仍给一个可用初始值 |
| 用户头像非正方形 | cover 缩放 + 圆形裁剪，居中，超出裁掉，不拉伸变形 |
| 用户头像小于圆孔直径 | cover 缩放会放大到填满圆孔（可能模糊，属预期） |
| 半径调到 1 / 调到最大 | `clampAvatarRadius` 钳制，圆始终不出画布 |
| 换头像文件 | 重载用户图、半径重置为模板推断值，预览重绘 |
| 取消 | 不触发下载（e2e 断言 `downloaded === false`） |

## 验收标准

> 以下标准由 `e2e/gallery.spec.ts` 的头像框用例覆盖，`git log` 记录于提交 `353db25` 通过。本次文档梳理**未重跑测试**；勾选前请执行 `pnpm test:e2e` 复核。

- [ ] 点嵌入按钮 → 选文件 → 弹合成 dialog，预览显示已套挂件的头像。
- [ ] 默认半径为正、如实回报模板尺寸（`头像半径 R px · 直径 2R px · 模板 W×H px`）。
- [ ] 背景 / ESC 不关闭 dialog（`disableClose`）。
- [ ] 调半径预览实时重绘；确认后按半径产出对应尺寸 PNG（e2e：默认半径产出 420×420）。
- [ ] 改半径后产物像素随之改变（e2e 断言两次产物不同）。
- [ ] 取消不下载。
- [ ] 所见即所得：预览像素 === 最终产物像素。

## 完成定义

- 判定已完成：`pnpm test:e2e` 中头像框用例通过，且 `e2e-artifacts/` 下落出的合成头像（`embedded-avatar.png` / `avatar-dialog.png` 等）经肉眼核验 —— 头像圆形裁剪无变形、居中、挂件叠加在上层、透明区正确。
