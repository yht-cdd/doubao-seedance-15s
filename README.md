# 🎬 豆包 Seedance 增强 (15s/无水印)

为豆包 (doubao.com) 的 Seedance 2.0 Fast 视频生成增加 **15s 时长选项**，并去除生成内容的**水印**。

> ⚠️ **此插件为免费开源分享，不要相信任何骗取你三连的其他人**
>
> 开发者: [B站Tps-pwd](https://space.bilibili.com/3546746508544573) | UID: 3546746508544573

---

## ✨ 功能特性

- ✅ **15s 视频时长** — 在时长菜单中注入 "15s" 选项，请求中自动修改 duration 参数
- ✅ **原生样式** — 15s 选项与原生菜单完全一致
- ✅ **开关控制** — 弹窗可一键启用/禁用插件
- ✅ **时长选择** — 弹窗可切换 5s/10s/15s
- ✅ **Hook 保护** — 使用 `Object.defineProperty` 防止页面脚本覆盖拦截器
- ✅ **自动恢复** — 定期检测 hook 状态，失效时自动重新安装

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
用户选择 15s → React 状态设为 10s（UI 显示 10s）
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

### 无水印处理

通过 `declarativeNetRequest` 静态规则重写网络请求：
- **图片**：替换水印后缀为无水印格式
- **视频**：移除 `logo_type` 水印参数
- **封面**：替换水印后缀为无水印格式
```

## 📊 额度消耗参考

| 时长 | 额度消耗 |
|------|---------|
| 5s   | 1 额度  |
| 10s  | 2 额度  |
| 15s  | 3 额度  |


## 📝 版本历史

### (2026-06-20)
- ✅ 15s 视频时长注入
- ✅ Object.defineProperty hook 保护
- ✅ 自动 hook 恢复机制
- ✅ 弹窗控制界面
- ✅ 开发者信息展示


## 📄 许可证

[GNU General Public License v3.0](LICENSE)

