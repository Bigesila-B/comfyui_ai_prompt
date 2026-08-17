import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const widgetValue = (node, name) => node?.widgets?.find((widget) => widget.name === name)?.value
    ?? node?.inputs?.find((input) => input.name === name || input.widget?.name === name)?._widget?.value;
const graphLink = (graph, linkId) => {
    const links = graph?.links;
    if (linkId == null || !links) return null;
    return graph.getLink?.(linkId)
        ?? (typeof links.get === "function" ? links.get(linkId) : links[linkId])
        ?? null;
};
const connectedNode = (node, inputName) => {
    const graph = node.graph ?? app.graph;
    const input = node.inputs?.find((item) => item.name === inputName);
    const link = graphLink(graph, input?.link);
    const originId = link?.origin_id ?? link?.originId;
    return originId == null ? null : graph?.getNodeById(originId);
};
const connectedWidgetValue = (node, inputName, widgetName) => {
    const source = connectedNode(node, inputName);
    return source ? widgetValue(source, widgetName) : undefined;
};
const labels = {
    provider: "接口类型", url: "模型地址", api_key: "密钥", model: "模型 ID",
    system_template: "系统提示词", question: "向大模型提问", result: "生成结果（可修改）",
    encode_clip: "encode_clip（开启后用 CLIP 编码生成结果）",
    direct_mode: "direct_mode（开启后运行工作流时重新请求模型）",
};
const tooltips = {
    encode_clip: "开启后，会使用连接到 clip 输入端的 CLIP 模型，把最终 result 文本编码为 CONDITIONING，并从 conditioning 输出端提供给 KSampler 的 positive 或 negative。若未连接 CLIP，开启后运行会报错。关闭时仍会正常输出 response 文本，但 conditioning 不会包含可用条件。",
    direct_mode: "开启后，每次运行 ComfyUI 工作流都会重新请求语言模型，并用新响应继续执行，即使 result 已有内容。关闭时优先复用可编辑的 result；只有 result 为空时才请求模型。需要先审查或手动修改提示词时建议关闭。",
};

const parseImages = (value) => {
    try {
        const images = JSON.parse(value || "[]");
        return Array.isArray(images) ? images : [];
    } catch {
        return [];
    }
};

const fetchWithTimeout = async (url, options, timeout = 130000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await api.fetchApi(url, {...options, signal: controller.signal});
    } catch (error) {
        if (error.name === "AbortError") throw new Error("请求超时：请检查模型服务是否正常运行，或缩小图片后重试");
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

const previewUrl = (path) => {
    if (path.startsWith("data:image/")) return path;
    const cleanPath = path.replace(/ \[(input|output|temp)\]$/, "");
    const slash = cleanPath.lastIndexOf("/");
    const params = new URLSearchParams({
        filename: slash >= 0 ? cleanPath.slice(slash + 1) : cleanPath,
        subfolder: slash >= 0 ? cleanPath.slice(0, slash) : "",
        type: "input",
    });
    return api.apiURL(`/view?${params}`);
};

const removeLegacyVisionWidget = (node) => {
    let index = node.widgets?.findIndex((widget) => widget.name === "vision") ?? -1;
    while (index >= 0) {
        const widget = node.widgets[index];
        widget.onRemove?.();
        widget.inputEl?.remove();
        node.widgets.splice(index, 1);
        index = node.widgets.findIndex((item) => item.name === "vision");
    }
};

const hideWidget = (widget) => {
    if (!widget || widget.type === "converted-widget") return;
    widget.origType = widget.type;
    widget.origComputeSize = widget.computeSize;
    widget.type = "converted-widget";
    widget.computeSize = () => [0, -4];
    widget.serializeValue = async () => widget.value;
    widget.hidden = true;
    if (widget.inputEl?.style) widget.inputEl.style.display = "none";
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

const resizeImageUploadWidget = (widget, width) => {
    if (!widget) return;
    widget.computeSize = () => [Math.max(1, width - 20), 148];
    const element = widget.element ?? widget.domElement ?? widget.el;
    for (const target of [element, element?.firstElementChild]) {
        if (!target?.style) continue;
        target.style.width = "100%";
        target.style.maxWidth = "100%";
        target.style.minWidth = "0";
        target.style.boxSizing = "border-box";
        target.style.overflow = "hidden";
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

        installResizableText(nodeType, 760, (node, size) => {
            const widget = node.widgets?.find((item) => item.name === "result");
            const uploadWidget = node.widgets?.find((item) => item.name === "image_uploads");
            setWidgetHeight(widget, Math.max(120, size[1] - 690), 28);
            resizeImageUploadWidget(uploadWidget, size[0]);
            requestAnimationFrame(() => {
                resizeImageUploadWidget(uploadWidget, node.size[0]);
                node.setDirtyCanvas?.(true, true);
            });
        });

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            removeLegacyVisionWidget(this);

            for (const widget of this.widgets || []) {
                if (labels[widget.name]) widget.label = labels[widget.name];
                if (tooltips[widget.name]) widget.tooltip = tooltips[widget.name];
            }
            const resultWidget = this.widgets?.find((widget) => widget.name === "result");
            const imagesWidget = this.widgets?.find((widget) => widget.name === "images");
            hideWidget(imagesWidget);
            if (resultWidget?.inputEl) {
                resultWidget.inputEl.style.minHeight = "0";
                resultWidget.inputEl.style.resize = "none";
            }

            const uploadPanel = document.createElement("div");
            uploadPanel.style.cssText = [
                "display:flex", "flex-direction:column", "gap:8px", "width:100%",
                "max-width:100%", "min-width:0", "padding:5px 10px", "border:1px solid #555",
                "border-radius:8px", "background:#202020", "color:#ddd",
                "box-sizing:border-box", "overflow:hidden", "position:relative", "z-index:2",
                "pointer-events:auto",
            ].join(";");
            const toolbar = document.createElement("div");
            toolbar.style.cssText = [
                "display:grid", "grid-template-columns:minmax(0,1fr) auto auto",
                "align-items:center", "gap:6px", "width:100%", "max-width:100%",
                "min-width:0", "padding-right:8px", "box-sizing:border-box",
                "position:relative", "z-index:3", "pointer-events:auto",
            ].join(";");
            const status = document.createElement("span");
            status.style.cssText = "min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
            const addButton = document.createElement("button");
            addButton.type = "button";
            addButton.textContent = "添加图片";
            const clearButton = document.createElement("button");
            clearButton.type = "button";
            clearButton.textContent = "清空";
            for (const button of [addButton, clearButton]) {
                button.style.cssText = [
                    "display:inline-flex", "align-items:center", "justify-content:center",
                    "min-width:0", "height:30px", "box-sizing:border-box", "padding:4px 8px",
                    "border:1px solid #666", "border-radius:5px", "background:#333", "color:#eee",
                    "cursor:pointer", "position:relative", "z-index:4", "pointer-events:auto",
                ].join(";");
            }
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = "image/*";
            fileInput.multiple = true;
            fileInput.style.display = "none";
            const previews = document.createElement("div");
            previews.style.cssText = [
                "display:flex", "gap:7px", "width:100%", "max-width:100%", "min-width:0",
                "height:84px", "overflow-x:auto", "overflow-y:hidden", "align-items:center",
                "border:1px dashed #666", "border-radius:7px", "padding:6px",
                "box-sizing:border-box", "transition:border-color .15s,background .15s",
            ].join(";");
            toolbar.append(status, addButton, clearButton);
            uploadPanel.append(toolbar, previews, fileInput);
            const uploadWidget = this.addDOMWidget("image_uploads", "div", uploadPanel, { serialize: false });
            resizeImageUploadWidget(uploadWidget, this.size[0]);

            const renderImages = () => {
                const images = parseImages(imagesWidget?.value);
                status.textContent = images.length ? `已选择 ${images.length} 张图片` : "点击添加，或将图片拖到虚线框内";
                previews.replaceChildren();
                for (const path of images) {
                    const image = document.createElement("img");
                    image.src = previewUrl(path);
                    image.title = path;
                    image.style.cssText = "width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #555;flex:none;";
                    previews.append(image);
                }
            };
            const setImages = (images) => {
                if (!imagesWidget) return;
                const oldValue = imagesWidget.value;
                imagesWidget.value = JSON.stringify(images);
                imagesWidget.callback?.(imagesWidget.value);
                this.onWidgetChanged?.(imagesWidget.name, imagesWidget.value, oldValue, imagesWidget);
                renderImages();
                this.setDirtyCanvas(true, true);
            };
            const processFiles = async (fileList) => {
                const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
                if (!files.length) {
                    status.textContent = "没有检测到可用图片";
                    return;
                }
                addButton.disabled = true;
                try {
                    const prepared = [];
                    for (let index = 0; index < files.length; index += 1) {
                        status.textContent = `正在处理图片 ${index + 1}/${files.length}...`;
                        const form = new FormData();
                        form.append("image", files[index], files[index].name);
                        form.append("type", "input");
                        form.append("overwrite", "false");
                        const response = await fetchWithTimeout("/upload/image", {
                            method: "POST",
                            body: form,
                        });
                        const uploaded = await response.json();
                        if (!response.ok || !uploaded.name) {
                            throw new Error(uploaded.error || `图片上传失败：HTTP ${response.status}`);
                        }
                        const path = uploaded.subfolder
                            ? `${uploaded.subfolder}/${uploaded.name}`
                            : uploaded.name;
                        prepared.push(`${path} [${uploaded.type || "input"}]`);
                    }
                    setImages([...parseImages(imagesWidget?.value), ...prepared]);
                } catch (error) {
                    status.textContent = `图片处理失败：${error.message}`;
                } finally {
                    addButton.disabled = false;
                }
            };
            fileInput.onchange = () => {
                processFiles(fileInput.files);
                fileInput.value = "";
            };
            for (const element of [addButton, clearButton]) {
                element.onpointerdown = (event) => event.stopPropagation();
            }
            addButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                fileInput.click();
            };
            uploadPanel.ondragover = (event) => {
                event.preventDefault();
                event.stopPropagation();
                previews.style.borderColor = "#8ab4f8";
                previews.style.background = "rgba(138,180,248,.12)";
                status.textContent = "松开鼠标即可添加图片";
            };
            uploadPanel.ondragleave = (event) => {
                event.preventDefault();
                previews.style.borderColor = "#666";
                previews.style.background = "transparent";
                renderImages();
            };
            uploadPanel.ondrop = (event) => {
                event.preventDefault();
                event.stopPropagation();
                previews.style.borderColor = "#666";
                previews.style.background = "transparent";
                processFiles(event.dataTransfer?.files);
            };
            clearButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                setImages([]);
            };
            for (const type of ["mousedown", "mouseup", "click", "auxclick", "dblclick"]) {
                uploadPanel.addEventListener(type, (event) => event.stopPropagation());
            }
            uploadPanel.addEventListener("dblclick", (event) => event.preventDefault());
            renderImages();

            const originalConfigure = this.onConfigure;
            this.onConfigure = function () {
                originalConfigure?.apply(this, arguments);
                queueMicrotask(() => {
                    removeLegacyVisionWidget(this);
                    hideWidget(this.widgets?.find((widget) => widget.name === "images"));
                    renderImages();
                    this.setDirtyCanvas(true, true);
                });
            };

            const generateButton = this.addWidget("button", "生成提示词", null, async () => {
                generateButton.name = "正在生成...";
                try {
                    const connectedImage = widgetValue(connectedNode(this, "image"), "image");
                    const images = parseImages(imagesWidget?.value);
                    if (connectedImage && !images.includes(connectedImage)) images.unshift(connectedImage);
                    const response = await fetchWithTimeout("/ai-prompt/chat", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            provider: widgetValue(this, "provider"),
                            url: widgetValue(this, "url"),
                            api_key: widgetValue(this, "api_key"),
                            model: widgetValue(this, "model"),
                            system_template: connectedWidgetValue(this, "system_template", "template")
                                ?? widgetValue(this, "system_template")
                                ?? "",
                            question: widgetValue(this, "question") || "",
                            images,
                        }),
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                    if (resultWidget) resultWidget.value = data.response;
                } catch (error) {
                    if (resultWidget) resultWidget.value = error.message;
                } finally {
                    generateButton.name = "生成提示词";
                    this.setDirtyCanvas(true, true);
                }
            });
            generateButton.serialize = false;
            generateButton.computeSize = (width) => [width, 32];
            this.setSize([Math.max(this.size[0], 460), Math.max(this.size[1], 940)]);
        };
    },
});
