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
                "encode_clip": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "开启后，会使用连接到 clip 输入端的 CLIP 模型，把最终 result 文本编码为 CONDITIONING，并从 conditioning 输出端提供给 KSampler 的 positive 或 negative。若未连接 CLIP，开启后运行会报错。关闭时仍会正常输出 response 文本，但 conditioning 不会包含可用条件。",
                }),
                "direct_mode": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "开启后，每次运行 ComfyUI 工作流都会重新请求语言模型，并用新响应继续执行，即使 result 已有内容。关闭时优先复用可编辑的 result；只有 result 为空时才请求模型。需要先审查或手动修改提示词时建议关闭。",
                }),
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
