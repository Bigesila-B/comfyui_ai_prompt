from aiohttp import web

from .api_client import ChatRequest, send_chat


def _request_from_json(data):
    return ChatRequest(
        provider=str(data.get("provider", "OpenAI Responses")),
        url=str(data.get("url", "")),
        api_key=str(data.get("api_key", "")),
        model=str(data.get("model", "")),
        system=str(data.get("system_template", "")),
        question=str(data.get("question", "")),
        vision=bool(data.get("vision", False)),
        image_data_url=data.get("image_data_url"),
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
