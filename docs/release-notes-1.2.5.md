## 下载

| 文件 | 平台 | 说明 |
| --- | --- | --- |
| `CoilBookCost-Setup-1.2.5.exe` | Windows x64 | NSIS 安装包；从 1.0.0 起的各版本都可直接覆盖升级。**Gitee 上这个是切成 `.part1`/`.part2` 两片的**（附件上限 100MB），应用内更新会自动拼接 |
| `CoilBookCost-1.2.5.apk` | Android 7.0+ | 装过 1.2.0 之后各版可直接覆盖；装过 1.1.x / 1.0.0 需先卸载 |

> 如果你现在装的是 1.2.2 / 1.2.3，**这一版必须手动装一次**——旧版的「检查更新」在本机连不上 GitHub（见下），修复只对装上新版之后生效。

## 本次内容

### 修复：Windows「检查更新」报证书错误

现象：点「检查更新」弹出

```
Error invoking remote method 'updater:check': Error: unable to verify the first certificate;
if the root CA is installed locally, try running Node.js with --use-system-ca
```

原因不是网络不通，而是**证书链缺中间证书**：

- 主进程用 Node 自带的 HTTPS 通道，用的是 Node 内置 CA 包
- 有的机器（这台就是）需要 Windows 系统证书库里的中间证书才能把 `api.github.com` 的链补齐，而 Node 内置包里没有
- 同一时刻 `curl`（走系统证书库）请求同一个地址是 200

修法是不关校验、改用对的那条通道：

- 主进程的所有出网请求（检查更新 + 下载安装包）改为**优先走 Chromium 网络栈**（Electron `net`），它用 Windows 系统证书库
- 万一它也不通，渲染层再用浏览器 `fetch` 重试一次（同一个证书库，但能绕开主进程的环境差异）
- 两处都不通时给的是人话（`TLS 证书校验失败（证书链不完整）`），不再把裸 Node 报错丢到界面上

校验方式：同一台机器上 `node:https` 仍然报错、`electron.net` 返回 200，说明修的是通道而不是放宽了校验。

### 下载源：检查走 GitHub，下载优先 Gitee

同一条网线实测（这台机器）：

| 源 | 检查更新 | 下载 150MB 安装包 |
| --- | --- | --- |
| GitHub Release | 0.2–1.6 秒 | 约 29 KB/s（要 85 分钟） |
| Gitee | 0.2 秒 | 约 2.1 MB/s（约 75 秒） |

所以这一版把两件事分开：

- **检查更新仍走 GitHub**，用最快的方式拿到最新版本号
- **下载时如果 Gitee 有同版本的分片，就自动用 Gitee 下载**，界面上会显示「下载源 Gitee」
- Gitee 的版本与 GitHub 不一致时**不会**用镜像（避免出现"提示 1.2.5、实际下到 1.2.4"）

分片链路（依次下载 → 拼接 → 按 SHA-256 校验 → 通过才安装）没变，1.2.5 的包已实测：149,529,126 字节、74 秒下完、拼接后 SHA-256 与清单完全一致。

### 其它

- 「检查更新」失败时的提示按原因分类（凭据被拒 / 两个源都没有 Release / 网络不可达），并附上主进程的人话诊断

## 校验

Windows 安装包：149531201 字节，SHA-256 `57ADE3CADE24271AAAD6DDED26245D05DD79BEE4D8B56295C3D908B80459E6DE`

Android APK：8002132 字节，SHA-256 `D2F77B736185A7E620768F4E8614D47F0CBF7DE4CAFD00C424975FA814DDE43B`

Gitee 分片清单：`CoilBookCost-Setup-1.2.5.exe.parts.json`（总大小与 SHA-256 与上表一致）

## 已知限制

- Windows 安装包未做代码签名，首次运行可能有 SmartScreen 提示
- 已在 Android 14 x86_64 模拟器验证，未覆盖 ARM 真机与各厂商 ROM
- 本地 OCR 对模糊 / 手写 / 复杂排版识别率有限，识图填参后请人工核对
