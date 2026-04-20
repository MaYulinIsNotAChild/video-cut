import json
import os
import re
from typing import Any, Dict, List, Optional

from openai import OpenAI

PLATFORM_PRESETS: Dict[str, Dict] = {
    "抖音":  {"max_duration": 60,  "aspect_ratio": "9:16",       "style": "强开头（前3秒抓眼球）、节奏快、有反转或高潮"},
    "小红书": {"max_duration": 90,  "aspect_ratio": "9:16 或 4:5", "style": "生活化、真实感、有质感画面、节奏轻松"},
    "快手":  {"max_duration": 60,  "aspect_ratio": "9:16",       "style": "接地气、互动感强、真实生活场景"},
}


def get_editing_plan(
    media_info: Dict[str, Any],
    silences: List[Dict],
    user_description: str,
    platform: str,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
    preset = PLATFORM_PRESETS.get(platform, PLATFORM_PRESETS["抖音"])
    duration = media_info.get("duration", 0)
    is_audio_only = not media_info.get("has_video", True)
    silence_total = sum(s.get("duration") or 0 for s in silences)
    active_duration = duration - silence_total

    silence_desc = "\n".join(
        f"  - {s['start']:.1f}s ~ {s['end']:.1f}s ({s['duration']:.1f}s)"
        for s in silences[:30]
        if s.get("end") and s.get("duration")
    ) or "  none"

    media_type = "audio-only" if is_audio_only else "video"

    prompt = f"""You are a professional short-video editor. Produce an editing plan for the {media_type} below.

## Media Metadata
- Type: {media_type}
- Total duration: {duration:.1f}s
{f"- Resolution: {media_info.get('width','?')}x{media_info.get('height','?')}" if not is_audio_only else ""}
- Has audio: {media_info.get('has_audio', False)}
- Active content duration (excluding silence): ~{active_duration:.1f}s

## Detected Silent Segments
{silence_desc}

## Target Platform: {platform}
- Recommended max duration: {preset['max_duration']}s
- Aspect ratio: {preset['aspect_ratio']}
- Style: {preset['style']}

## User Request
{user_description.strip() if user_description.strip() else 'Auto-optimize for the target platform.'}

Return ONLY valid JSON:
{{
  "segments_to_keep": [{{"start": 0.0, "end": 5.2}}, ...],
  "estimated_duration": 15.0,
  "suggestions": ["Chinese tip 1", "Chinese tip 2"],
  "notes": "brief explanation in Chinese"
}}

Rules:
1. segments_to_keep sorted by start time, non-overlapping, within [0, {duration:.1f}].
2. Remove all detected silent segments unless user says otherwise.
3. Total duration ≤ {preset['max_duration']}s.
4. Start with a hook — first segment should grab attention immediately."""

    response = client.chat.completions.create(
        model="gpt-5.4-mini",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=1024,
    )

    raw = response.choices[0].message.content.strip()
    match = re.search(r"\{[\s\S]+\}", raw)
    if not match:
        raise ValueError(f"模型返回无法解析为 JSON: {raw[:200]}")

    plan = json.loads(match.group())
    plan["segments_to_keep"] = [
        {"start": round(max(0.0, seg["start"]), 2),
         "end":   round(min(float(duration), seg["end"]), 2)}
        for seg in plan.get("segments_to_keep", [])
        if seg.get("end", 0) > seg.get("start", 0)
    ]
    return plan


def get_slideshow_plan(
    photo_count: int,
    user_description: str,
    platform: str,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
    preset = PLATFORM_PRESETS.get(platform, PLATFORM_PRESETS["抖音"])

    prompt = f"""You are a professional short-video editor. Help design a photo slideshow.

## Info
- Number of photos: {photo_count}
- Target platform: {platform}
- Platform max duration: {preset['max_duration']}s
- Platform style: {preset['style']}

## User Request
{user_description.strip() if user_description.strip() else 'Auto-optimize for the target platform.'}

Return ONLY valid JSON:
{{
  "duration_per_photo": 3.0,
  "transition": "fade",
  "effect": "kenburns",
  "suggestions": ["Chinese tip 1", "Chinese tip 2"],
  "notes": "brief explanation in Chinese"
}}

Rules:
- duration_per_photo: 1.5–6s based on vibe (fast-paced=1.5-2s, normal=3s, cinematic=4-6s)
- transition: "fade" | "wipe" | "zoom" | "slide" | "none"
- effect: "kenburns" for dynamic feel, "none" for clean static
- {photo_count} photos × duration_per_photo should be ≤ {preset['max_duration']}s"""

    response = client.chat.completions.create(
        model="gpt-5.4-mini",
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=512,
    )

    raw = response.choices[0].message.content.strip()
    match = re.search(r"\{[\s\S]+\}", raw)
    if not match:
        raise ValueError(f"模型返回无法解析为 JSON: {raw[:200]}")
    return json.loads(match.group())
