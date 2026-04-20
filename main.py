import shutil
import tempfile
import uuid
from pathlib import Path

import aiofiles
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from core.ffmpeg_utils import apply_edits, detect_silence, extract_frames, get_media_info
from core.photo_utils import create_photo_clip, create_slideshow
from services.ai_service import get_editing_plan, get_multi_video_plan, get_slideshow_plan

load_dotenv()

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

ASPECT_RESOLUTIONS = {
    "9:16": (1080, 1920),
    "4:5":  (1080, 1350),
    "1:1":  (1080, 1080),
    "16:9": (1920, 1080),
}

app = FastAPI(title="VideoCut AI")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


# ── 页面入口 ──────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.post("/api/test-key")
async def test_key(body: dict):
    """测试 API Key 是否有效"""
    from openai import OpenAI
    key = body.get("api_key") or ""
    if not key:
        raise HTTPException(400, "未提供 API Key")
    try:
        client = OpenAI(api_key=key)
        # 用最小请求验证 Key
        client.models.list()
        return {"ok": True, "message": "API Key 有效 ✓"}
    except Exception as e:
        raise HTTPException(400, _friendly_ai_error(e))


# ── 视频 / 音频上传 ───────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)):
    mime = (file.content_type or "").split(";")[0].strip()
    if not (mime.startswith("video/") or mime.startswith("audio/")):
        raise HTTPException(400, f"只支持视频或音频文件: {mime}")

    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "media").suffix or (".mp4" if "video" in mime else ".mp3")
    filename = f"{file_id}{ext}"
    filepath = UPLOAD_DIR / filename

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(await file.read())

    info = get_media_info(str(filepath))
    return {
        "file_id": file_id,
        "filename": filename,
        "media_url": f"/uploads/{filename}",
        "media_type": "video" if info["has_video"] else "audio",
        "info": info,
    }


# ── 照片上传 ──────────────────────────────────────────────────────────────────

@app.post("/api/upload-photo")
async def upload_photo(file: UploadFile = File(...)):
    mime = (file.content_type or "").split(";")[0].strip()
    if not mime.startswith("image/"):
        raise HTTPException(400, f"只支持图片文件: {mime}")

    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "photo.jpg").suffix or ".jpg"
    filename = f"{file_id}{ext}"
    filepath = UPLOAD_DIR / filename

    async with aiofiles.open(filepath, "wb") as f:
        await f.write(await file.read())

    return {"photo_id": file_id, "filename": filename, "url": f"/uploads/{filename}"}


# ── 视频分析 & AI 剪辑 ────────────────────────────────────────────────────────

@app.post("/api/analyze/{file_id}")
async def analyze_media(file_id: str):
    filepath = _find_file(file_id)
    return {
        "silences": detect_silence(str(filepath)),
        "info": get_media_info(str(filepath)),
    }


@app.post("/api/suggest")
async def suggest(body: dict):
    filepath = _find_file(body.get("file_id") or "")
    info = get_media_info(str(filepath))
    silences = detect_silence(str(filepath))
    try:
        return get_editing_plan(
            info, silences,
            body.get("description", ""),
            body.get("platform", "抖音"),
            api_key=body.get("api_key") or None,
        )
    except Exception as e:
        raise HTTPException(400, _friendly_ai_error(e))


@app.post("/api/suggest-multi")
async def suggest_multi(body: dict):
    """分析多个视频内容并给出每个视频的剪辑方案及衔接建议（使用 Claude Vision）"""
    file_ids = body.get("file_ids", [])
    if not file_ids:
        raise HTTPException(400, "没有视频文件")
    if len(file_ids) > 8:
        raise HTTPException(400, "最多支持 8 个视频同时分析")

    videos = []
    for fid in file_ids:
        filepath = _find_file(fid)
        info = get_media_info(str(filepath))
        silences = detect_silence(str(filepath))
        frames = extract_frames(str(filepath)) if info.get("has_video") else []
        videos.append({
            "file_id": fid,
            "filename": filepath.name,
            "info": info,
            "silences": silences,
            "frames": frames,
        })

    try:
        return get_multi_video_plan(
            videos,
            body.get("description", ""),
            body.get("platform", "抖音"),
            api_key=body.get("api_key") or None,
        )
    except Exception as e:
        raise HTTPException(400, _friendly_ai_error(e))


@app.post("/api/edit")
async def edit_media(body: dict):
    segments = body.get("segments_to_keep", [])
    if not segments:
        raise HTTPException(400, "没有保留片段")

    filepath = _find_file(body.get("file_id") or "")
    info = get_media_info(str(filepath))
    ext = ".mp3" if not info["has_video"] else ".mp4"
    out_name = f"output_{uuid.uuid4()}{ext}"
    out_path = OUTPUT_DIR / out_name
    opts = body.get("options", {})

    bgm_path = None
    if opts.get("bgm_file_id"):
        try:
            bgm_path = str(_find_file(opts["bgm_file_id"]))
        except Exception:
            pass

    apply_edits(
        str(filepath), segments, str(out_path),
        remove_audio=opts.get("remove_audio", False),
        transition=opts.get("transition", "none"),
        speed=float(opts.get("speed", 1.0)),
        brightness=float(opts.get("brightness", 0.0)),
        contrast=float(opts.get("contrast", 1.0)),
        saturation=float(opts.get("saturation", 1.0)),
        color_preset=opts.get("color_preset", "none"),
        hflip=bool(opts.get("hflip", False)),
        vflip=bool(opts.get("vflip", False)),
        rotate=int(opts.get("rotate", 0)),
        crop_ratio=opts.get("crop_ratio") or None,
        volume=float(opts.get("volume", 1.0)),
        bgm_path=bgm_path,
        bgm_volume=float(opts.get("bgm_volume", 0.5)),
        quality=opts.get("quality", "medium"),
    )
    return {"download_url": f"/outputs/{out_name}", "filename": out_name}


# ── 相册制作 ──────────────────────────────────────────────────────────────────

@app.post("/api/photo-suggest")
async def photo_suggest(body: dict):
    try:
        return get_slideshow_plan(
            photo_count=body.get("photo_count", 1),
            user_description=body.get("description", ""),
            platform=body.get("platform", "抖音"),
            api_key=body.get("api_key") or None,
        )
    except Exception as e:
        raise HTTPException(400, _friendly_ai_error(e))


@app.post("/api/render-slideshow")
async def render_slideshow(body: dict):
    photo_ids = body.get("photo_ids", [])
    if not photo_ids:
        raise HTTPException(400, "没有照片")

    opts = body.get("options", {})
    bgm_id = body.get("bgm_file_id")

    photo_paths = [str(_find_file(pid)) for pid in photo_ids]
    bgm_path = str(_find_file(bgm_id)) if bgm_id else None

    width, height = ASPECT_RESOLUTIONS.get(opts.get("aspect_ratio", "9:16"), (1080, 1920))
    duration_per = float(opts.get("duration_per_photo", 3.0))
    transition = opts.get("transition", "fade")
    effect = "kenburns" if opts.get("ken_burns", True) else "none"

    out_name = f"slideshow_{uuid.uuid4()}.mp4"
    out_path = OUTPUT_DIR / out_name
    tmp_dir = Path(tempfile.mkdtemp())

    try:
        clips = []
        for i, photo_path in enumerate(photo_paths):
            clip = str(tmp_dir / f"clip_{i:04d}.mp4")
            create_photo_clip(photo_path, clip, duration=duration_per, effect=effect, width=width, height=height)
            clips.append(clip)

        create_slideshow(
            clips, str(out_path),
            transition=transition,
            transition_duration=0.5,
            clip_durations=[duration_per] * len(clips),
            bgm_path=bgm_path,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return {"download_url": f"/outputs/{out_name}", "filename": out_name}


# ── 静态资源 ──────────────────────────────────────────────────────────────────

app.mount("/static",  StaticFiles(directory="static"),  name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")


def _friendly_ai_error(e: Exception) -> str:
    msg = str(e)
    if "401" in msg or "invalid_api_key" in msg or "Incorrect API key" in msg or "authentication_error" in msg:
        return "API Key 无效或未填写，请检查 API Key"
    if "429" in msg or "rate_limit" in msg or "overloaded" in msg:
        return "请求过于频繁或模型繁忙，请稍后再试"
    if "insufficient_quota" in msg or "credit" in msg:
        return "账户余额不足，请充值后再试"
    if "model_not_found" in msg or "does not exist" in msg:
        return f"模型不存在，请检查模型名称：{msg[:120]}"
    return f"AI 调用失败：{msg[:200]}"


def _find_file(file_id: str) -> Path:
    for f in UPLOAD_DIR.iterdir():
        if f.stem == file_id:
            return f
    raise HTTPException(404, "文件不存在，请重新上传")


if __name__ == "__main__":
    import threading
    import time
    import webbrowser
    import uvicorn

    def _open_browser():
        time.sleep(1.5)
        webbrowser.open("http://127.0.0.1:8000")

    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
