import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

FPS = 25

XFADE_MAP = {
    "fade":  "fade",
    "wipe":  "wipeleft",
    "zoom":  "zoom",
    "slide": "slideleft",
}


def create_photo_clip(
    photo_path: str,
    output_path: str,
    duration: float = 3.0,
    effect: str = "kenburns",
    width: int = 1080,
    height: int = 1920,
) -> None:
    """将单张照片渲染为固定时长的视频片段"""
    frames = int(duration * FPS)

    if effect == "kenburns":
        # 放大到目标尺寸的1.5倍，zoompan 从1.0缓慢放大到1.5，保证画质
        zoom_w = int(width * 1.5)
        zoom_h = int(height * 1.5)
        zoom_speed = round(0.5 / frames, 5)
        vf = (
            f"scale={zoom_w}:{zoom_h}:force_original_aspect_ratio=increase,"
            f"crop={zoom_w}:{zoom_h},"
            f"zoompan=z='min(zoom+{zoom_speed},1.5)':d={frames}:"
            f"x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2',"
            f"scale={width}:{height},setsar=1"
        )
    else:
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1"
        )

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", str(FPS),
        "-i", photo_path,
        "-vf", vf,
        "-t", str(duration),
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-an",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"照片转视频失败: {result.stderr.decode()[-400:]}")


def create_slideshow(
    clip_paths: List[str],
    output_path: str,
    *,
    transition: str = "fade",
    transition_duration: float = 0.5,
    clip_durations: Optional[List[float]] = None,
    bgm_path: Optional[str] = None,
) -> None:
    """将多个照片片段拼接为幻灯片视频，支持 xfade 转场和背景音乐"""
    n = len(clip_paths)
    if n == 0:
        raise ValueError("没有照片片段")

    if clip_durations is None:
        clip_durations = [3.0] * n

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        mid = str(tmp_dir / "slides.mp4") if bgm_path else output_path

        if n == 1 or transition == "none":
            _concat(clip_paths, mid)
        else:
            _xfade(clip_paths, clip_durations, transition, transition_duration, mid)

        if bgm_path:
            _add_bgm(mid, output_path, bgm_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _concat(clip_paths: List[str], output_path: str) -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        lst = tmp / "list.txt"
        lst.write_text("\n".join(f"file '{Path(p).as_posix()}'" for p in clip_paths))
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", str(lst), "-c", "copy", output_path],
            capture_output=True, check=True,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _xfade(
    clip_paths: List[str],
    clip_durations: List[float],
    transition: str,
    td: float,
    output_path: str,
) -> None:
    """使用 xfade 滤镜串联多个片段，offset 按累计时长递增"""
    n = len(clip_paths)
    xf = XFADE_MAP.get(transition, "fade")

    inputs = sum([["-i", p] for p in clip_paths], [])
    parts = []
    last = "[0:v]"
    offset = 0.0

    for i in range(1, n):
        offset += clip_durations[i - 1] - td
        out = f"[v{i}]" if i < n - 1 else "[outv]"
        parts.append(
            f"{last}[{i}:v]xfade=transition={xf}"
            f":duration={td}:offset={round(offset, 3)}{out}"
        )
        last = out

    subprocess.run(
        ["ffmpeg", "-y"] + inputs + [
            "-filter_complex", ";".join(parts),
            "-map", "[outv]",
            "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
            output_path,
        ],
        capture_output=True, check=True,
    )


def _add_bgm(video_path: str, output_path: str, bgm_path: str) -> None:
    """为视频添加循环背景音乐，末尾淡出"""
    from core.ffmpeg_utils import get_media_info
    dur = get_media_info(video_path)["duration"]
    fade_st = max(0.0, dur - 1.5)

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path,
            "-stream_loop", "-1", "-i", bgm_path,
            "-map", "0:v", "-map", "1:a",
            "-shortest",
            "-c:v", "copy", "-c:a", "aac",
            "-af", f"afade=t=out:st={fade_st}:d=1.5",
            output_path,
        ],
        capture_output=True, check=True,
    )
