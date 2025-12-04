import 'webextension-polyfill';
import { exampleThemeStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
});

const toggleContentSidebar = async (tabId?: number) => {
  if (!tabId) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AI_CHAT_TOGGLE' });
  } catch (error) {
    console.warn('AI sidebar toggle failed', error);
  }
};

chrome.action.onClicked.addListener(tab => {
  toggleContentSidebar(tab.id);
});

console.log('Background loaded');
