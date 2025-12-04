import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

export type AiSettings = {
  apiKey: string;
  baseUrl: string;
  includeContextByDefault: boolean;
};

const defaultSettings: AiSettings = {
  apiKey: '',
  baseUrl: '',
  includeContextByDefault: true,
};

const storage = createStorage<AiSettings>('ai-settings', defaultSettings, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type AiSettingsStorage = BaseStorageType<AiSettings> & {
  reset: () => Promise<void>;
  update: (updates: Partial<AiSettings>) => Promise<void>;
};

export const aiSettingsStorage: AiSettingsStorage = {
  ...storage,
  reset: async () => {
    await storage.set(defaultSettings);
  },
  update: async (updates: Partial<AiSettings>) => {
    await storage.set(current => ({
      ...current,
      ...updates,
    }));
  },
};
