import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional

# 色彩预设滤镜
COLOR_PRESETS: Dict[str, str] = {
    "warm":    "eq=brightness=0.05:contrast=1.1:saturation=1.4,hue=h=8",
    "cool":    "eq=brightness=0.02:saturation=1.2,hue=h=-8",
    "vintage": "eq=saturation=0.6:contrast=1.2:brightness=-0.02",
    "bw":      "hue=s=0,eq=contrast=1.2",
    "vivid":   "eq=saturation=2.0:contrast=1.2:brightness=0.02",
}

# 导出质量 → CRF
QUALITY_CRF = {"high": 18, "medium": 23, "low": 28}

# 平台比例 → 目标分辨率
CROP_SIZES = {
    "9:16": (1080, 1920),
    "1:1":  (1080, 1080),
    "16:9": (1920, 1080),
    "4:5":  (1080, 1350),
}


def get_media_info(filepath: str) -> Dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams", "-show_format",
        filepath,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败: {result.stderr}")

    data = json.loads(result.stdout)
    video_stream = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio_stream = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    duration = float(data["format"].get("duration", 0))

    info: Dict[str, Any] = {
        "duration": round(duration, 2),
        "has_audio": audio_stream is not None,
        "has_video": video_stream is not None,
    }
    if video_stream:
        info["width"] = video_stream.get("width")
        info["height"] = video_stream.get("height")
        fps_str = video_stream.get("r_frame_rate", "0/1")
        num, den = map(int, fps_str.split("/"))
        info["fps"] = round(num / den, 2) if den else 0

    return info


def detect_silence(
    filepath: str,
    noise_db: float = -30,
    min_duration: float = 0.5,
) -> List[Dict]:
    cmd = [
        "ffmpeg", "-i", filepath,
        "-af", f"silencedetect=n={noise_db}dB:d={min_duration}",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    output = result.stderr

    starts = re.findall(r"silence_start: ([\d.]+)", output)
    ends   = re.findall(r"silence_end: ([\d.]+)", output)

    silences = []
    for i, start in enumerate(starts):
        entry: Dict[str, Any] = {"start": float(start)}
        if i < len(ends):
            entry["end"]      = float(ends[i])
            entry["duration"] = round(entry["end"] - entry["start"], 2)
        else:
            entry["end"] = entry["duration"] = None
        silences.append(entry)
    return silences


def _build_atempo(speed: float) -> str:
    if 0.5 <= speed <= 2.0:
        return f"atempo={speed}"
    elif speed < 0.5:
        return f"atempo=0.5,atempo={round(speed / 0.5, 4)}"
    else:
        return f"atempo=2.0,atempo={round(speed / 2.0, 4)}"


def apply_edits(
    input_path: str,
    segments: List[Dict],
    output_path: str,
    *,
    # 基础
    remove_audio: bool = False,
    transition: str = "none",
    speed: float = 1.0,
    # 色彩
    brightness: float = 0.0,
    contrast: float = 1.0,
    saturation: float = 1.0,
    color_preset: str = "none",
    # 画面
    hflip: bool = False,
    vflip: bool = False,
    rotate: int = 0,
    crop_ratio: Optional[str] = None,
    # 音频
    volume: float = 1.0,
    bgm_path: Optional[str] = None,
    bgm_volume: float = 0.5,
    # 导出
    quality: str = "medium",
) -> None:
    if not segments:
        raise ValueError("segments_to_keep 不能为空")

    info = get_media_info(input_path)
    is_audio_only = not info["has_video"]
    fade_dur = 0.3
    crf = QUALITY_CRF.get(quality, 23)

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        # ── 步骤1：逐段裁剪（处理速度 + 淡入淡出） ──────────────────────────
        segment_files: List[Path] = []
        for i, seg in enumerate(segments):
            ext = ".mp3" if is_audio_only else ".mp4"
            seg_path = tmp_dir / f"seg_{i:04d}{ext}"
            seg_dur = seg["end"] - seg["start"]

            vf_parts: List[str] = []
            af_parts: List[str] = []

            if speed != 1.0 and not is_audio_only:
                vf_parts.append(f"setpts={round(1 / speed, 4)}*PTS")
            if speed != 1.0:
                af_parts.append(_build_atempo(speed))

            if transition == "fade" and seg_dur > fade_dur * 2:
                fade_out_st = round(seg_dur / speed - fade_dur, 3)
                if not is_audio_only:
                    vf_parts.append(f"fade=t=in:st=0:d={fade_dur},fade=t=out:st={fade_out_st}:d={fade_dur}")
                af_parts.append(f"afade=t=in:st=0:d={fade_dur},afade=t=out:st={fade_out_st}:d={fade_dur}")

            cmd = ["ffmpeg", "-y", "-ss", str(seg["start"]), "-to", str(seg["end"]), "-i", input_path]

            if is_audio_only:
                if af_parts:
                    cmd += ["-af", ",".join(af_parts)]
                cmd += ["-q:a", "2"]
            else:
                if vf_parts:
                    cmd += ["-vf", ",".join(vf_parts)]
                if remove_audio:
                    cmd += ["-an"]
                elif af_parts:
                    cmd += ["-af", ",".join(af_parts)]
                cmd += ["-c:v", "libx264", f"-crf", str(crf), "-preset", "fast"]
                if not remove_audio:
                    cmd += ["-c:a", "aac"]

            cmd.append(str(seg_path))
            subprocess.run(cmd, capture_output=True, check=True)
            segment_files.append(seg_path)

        # ── 步骤2：拼接片段 ───────────────────────────────────────────────────
        concat_path = tmp_dir / f"concat{'.mp3' if is_audio_only else '.mp4'}"
        if len(segment_files) == 1:
            shutil.copy(segment_files[0], concat_path)
        else:
            list_file = tmp_dir / "filelist.txt"
            list_file.write_text(
                "\n".join(f"file '{p.as_posix()}'" for p in segment_files)
            )
            subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(list_file), "-c", "copy", str(concat_path)],
                capture_output=True, check=True,
            )

        if is_audio_only:
            _apply_audio_global(str(concat_path), output_path, volume=volume)
            return

        # ── 步骤3：全局视频/音频效果 ──────────────────────────────────────────
        global_vf: List[str] = []
        global_af: List[str] = []

        # 翻转 / 旋转
        if hflip:
            global_vf.append("hflip")
        if vflip:
            global_vf.append("vflip")
        rotate_map = {90: "transpose=1", 180: "transpose=1,transpose=1", 270: "transpose=2"}
        if rotate in rotate_map:
            global_vf.append(rotate_map[rotate])

        # 比例裁剪（模糊背景）
        if crop_ratio and crop_ratio in CROP_SIZES:
            global_vf.append(_build_crop_filter(crop_ratio))

        # 色彩
        if color_preset and color_preset != "none":
            preset = COLOR_PRESETS.get(color_preset)
            if preset:
                global_vf.append(preset)
        elif any([brightness != 0, contrast != 1.0, saturation != 1.0]):
            eq_parts = []
            if brightness != 0:   eq_parts.append(f"brightness={brightness:.3f}")
            if contrast  != 1.0:  eq_parts.append(f"contrast={contrast:.2f}")
            if saturation != 1.0: eq_parts.append(f"saturation={saturation:.2f}")
            global_vf.append(f"eq={':'.join(eq_parts)}")

        # 音量
        if volume != 1.0 and not remove_audio:
            global_af.append(f"volume={volume:.2f}")

        needs_effects = bool(global_vf or global_af)
        has_bgm = bool(bgm_path)
        effect_out = str(tmp_dir / "effected.mp4") if has_bgm else output_path

        if needs_effects:
            cmd = ["ffmpeg", "-y", "-i", str(concat_path)]
            if global_vf:
                cmd += ["-vf", ",".join(global_vf)]
            if global_af:
                cmd += ["-af", ",".join(global_af)]
            cmd += ["-c:v", "libx264", f"-crf", str(crf), "-preset", "fast"]
            cmd += ["-c:a", "aac"] if (not remove_audio and global_af) else ["-c:a", "copy"] if not remove_audio else ["-an"]
            cmd.append(effect_out)
            subprocess.run(cmd, capture_output=True, check=True)
        else:
            if has_bgm:
                shutil.copy(str(concat_path), effect_out)
            else:
                shutil.copy(str(concat_path), output_path)
                return

        # ── 步骤4：混合背景音乐 ────────────────────────────────────────────────
        if has_bgm:
            _mix_bgm(effect_out, output_path, bgm_path, bgm_volume, remove_audio)

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _build_crop_filter(ratio: str) -> str:
    """生成带模糊背景的比例裁剪滤镜（使用 split + overlay）"""
    w, h = CROP_SIZES[ratio]
    # 使用 scale + pad 方案（更兼容）
    return (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
    )


def _apply_audio_global(input_path: str, output_path: str, volume: float = 1.0) -> None:
    if volume == 1.0:
        shutil.copy(input_path, output_path)
        return
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-af", f"volume={volume:.2f}", "-q:a", "2", output_path],
        capture_output=True, check=True,
    )


def _mix_bgm(
    video_path: str,
    output_path: str,
    bgm_path: str,
    bgm_volume: float,
    remove_original_audio: bool,
) -> None:
    """为视频混入背景音乐，支持原声保留或替换"""
    if remove_original_audio:
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-stream_loop", "-1", "-i", bgm_path,
            "-map", "0:v", "-map", "1:a",
            "-af", f"volume={bgm_volume:.2f}",
            "-shortest", "-c:v", "copy", "-c:a", "aac",
            output_path,
        ]
    else:
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-stream_loop", "-1", "-i", bgm_path,
            "-filter_complex",
            f"[0:a]volume=1.0[a1];[1:a]volume={bgm_volume:.2f}[a2];[a1][a2]amix=inputs=2:duration=first[aout]",
            "-map", "0:v", "-map", "[aout]",
            "-shortest", "-c:v", "copy", "-c:a", "aac",
            output_path,
        ]
    subprocess.run(cmd, capture_output=True, check=True)
