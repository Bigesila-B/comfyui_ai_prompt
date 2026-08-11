import base64
import mimetypes
from pathlib import Path

from aiohttp import web

from .api_client import ChatRequest, send_chat


def _image_data_url(filename):
    if not filename:
        return None
    import folder_paths

    image_path = Path(folder_paths.get_annotated_filepath(str(filename)))
    if not image_path.is_file():
        raise ValueError(f"找不到已上传的图片：{filename}")
    media_type = mimetypes.guess_type(image_path.name)[0] or "image/png"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def image_data_urls(filenames):
    if not isinstance(filenames, list):
        return []
    return [
        filename if str(filename).startswith("data:image/") else _image_data_url(filename)
        for filename in filenames
        if filename
    ]


def _request_from_json(data):
    return ChatRequest(
        provider=str(data.get("provider", "OpenAI Responses")),
        url=str(data.get("url", "")),
        api_key=str(data.get("api_key", "")),
        model=str(data.get("model", "")),
        system=str(data.get("system_template", "")),
        question=str(data.get("question", "")),
        image_data_urls=image_data_urls(data.get("images", [])),
    )


async def instant_chat(request):
    try:
        data = await request.json()
        result = send_chat(_request_from_json(data))
        return web.json_response({"response": result})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)


def register_routes():
    try:
        from server import PromptServer
    except ImportError:
        return

    PromptServer.instance.routes.post("/ai-prompt/chat")(instant_chat)


register_routes()
