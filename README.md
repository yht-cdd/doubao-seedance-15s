# 🎬 豆包 Seedance 增强 (15s/无水印/Seedance 2.0 Mini)

为豆包 (doubao.com) 的 Seedance 2.0 Fast / 2.0 Mini 视频生成增加 **15s 时长选项**，并去除生成内容的**水印**。

> ⚠️ **此插件为免费开源分享，不要相信任何骗取你三连的其他人**
>
> 核心开发者: [B站Tps-pwd](https://space.bilibili.com/3546746508544573) | UID: 3546746508544573
> v6.0.0 贡献: [B站嗯哼de呀](https://space.bilibili.com/491672078) | UID: 491672078

---

## ✨ 功能特性

- ✅ **15s 视频时长** — 在时长菜单中注入 "15s" 选项，请求中自动修改 duration 参数
- ✅ **原生样式** — 15s 选项与原生菜单完全一致
- ✅ **开关控制** — 弹窗可一键启用/禁用插件
- ✅ **时长选择** — 弹窗可切换 5s/10s/15s
- ✅ **Hook 保护** — 使用 `Object.defineProperty` 防止页面脚本覆盖拦截器
- ✅ **自动恢复** — 定期检测 hook 状态，失效时自动重新安装
- ✅ **UI 显示修正** — 选择 15s 后，菜单勾选和按钮文字均正确显示为 15s

## 🛠️ 安装方法

### Chrome / Edge / 兼容浏览器

1. 下载本仓库源码（Code → Download ZIP）
2. 解压到本地任意目录
3. 打开浏览器，地址栏输入 `chrome://extensions/`（Edge 为 `edge://extensions/`）
4. 开启右上角 **"开发者模式"**
5. 点击 **"加载解压缩的扩展"**
6. 选择解压后的文件夹
7. 完成！访问 [doubao.com](https://www.doubao.com) 即可使用

## 🚀 使用说明

1. 安装插件后，访问 [豆包](https://www.doubao.com)
2. 进入视频生成功能（Seedance 2.0 Fast）
3. 点击 **时长** 下拉菜单，选择新增的 **"15s"** 选项
4. 输入提示词，生成视频
5. 无水印功能对新生成的内容自动生效

### 弹窗功能

点击浏览器工具栏的插件图标，可以：
- **启用/禁用** 插件
- **切换时长** (5s / 10s / 15s)
- 查看开发者信息

## 🔧 工作原理

### 15s 时长注入

```
用户选择 15s → 勾选标记移至 15s 选项
    ↓
按钮文字更新为 "15s"
    ↓
配置保存到 chrome.storage
    ↓
发送请求时，fetch hook 拦截请求体
    ↓
正则匹配 "duration":10 → 替换为 "duration":15
    ↓
服务器收到 duration=15 → 生成 15s 视频
```

**关键技术点：**
- `inject.js` 以 `world: "MAIN"` 注入，在页面脚本之前运行
- 使用 `Object.defineProperty` 保护 `window.fetch` 不被页面覆盖
- `content.js` 通过注入 script 标签提供 hook 恢复机制
- 支持 `ReadableStream` 和 `FormData` 格式的请求体
- 正则匹配多层转义格式：`"duration":10`、`\"duration\":10`、`\\"duration\\":10`
- UI 显示修正：选择 15s 后自动把勾选标记从 10s 移到 15s，并修正按钮文字

### 无水印处理

通过 `declarativeNetRequest` 静态规则重写网络请求：
- **图片**：替换水印后缀为无水印格式
- **视频**：移除 `logo_type` 水印参数
- **封面**：替换水印后缀为无水印格式

## 📊 额度消耗参考

| 时长 | 额度消耗 |
|------|---------|
| 5s   | 1 额度  |
| 10s  | 2 额度  |
| 15s  | 3 额度  |


## 📝 版本历史

### v7.7.2 (2026-07-11)
- ✅ **Thread页面解析** — 从 `doubao.com/thread/xxx` 分享页提取视频数据
- ✅ **无水印下载** — 通过 `samantha/aispace/get_download_info` API 获取无水印视频URL
- ✅ **Referer头修复** — 下载时带 `Referer` 头，避免CDN 403
- ✅ 修复 `data-fn-args` 解析格式兼容性（支持两种JSON结构）
- ✅ 修复 `scanForGeneratedVideos` 语法错误
- ✅ 获取到无水印URL后自动覆盖水印版URL

### v7.6.0 (2026-07-11)
- ✅ **豆包无水印视频API获取** — 3步API流程获取原始高质量无水印视频
- ✅ 自动扫描vid并异步获取无水印URL
- ✅ 39MB原始高质量视频（对比有水印版仅2MB）

### v7.5.1 (2026-07-11)
- ✅ MutationObserver 监听视频元素插入，立即替换水印
- ✅ 不再依赖 `setInterval` 定时检查

### v7.5.0 (2026-07-11)
- ✅ 修复面板不显示豆包视频链接
- ✅ `mergeUrlMap` 防止替换器保存的URL被后续响应覆盖
- ✅ 面板自动扫描 `creation_block` 中的视频ID和封面图

### v6.0.0 (2026-07-03)
- ✅ **支持 Seedance 2.0 Mini** — 插件现可与 Seedance 2.0 Mini 兼容使用
- ✅ 重构 UI 显示逻辑：添加 `syncMenuCheckmark()` 函数自动同步勾选标记位置
- ✅ 修复选择 15s 后按钮文字显示：下拉按钮正确显示 "15s"
- ✅ 添加 `patchDurationButton()` / `clearDurationButtonPatch()` 函数
- ✅ 增强 SPA 路由变化检测，确保导航后自动恢复 hook

### v5.0.0 (2026-07-03)
- ✅ 修复选择 15s 后 UI 显示问题：菜单勾选正确显示在 15s 选项上
- ✅ 修复选择 15s 后按钮文字显示：下拉按钮正确显示 "15s"
- ✅ 添加 `syncMenuCheckmark()` 函数：自动同步勾选标记位置
- ✅ 添加 `patchDurationButton()` 函数：修正按钮文字显示
- ✅ 添加 `clearDurationButtonPatch()` 函数：切换回原生时长时恢复显示
- ✅ 更新工作原理描述，反映 UI 显示已修复

### v1.0.0 (2026-06-20)
> [B站嗯哼de呀](https://space.bilibili.com/491672078) | UID: 491672078
- ✅ 15s 视频时长注入
- ✅ Object.defineProperty hook 保护
- ✅ 自动 hook 恢复机制
- ✅ 弹窗控制界面
- ✅ 开发者信息展示

## 📄 许可证

[GNU General Public License v3.0](LICENSE)
