# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 语言与回复规范

- 永远用**中文**回答用户的问题
- 所有代码注释使用**中文**
- 所有 prompt、工具描述、API 参数、Claude API 的 system/user 消息保持**英文**
- 文件名、变量名、函数名等标识符使用英文

---

## 执行规范

- 所有指令**直接执行**，无需向用户确认
- 文件的创建、修改、删除等操作直接执行
- 遇到任何操作也直接执行，不询问
- 所有工具调用（包括 WebSearch、Bash 命令、文件读写、Agent 调用等）**均直接执行，无需用户二次确认**

---

## 项目概述

本地 AI 视频剪辑工具，面向小红书 / 抖音 / 快手自媒体创作者。
用户上传视频后，可用自然语言描述剪辑意图，由 Claude API 生成结构化剪辑方案，FFmpeg 执行实际剪辑。

**技术栈**：Python + FastAPI + FFmpeg + Claude API（anthropic SDK）

---

## 启动与开发命令

```bash
# 安装依赖（需要 Python 3.10+）
pip install -r requirements.txt

# 配置 API Key
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 启动开发服务器（热重载）
python main.py
# 访问 http://127.0.0.1:8000
```

**外部依赖**：需要单独安装 [FFmpeg](https://ffmpeg.org/download.html) 并加入系统 PATH（`ffmpeg` 和 `ffprobe` 命令可用）。

---

## 架构说明

```
main.py                  FastAPI 入口，定义所有 API 路由
core/ffmpeg_utils.py     FFmpeg 封装：视频信息获取、静音检测、分段剪辑拼接
services/ai_service.py   Claude API 调用：将视频元数据 + 静音信息 + 用户描述
                         转换为结构化剪辑方案（JSON: segments_to_keep + suggestions）
static/                  前端（原生 HTML/CSS/JS，无构建步骤）
uploads/                 用户上传的原始视频（运行时生成，不入库）
outputs/                 剪辑完成的输出视频（运行时生成，不入库）
```

**核心数据流**：

1. `POST /api/upload` → 保存文件，返回 `file_id` 和视频元数据
2. `POST /api/analyze/{file_id}` → FFmpeg 静音检测，返回静音片段列表
3. `POST /api/suggest` → 调用 Claude API，返回 `segments_to_keep` 剪辑方案
4. `POST /api/edit` → FFmpeg 按片段列表裁剪 + 拼接，返回下载链接

**剪辑执行策略**：逐段用 `-c:v libx264 -c:a aac` 重新编码保证帧对齐，再用 `concat demuxer` 拼接。

---

## 代码规范

- 注释用中文，标识符用英文
- 不写多余注释，只在"为什么"不明显时才加
- 不添加超出需求的功能或抽象
- Claude API prompt 必须用英文，保证输出质量
- 前端不引入任何框架或构建工具，保持原生 JS
