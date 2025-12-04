import '@src/Options.css';
import { useEffect, useMemo, useState } from 'react';
import { PROJECT_URL_OBJECT, useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { aiSettingsStorage, exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';

const Options = () => {
  const themeState = useStorage(exampleThemeStorage);
  const settings = useStorage(aiSettingsStorage);
  const [draftApiKey, setDraftApiKey] = useState(settings.apiKey);
  const [draftBaseUrl, setDraftBaseUrl] = useState(settings.baseUrl);
  const [includeContext, setIncludeContext] = useState(settings.includeContextByDefault);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftApiKey(settings.apiKey);
    setDraftBaseUrl(settings.baseUrl);
    setIncludeContext(settings.includeContextByDefault);
  }, [settings]);

  const hasChanges = useMemo(() => {
    return (
      draftApiKey !== settings.apiKey ||
      draftBaseUrl !== settings.baseUrl ||
      includeContext !== settings.includeContextByDefault
    );
  }, [draftApiKey, draftBaseUrl, includeContext, settings]);

  const saveSettings = async () => {
    setSaving(true);
    await aiSettingsStorage.update({
      apiKey: draftApiKey.trim(),
      baseUrl: draftBaseUrl.trim(),
      includeContextByDefault: includeContext,
    });
    setSaving(false);
  };

  const resetSettings = async () => {
    setSaving(true);
    await aiSettingsStorage.reset();
    setSaving(false);
  };

  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);

  return (
    <div className={cn('options-shell', themeState.isLight ? 'bg-slate-50 text-gray-900' : 'bg-gray-900 text-gray-50')}>
      <div className="options-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">AI Chat 设置</h1>
            <p className="text-sm text-slate-500">配置 API Key、Base URL 与默认上下文策略。</p>
          </div>
          <button onClick={goGithubSite}>
            <img
              src={chrome.runtime.getURL(themeState.isLight ? 'options/logo_horizontal.svg' : 'options/logo_horizontal_dark.svg')}
              className="h-10"
              alt="logo"
            />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-600">
            Base URL
            <input
              className="options-input"
              placeholder="https://api.example.com"
              value={draftBaseUrl}
              onChange={e => setDraftBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </label>

          <label className="block text-sm font-medium text-slate-600">
            API Key
            <input
              className="options-input"
              type="password"
              placeholder="sk-..."
              value={draftApiKey}
              onChange={e => setDraftApiKey(e.target.value)}
              spellCheck={false}
            />
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={e => setIncludeContext(e.target.checked)}
            />
            默认发送页面上下文（基于 Readability/readabilipy）
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button className="options-primary" onClick={saveSettings} disabled={!hasChanges || saving}>
            {saving ? '保存中...' : '保存设置'}
          </button>
          <button className="options-ghost" onClick={resetSettings} disabled={saving}>
            重置
          </button>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            <span>主题</span>
            <ToggleButton onClick={exampleThemeStorage.toggle}>{themeState.isLight ? 'Light' : 'Dark'}</ToggleButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
