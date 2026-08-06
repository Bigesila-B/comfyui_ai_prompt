import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const widgetValue = (node, name) => node.widgets?.find((widget) => widget.name === name)?.value;
const labels = {
    provider: "接口类型", url: "模型地址", api_key: "密钥", model: "模型 ID",
    system_template: "系统提示词", question: "向大模型提问", result: "生成结果（可修改）",
    vision: "启用识图", encode_clip: "输出条件", direct_mode: "直连模式",
};

const installResizableText = (nodeType, minHeight, resizeTextareas) => {
    const originalResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
        originalResize?.apply(this, arguments);
        if (size[1] < minHeight) {
            size[1] = minHeight;
            this.size[1] = minHeight;
        }
        resizeTextareas(this, size);
    };
};

const setWidgetHeight = (widget, height, bottomGap = 0) => {
    if (!widget) return;
    widget.computeSize = (width) => [width, height + bottomGap];
    if (widget.inputEl) {
        widget.inputEl.style.height = `${height}px`;
        widget.inputEl.style.minHeight = "0";
        widget.inputEl.style.maxHeight = `${height}px`;
        widget.inputEl.style.resize = "none";
        widget.inputEl.style.boxSizing = "border-box";
    }
};

app.registerExtension({
    name: "ai-prompt.controls",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "AIPromptTemplate") {
            installResizableText(nodeType, 210, (node, size) => {
                const widget = node.widgets?.find((item) => item.name === "template");
                setWidgetHeight(widget, Math.max(80, size[1] - 115));
            });
            const originalTemplateCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                originalTemplateCreated?.apply(this, arguments);
                const noteWidget = this.widgets?.find((widget) => widget.name === "note");
                const templateWidget = this.widgets?.find((widget) => widget.name === "template");
                if (noteWidget) noteWidget.label = "备注";
                if (templateWidget) templateWidget.label = "系统提示词模板";
                if (templateWidget?.inputEl) {
                    templateWidget.inputEl.style.minHeight = "0";
                    templateWidget.inputEl.style.resize = "none";
                }
                this.setSize([Math.max(this.size[0], 400), Math.max(this.size[1], 420)]);
            };
            return;
        }
        if (nodeData.name !== "AIChatPrompt") return;

        installResizableText(nodeType, 620, (node, size) => {
            const widget = node.widgets?.find((item) => item.name === "result");
            setWidgetHeight(widget, Math.max(120, size[1] - 524), 24);
        });

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);

            for (const widget of this.widgets || []) {
                if (labels[widget.name]) widget.label = labels[widget.name];
            }
            const resultWidget = this.widgets?.find((widget) => widget.name === "result");
            if (resultWidget?.inputEl) {
                resultWidget.inputEl.style.minHeight = "0";
                resultWidget.inputEl.style.resize = "none";
            }
            const generateButton = this.addWidget("button", "生成提示词", null, async () => {
                generateButton.name = "正在生成...";
                try {
                    const response = await api.fetchApi("/ai-prompt/chat", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            provider: widgetValue(this, "provider"),
                            url: widgetValue(this, "url"),
                            api_key: widgetValue(this, "api_key"),
                            model: widgetValue(this, "model"),
                            system_template: widgetValue(this, "system_template"),
                            question: widgetValue(this, "question"),
                            vision: false,
                        }),
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                    resultWidget.value = data.response;
                } catch (error) {
                    resultWidget.value = error.message;
                } finally {
                    generateButton.name = "生成提示词";
                    this.setDirtyCanvas(true, true);
                }
            });
            generateButton.serialize = false;
            this.setSize([Math.max(this.size[0], 420), Math.max(this.size[1], 760)]);
        };
    },
});
