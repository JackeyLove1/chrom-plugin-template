import { Readability } from '@mozilla/readability';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStorage } from '@extension/shared';
import { aiSettingsStorage } from '@extension/storage';

type PageContext = {
  title: string;
  url: string;
  text: string;
  preview: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  usingContext: boolean;
};

type TooltipState = {
  text: string;
  x: number;
  y: number;
} | null;

type Attachment = {
  id: string;
  name: string;
  dataUrl: string;
};

const clampText = (value: string, limit = 1200) => value.replace(/\s+/g, ' ').trim().slice(0, limit);

const buildReadableContext = (): PageContext => {
  // Readability implements the same heuristics used by readabilipy to keep only the important nodes.
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const parsed = reader.parse();

  const textContent = parsed?.textContent?.trim() ?? '';
  const excerpt = parsed?.excerpt ?? '';
  const combined = textContent || excerpt || document.body.innerText;

  return {
    title: parsed?.title || document.title || '当前页面',
    url: location.href,
    text: combined,
    preview: clampText(combined),
  };
};

export default function App() {
  const settings = useStorage(aiSettingsStorage);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [includeContext, setIncludeContext] = useState(settings.includeContextByDefault);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [inlineApiKey, setInlineApiKey] = useState(settings.apiKey);
  const [inlineBaseUrl, setInlineBaseUrl] = useState(settings.baseUrl);
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectionMeta, setSelectionMeta] = useState('');
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setInlineApiKey(settings.apiKey);
    setInlineBaseUrl(settings.baseUrl);
    setIncludeContext(settings.includeContextByDefault);
  }, [settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const readable = buildReadableContext();
        setPageContext(readable);
      } catch (error) {
        console.warn('Failed to parse Readability content', error);
        const fallbackText = clampText(document.body.innerText || '');
        setPageContext({
          title: document.title || '当前页面',
          url: location.href,
          text: fallbackText,
          preview: fallbackText,
        });
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setTooltip(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setTooltip(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setTooltip({
        text,
        x: rect.left + rect.width / 2 + window.scrollX,
        y: rect.bottom + 6 + window.scrollY,
      });
      setSelectionMeta(text.slice(0, 120));
    };

    const clearTooltip = () => setTooltip(null);

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('keyup', handleSelection);
    document.addEventListener('mousedown', clearTooltip);
    document.addEventListener('scroll', clearTooltip, true);

    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('keyup', handleSelection);
      document.removeEventListener('mousedown', clearTooltip);
      document.removeEventListener('scroll', clearTooltip, true);
    };
  }, []);

  useEffect(() => {
    const onMessage = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (typeof message === 'object' && message !== null && (message as { type?: string }).type === 'AI_CHAT_TOGGLE') {
        setSidebarOpen(true);
        sendResponse?.({ ok: true });
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const contextPreview = useMemo(() => {
    if (!includeContext || !pageContext) return null;
    const { title, url, preview } = pageContext;
    return `${title}\n${url}\n${clampText(preview, 500)}`;
  }, [includeContext, pageContext]);

  const persistSettings = async () => {
    setSavingSettings(true);
    await aiSettingsStorage.update({
      apiKey: inlineApiKey.trim(),
      baseUrl: inlineBaseUrl.trim(),
      includeContextByDefault: includeContext,
    });
    setSavingSettings(false);
  };

  const handleSend = async (rawText?: string) => {
    const prompt = (rawText ?? input).trim();
    if (!prompt) return;

    const usingContext = includeContext && !!pageContext;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
      usingContext,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsSending(true);
    setSidebarOpen(true);

    const apiKey = (inlineApiKey || settings.apiKey).trim();
    const baseUrl = (inlineBaseUrl || settings.baseUrl).trim();
    const contextPayload = usingContext
      ? {
          ...pageContext!,
          attachments: attachments.map(file => ({ name: file.name, dataUrl: file.dataUrl })),
        }
      : null;

    const payload = {
      message: prompt,
      history: [...messagesRef.current, userMessage].slice(-6).map(m => ({
        role: m.role,
        content: m.content,
      })),
      context: contextPayload,
    };

    let assistantContent =
      '已记录你的问题，但还没有配置 API Key 与 Base URL。请先在侧边栏或 Options 页面填入后再试一次。';

    if (apiKey && baseUrl) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        assistantContent =
          data?.reply ||
          data?.message ||
          '对话已发送到你的模型，请根据后端返回结构调整取值字段。';
      } catch (error) {
        assistantContent = `请求失败: ${(error as Error).message}`;
      }
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: assistantContent,
      createdAt: Date.now(),
      usingContext: !!contextPayload,
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsSending(false);
  };

  const onTooltipAction = (intent: 'chat' | 'translate' | 'like') => {
    if (!tooltip?.text) return;

    const base = tooltip.text.trim();
    const prompt =
      intent === 'translate'
        ? `请把下面的文字翻译成中文并保留关键信息：\n${base}`
        : intent === 'like'
          ? `针对这段话给出一句鼓励或点赞：\n${base}`
          : base;

    setSidebarOpen(true);
    setTooltip(null);
    void handleSend(prompt);
  };

  const handleFileInput = (files: FileList | null) => {
    if (!files || !files.length) return;

    Array.from(files).slice(0, 3).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            dataUrl: String(reader.result),
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  };

  const toggleContext = () => setIncludeContext(prev => !prev);

  return (
    <>
      {tooltip && (
        <div
          className="pointer-events-auto fixed z-[2147483647]"
          style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-xl">
            <button
              className="px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => onTooltipAction('chat')}>
              Chat
            </button>
            <button
              className="border-l border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => onTooltipAction('translate')}>
              Translate
            </button>
            <button
              className="border-l border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => onTooltipAction('like')}>
              Like
            </button>
          </div>
        </div>
      )}

      <div className="fixed inset-0 z-[2147483646] pointer-events-none flex justify-end">
        {!sidebarOpen && (
          <button
            className="pointer-events-auto mt-16 mr-2 flex items-center gap-2 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-lg hover:shadow-xl"
            onClick={() => setSidebarOpen(true)}>
            AI Chat
          </button>
        )}

        {sidebarOpen && (
          <div className="pointer-events-auto flex h-full w-[420px] flex-col gap-3 border-l border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">AI Chat Sidebar</div>
                <div className="text-sm font-semibold text-slate-900">页面上下文 + 自定义请求</div>
              </div>
              <button
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-200"
                onClick={() => setSidebarOpen(false)}>
                关闭
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">页面上下文</div>
                  <button
                    className="text-xs font-medium text-sky-600 hover:text-sky-700"
                    onClick={toggleContext}>
                    {includeContext ? '移除上下文' : '重新附加'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">基于 Readability/readabilipy 提取有效信息。</p>
                <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-white/80 p-2 text-sm text-slate-700">
                  {pageContext ? (
                    <>
                      <div className="font-semibold text-slate-900">{pageContext.title}</div>
                      <div className="truncate text-xs text-slate-500">{pageContext.url}</div>
                      <div className="mt-1 max-h-24 overflow-hidden text-sm leading-relaxed text-slate-700">
                        {pageContext.preview || '暂无可用内容'}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500">正在提取页面信息...</div>
                  )}
                </div>

                {attachments.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-slate-600">附加图片上下文</div>
                    <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                      {attachments.map(item => (
                        <div
                          key={item.id}
                          className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                          <img src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
                          <button
                            className="absolute right-1 top-1 rounded-full bg-white/80 px-1 text-[10px] font-semibold text-slate-700 shadow"
                            onClick={() => removeAttachment(item.id)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium text-slate-700 hover:border-sky-400">
                  <span>上传图片作为上下文</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={event => handleFileInput(event.target.files)}
                  />
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">选择文件</span>
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/90 p-3">
                <div className="text-sm font-semibold text-slate-800">API 设置</div>
                <div className="mt-2 space-y-2">
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    placeholder="Base URL"
                    value={inlineBaseUrl}
                    onChange={e => setInlineBaseUrl(e.target.value)}
                    spellCheck={false}
                  />
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    type="password"
                    placeholder="API Key"
                    value={inlineApiKey}
                    onChange={e => setInlineApiKey(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={includeContext}
                      onChange={e => setIncludeContext(e.target.checked)}
                    />
                    默认附带上下文
                  </label>
                  <button
                    className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-sky-600 disabled:opacity-60"
                    onClick={persistSettings}
                    disabled={savingSettings}>
                    {savingSettings ? '保存中...' : '保存配置'}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/95 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">对话</div>
                    {selectionMeta && (
                      <div className="text-xs text-slate-500">选中片段：{selectionMeta}</div>
                    )}
                  </div>
                  {contextPreview && (
                    <div className="text-[10px] font-semibold uppercase text-slate-500">
                      Context On
                    </div>
                  )}
                </div>

                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-sm">
                  {messages.length === 0 && (
                    <div className="text-xs text-slate-500">
                      还没有消息。尝试选中文本后点击 Chat/Translate，或直接输入问题。
                    </div>
                  )}
                  {messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-1 rounded-lg p-2 ${
                        msg.role === 'user'
                          ? 'bg-white shadow-sm text-slate-900'
                          : 'bg-gradient-to-r from-sky-50 to-indigo-50 text-slate-800'
                      }`}>
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                        <span>{msg.role === 'user' ? 'You' : 'AI'}</span>
                        {msg.usingContext && <span className="text-[10px] text-sky-600">with context</span>}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    rows={3}
                    placeholder="输入你的问题，或在页面中选中文本后使用 Chat/Translate..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                  />
                  <button
                    className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow hover:shadow-lg disabled:opacity-60"
                    onClick={() => handleSend()}
                    disabled={isSending || !input.trim()}>
                    {isSending ? '生成中...' : '发送'}
                  </button>
                  {contextPreview && (
                    <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/70 p-2 text-[11px] text-slate-600">
                      将携带的上下文片段：
                      <div className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap text-[11px] leading-snug text-slate-700">
                        {contextPreview}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
