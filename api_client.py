import base64
import io
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np
import requests
from PIL import Image


PROVIDERS = ("OpenAI Responses", "OpenAI Chat", "Anthropic Messages", "LM Studio Compatible")
DEFAULT_URLS = {
    "OpenAI Responses": "https://api.openai.com/v1",
    "OpenAI Chat": "https://api.openai.com/v1",
    "Anthropic Messages": "https://api.anthropic.com/v1",
    "LM Studio Compatible": "http://127.0.0.1:1234/v1",
}


@dataclass(frozen=True)
class ChatRequest:
    provider: str
    url: str
    api_key: str
    model: str
    system: str
    question: str
    vision: bool = False
    image_data_url: Optional[str] = None


def tensor_to_data_url(image: Any) -> Optional[str]:
    if image is None:
        return None
    array = image[0].detach().cpu().numpy() if hasattr(image, "detach") else np.asarray(image)[0]
    array = np.clip(array * 255.0, 0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _endpoint(provider: str, url: str) -> str:
    base = (url or DEFAULT_URLS[provider]).rstrip("/")
    if provider == "Anthropic Messages":
        suffix = "/messages"
    elif provider == "OpenAI Responses":
        suffix = "/responses"
    else:
        suffix = "/chat/completions"
    return base if base.endswith(suffix) else base + suffix


def _openai_payload(request: ChatRequest) -> dict[str, Any]:
    user_content: Any = request.question
    if request.vision and request.image_data_url:
        user_content = [
            {"type": "text", "text": request.question},
            {"type": "image_url", "image_url": {"url": request.image_data_url}},
        ]
    return {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system},
            {"role": "user", "content": user_content},
        ],
    }


def _responses_payload(request: ChatRequest) -> dict[str, Any]:
    user_content: list[dict[str, Any]] = [{"type": "input_text", "text": request.question}]
    if request.vision and request.image_data_url:
        user_content.append({"type": "input_image", "image_url": request.image_data_url})
    return {
        "model": request.model,
        "instructions": request.system,
        "input": [{"role": "user", "content": user_content}],
    }


def _anthropic_payload(request: ChatRequest) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": request.question}]
    if request.vision and request.image_data_url:
        header, encoded = request.image_data_url.split(",", 1)
        media_type = header.split(":", 1)[1].split(";", 1)[0]
        content.insert(0, {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": encoded},
        })
    return {
        "model": request.model,
        "max_tokens": 2048,
        "system": request.system,
        "messages": [{"role": "user", "content": content}],
    }


def send_chat(request: ChatRequest, timeout: float = 120.0) -> str:
    if request.provider not in PROVIDERS:
        raise ValueError(f"Unsupported provider: {request.provider}")
    if not request.model.strip():
        raise ValueError("Model is required")
    if not request.question.strip():
        raise ValueError("Question is required")

    if request.provider == "Anthropic Messages":
        headers = {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": request.api_key,
        }
        payload = _anthropic_payload(request)
    else:
        headers = {"content-type": "application/json"}
        if request.api_key:
            headers["authorization"] = f"Bearer {request.api_key}"
        payload = _responses_payload(request) if request.provider == "OpenAI Responses" else _openai_payload(request)

    try:
        response = requests.post(_endpoint(request.provider, request.url), headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        if request.provider == "Anthropic Messages":
            return "".join(item.get("text", "") for item in data.get("content", []) if item.get("type") == "text")
        if request.provider == "OpenAI Responses":
            if data.get("output_text"):
                return data["output_text"]
            return "".join(
                item.get("text", "")
                for output in data.get("output", [])
                for item in output.get("content", [])
                if item.get("type") == "output_text"
            )
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        message = str(exc)
        if request.api_key:
            message = message.replace(request.api_key, "***")
        raise RuntimeError(message) from None
