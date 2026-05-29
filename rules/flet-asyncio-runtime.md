# asyncio + Flet 运行时规则

## 规则 1：协程投递到正确的循环

同步回调中启动协程时（Flet 事件回调、线程回调）：

```python
# ❌ 错误
asyncio.create_task(self._some_async_fn())

# ✅ 正确
future = asyncio.run_coroutine_threadsafe(self._some_async_fn(), self._loop)
future.add_done_callback(lambda f: print(f.exception()) if f.exception() else None)
```

同一应用内所有协程必须投递到同一个 `self._loop`（在 `setup()` 中用 `asyncio.get_running_loop()` 保存）。

## 规则 2：进程管理永远用 subprocess.Popen

跨平台场景下，`asyncio.create_subprocess_exec` 在 Windows 上存在已知问题：
- `await proc.wait()` 可能在进程退出后永不返回
- `proc.returncode` 可能在进程退出后不更新（asyncio transport 回调不触发）

```python
# ❌ 错误（Windows 上不可靠）
self.process = await asyncio.create_subprocess_exec(...)
await proc.wait()

# ✅ 正确
self.process = subprocess.Popen([...], cwd=..., creationflags=...)
rc = await asyncio.to_thread(proc.wait)
```

Stop 路径和监控路径必须使用同一套机制。

## 规则 3：asyncio.create_task 返回值必须保存

Python 3.12+ 中，没有外部引用的 Task 对象可能被垃圾回收，导致协程永不执行。

```python
# ❌ 错误（可能被 GC）
asyncio.create_task(self._some_fn())

# ✅ 正确
self._some_task = asyncio.create_task(self._some_fn())
```

## 规则 4：子进程 stdio 必须显式指定

```python
# ❌ 错误（继承父进程句柄，可能阻塞）
subprocess.Popen([...])

# ✅ 正确
subprocess.Popen(
    [...],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
```

不需要输出时用 `DEVNULL`，需要输出时用 `PIPE` + `communicate()`。

## 规则 5：Windows 控制台 Quick Edit Mode

进程运行时禁用 Quick Edit（防止点击控制台时程序冻结），进程退出后恢复。

```python
import ctypes
kernel32 = ctypes.windll.kernel32
mode = ctypes.c_uint32()
kernel32.GetConsoleMode(kernel32.GetStdHandle(-10), ctypes.byref(mode))
if running:
    kernel32.SetConsoleMode(kernel32.GetStdHandle(-10), mode.value & ~0x0040)
else:
    kernel32.SetConsoleMode(kernel32.GetStdHandle(-10), mode.value | 0x0040)
```

## 规则 6：所有子进程参数必须显式传递

```python
# ❌ 错误（依赖 CWD、环境变量等隐式状态）
Popen(["python", "main.py"])

# ✅ 正确
Popen(
    [sys.executable, "main.py"],
    cwd=os.path.dirname(os.path.abspath(__file__)),
)
```
