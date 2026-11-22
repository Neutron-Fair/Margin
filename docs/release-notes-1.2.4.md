## 下载

| 文件 | 平台 | 说明 |
| --- | --- | --- |
| `CoilBookCost-Setup-1.2.4.exe` | Windows x64 | NSIS 安装包；从 1.0.0 起的各版本都可直接覆盖升级。**Gitee 上这个是切成 `.part1`/`.part2` 两片的**（附件上限 100MB），应用内更新会自动拼接 |
| `CoilBookCost-1.2.4.apk` | Android 7.0+ | 装过 1.2.0 之后各版可直接覆盖；装过 1.1.x / 1.0.0 需先卸载 |

## 本次内容

### 更新源：GitHub 优先，Gitee 兜底

以前「检查更新」只认 GitHub。GitHub 连不上（连接被重置、超时）时，就只能自己去网页找安装包。

现在两端都会**自动换源**：

- 先查 GitHub Release；拿不到就立刻改用 Gitee 镜像再查一次，全程不需要设置
- 结果里会标出这次来自哪个源（`GitHub` / `Gitee`）
- 高级设置里的说明补上了这条兜底行为

### Gitee 上的安装包是按分片发布的

Gitee 发行版的附件**单文件上限 100MB**，而这个 Windows 安装包约 142MB，直接传会被拒。所以 Gitee 那边的发布方式是：

- 安装包按 90MB 切成 `CoilBookCost-Setup-1.2.4.exe.part1` / `.part2`
- 同时上传一份 `...exe.parts.json` 清单（记录总大小、SHA-256、每片大小）
- 桌面端点「下载并安装」时，应用会依次下载全部分片 → 拼接 → **校验 SHA-256** → 校验通过才安装

校验值同样取自发布说明里那两行（`… 字节，SHA-256 …`），所以不管从哪个源下载都适用；分片、拼接、校验都有单元测试盯着。

### 发布脚本

新增 `tools/publish-gitee.ps1`：自动切片、创建/更新 Gitee Release、幂等重传附件（同名先删后传）。GitHub 仍然是 `tools/publish-release.ps1`。

## 校验

Windows 安装包：149529126 字节，SHA-256 `21D839FC182BF5D508845026AFB98EBA77461BB31A298A48447A94D28AE57C52`

Android APK：8001836 字节，SHA-256 `A3F96F039A38658F38FC7F7BC00757A607D2E957C1028A4E67F24A1C5739F9E9`

Gitee 分片清单：`CoilBookCost-Setup-1.2.4.exe.parts.json`（总大小与 SHA-256 与上表一致）

## 已知限制

- Windows 安装包未做代码签名，首次运行可能有 SmartScreen 提示
- 已在 Android 14 x86_64 模拟器验证，未覆盖 ARM 真机与各厂商 ROM
- 本地 OCR 对模糊 / 手写 / 复杂排版识别率有限，识图填参后请人工核对
