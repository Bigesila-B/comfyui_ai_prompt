import json

from .api_client import ChatRequest, DEFAULT_URLS, PROVIDERS, send_chat
from .routes import image_data_urls


class AIPromptTemplate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "note": ("STRING", {"default": "提示词模板备注"}),
                "template": ("STRING", {"multiline": True, "default": "You are a precise image prompt assistant."}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("system_template",)
    FUNCTION = "render"
    CATEGORY = "AI 提示词"

    def render(self, note: str, template: str):
        return (template,)


class AIChatPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "provider": (PROVIDERS, {"default": "OpenAI Responses"}),
                "url": ("STRING", {"default": DEFAULT_URLS["OpenAI Responses"]}),
                "api_key": ("STRING", {"default": "", "password": True}),
                "model": ("STRING", {"default": "gpt-4o-mini"}),
                "system_template": ("STRING", {"multiline": True, "default": "You are a precise image prompt assistant."}),
                "question": ("STRING", {"multiline": True, "default": "Describe the image as a concise generation prompt."}),
                "result": ("STRING", {"multiline": True, "default": ""}),
                "encode_clip": ("BOOLEAN", {"default": False}),
                "direct_mode": ("BOOLEAN", {"default": False}),
                "images": ("STRING", {"default": "[]"}),
            },
            "optional": {"image": ("IMAGE",), "clip": ("CLIP",)},
        }

    RETURN_TYPES = ("STRING", "CONDITIONING")
    RETURN_NAMES = ("response", "conditioning")
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "AI 提示词"

    @classmethod
    def IS_CHANGED(cls, direct_mode=False, **kwargs):
        return float("nan") if direct_mode else False

    def execute(
        self,
        provider: str,
        url: str,
        api_key: str,
        model: str,
        system_template: str,
        question: str,
        result: str,
        encode_clip: bool,
        direct_mode: bool,
        images: str,
        image=None,
        clip=None,
    ):
        response = result.strip()
        if direct_mode or not response:
            try:
                image_sources = json.loads(images or "[]")
            except (json.JSONDecodeError, TypeError):
                image_sources = []
            response = send_chat(ChatRequest(
                provider=provider,
                url=url,
                api_key=api_key,
                model=model,
                system=system_template,
                question=question,
                image_data_urls=image_data_urls(image_sources),
            ))
        conditioning = None
        if encode_clip:
            if clip is None:
                raise ValueError("CLIP input is required when encode_clip is enabled")
            tokens = clip.tokenize(response)
            conditioning = clip.encode_from_tokens_scheduled(tokens)
        return (response, conditioning)


NODE_CLASS_MAPPINGS = {
    "AIPromptTemplate": AIPromptTemplate,
    "AIChatPrompt": AIChatPrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIPromptTemplate": "AI 提示词模板",
    "AIChatPrompt": "AI 提示词生成器",
}
