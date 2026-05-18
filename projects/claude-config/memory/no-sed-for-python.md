---
name: no-sed-for-python
description: 绝不用 sed 改 Python 源码，必须用 Python 脚本做精确字符串替换
metadata:
  type: feedback
---

**不用 sed 改 Python 源码。**

**Why:** Windows/MSYS2 环境下 sed 会吃掉换行符、吞掉反斜杠转义、搞乱缩进（tab/space），每次必出 bug。多次血训——`\)` 转义被 shell 吃掉导致正则爆炸，`\n` 被吞导致两行合并，`\s*` 匹配到换行符导致语法错误。

**How to apply:**
- 改 Python → 用 Python 脚本（项目自带的 `python3/python.exe`）做精确字符串替换
- 改前备份：`cp file.py file.py.bak`
- 改后立即语法检查：`python -c "import py_compile; py_compile.compile('file.py', doraise=True)"`
- re.sub 替换源码时，用 `(\r?\n?)` 捕获换行符并 `\1` 回填，字符集用 `[^,\n)]+` 限制不跨行
