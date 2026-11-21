; 线圈本成本核算 · NSIS 安装器补丁
;
; ── 问题（2026-11-21 实测）────────────────────────────────────────────
; 在已装旧版本上覆盖安装会失败：安装器退出码 2，文件时间戳完全不变（等于没装上）。
; 全新安装（先卸载）则退出码 0。
;
; 根因在 electron-builder 的升级流程（include/installUtil.nsh）：
;   1) 把 $INSTDIR\Uninstall CoilBookCost.exe 复制成 $PLUGINSDIR\old-uninstaller.exe
;   2) 循环执行它：ExecWait 'old-uninstaller.exe /S /KEEP_APP_DATA ...'，最多重试 5 次
;   3) 只有返回 0 才继续，否则弹 "无法关闭程序" 并放弃 → 安装器 exit 2
; 而旧卸载器内部的升级分支要把整个 $INSTDIR 改名成 $PLUGINSDIR\old-install
; （uninstaller.nsh 的 atomicRMDir），这一步在本机必然失败并 Abort，
; 于是卸载器永远返回非 0 —— 无论有没有进程在跑、等多久都没用。
;
; ── 修法 ──────────────────────────────────────────────────────────────
; customInit 在 .onInit 里、initMultiUser（已从注册表取到旧安装路径）之后执行，
; 此时 $INSTDIR 已指向旧安装目录。这里直接删掉旧卸载器：
; 后续 copyFile/ExecWait 找不到源文件 → ifErrors 走 DoesNotExist → 视为“没有旧版本”
; → 跳过整段有缺陷的卸载流程，改为直接覆盖安装。
; 新版装好后会写入带本补丁的新卸载器，之后的升级就都正常了。
;
; 同时结束残留实例，避免覆盖时文件被占用。

!macro customInit
  nsExec::Exec 'taskkill /F /IM CoilBookCost.exe /T'
  Sleep 800

  ; 让安装器跳过“执行旧卸载器”这一步（旧卸载器有 rename 缺陷）
  Delete "$INSTDIR\Uninstall CoilBookCost.exe"
  Delete "$LOCALAPPDATA\Programs\CoilBookCost\Uninstall CoilBookCost.exe"
!macroend

; 新版之间升级时，不再走「改名到 old-install」的流程，直接递归删除旧目录
!macro customRemoveFiles
  RMDir /r "$INSTDIR"
!macroend
