---
name: git-push-vpn-retry
description: push 前先检测网络连通性，失败自动重试
metadata:
  type: feedback
---

Git push 前先用 curl 检测 `https://github.com/laiyangli001/claude-config` 是否可达。可达说明 VPN 正常。

Push 失败时不要放弃，自动重试 2-3 次，用 `sleep 2` 间隔。

如果检测不可达，不要自己重试，直接询问用户"VPN 是否已开启？"提醒用户打开 VPN。

**Why:** 网络不稳定，偶尔 push 会 timeout，但重试几次通常能成功。完全不通则是 VPN 没开。
**How to apply:** 每次需要 git push 时，先检测连通性。通则 push（失败重试最多 3 次）。不通则询问用户 VPN 状态。
