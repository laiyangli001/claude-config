# 修改 .bat 脚本适配目录结构调整

## Context

用户将两个 .bat 脚本从 `Desktop2Stereo/` 子目录移到父目录，所有代码资源仍留在 `Desktop2Stereo/` 子目录。要求：

1. 修改脚本中的路径，加上 `.\Desktop2Stereo\` 前缀
2. 改进 update 脚本：环境检查、错误处理、保留用户配置、正确解压到子目录

## 关键文件

- `./run_windows.bat` — 启动脚本
- `./update_windows.bat` — 更新脚本
- `./Desktop2Stereo/` — 子目录，包含 python3/、gui.py、requirements.txt、controllers/ 等

## 修改内容

### run_windows.bat
- `PYTHON_EXE=.\python3\python.exe` → `.\Desktop2Stereo\python3\python.exe`
- `gui.py` → `.\Desktop2Stereo\gui.py`
- 增加 Desktop2Stereo 目录和 python.exe 的存在性检查

### update_windows.bat — 7 项改进

| 阶段 | 改进 |
|------|------|
| 环境检查 | 校验 Desktop2Stereo 子目录、curl 命令、GitHub 连通性 |
| 下载验证 | 下载失败、文件不存在、ZIP 伪装为 HTML 三种错误处理 |
| 解压 | PowerShell Expand-Archive 包裹 try/catch，解压失败即退出 |
| 保留用户数据 | 备份 settings.yaml、gui_layout.json、controllers/、backup/、font.ttf 到临时保留区 |
| 更新路径 | xcopy 目标为 `.\Desktop2Stereo\` 而非根目录 |
| 恢复数据 | 更新后从保留区拷回用户配置 |
| 清理 | 随机命名临时目录 (%RANDOM%)，完整删除保留区 |

## 验证

1. 确认 `run_windows.bat` 能启动 `.\Desktop2Stereo\gui.py`
2. 模拟 `update_windows.bat` 的下载+解压流程确认路径正确
3. 确认 settings.yaml 等配置在更新后不被覆盖
