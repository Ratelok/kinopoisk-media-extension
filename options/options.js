/**
 * Kinopoisk MediaStack Extension - Options Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    jellyseerrUrl: '',
    jellyseerrApiKey: '',
    jellyfinUrl: '',
    jellyfinApiKey: '',
    autoCheck: true,
    cacheTtlSec: 60
  };

  // Элементы формы
  const jellyseerrUrlInput = document.getElementById('jellyseerrUrl');
  const jellyseerrApiKeyInput = document.getElementById('jellyseerrApiKey');
  const jellyfinUrlInput = document.getElementById('jellyfinUrl');
  const jellyfinApiKeyInput = document.getElementById('jellyfinApiKey');
  const autoCheckInput = document.getElementById('autoCheck');
  const cacheTtlSecInput = document.getElementById('cacheTtlSec');

  const btnTestJellyseerr = document.getElementById('btnTestJellyseerr');
  const btnTestJellyfin = document.getElementById('btnTestJellyfin');
  const btnSave = document.getElementById('btnSave');

  const statusJellyseerr = document.getElementById('statusJellyseerr');
  const statusJellyfin = document.getElementById('statusJellyfin');
  const toast = document.getElementById('toast');

  // Переключение видимости ключей
  setupToggleEye('toggleJsKey', 'jellyseerrApiKey');
  setupToggleEye('toggleJfKey', 'jellyfinApiKey');

  function setupToggleEye(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  }

  function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 4000);
  }

  // Чтение настроек напрямую из storage
  function getStorageArea() {
    return (extApi && extApi.storage && extApi.storage.local) || (extApi && extApi.storage && extApi.storage.sync);
  }

  async function loadSettings() {
    const storage = getStorageArea();
    if (!storage) {
      console.warn('Storage API unavailable');
      return DEFAULT_SETTINGS;
    }

    return new Promise((resolve) => {
      try {
        storage.get(DEFAULT_SETTINGS, (items) => {
          resolve({ ...DEFAULT_SETTINGS, ...(items || {}) });
        });
      } catch (err) {
        console.error('Error getting settings:', err);
        resolve(DEFAULT_SETTINGS);
      }
    });
  }

  // Загрузка сохраненных настроек в форму
  try {
    const settings = await loadSettings();
    if (settings) {
      jellyseerrUrlInput.value = settings.jellyseerrUrl || '';
      jellyseerrApiKeyInput.value = settings.jellyseerrApiKey || '';
      jellyfinUrlInput.value = settings.jellyfinUrl || '';
      jellyfinApiKeyInput.value = settings.jellyfinApiKey || '';
      autoCheckInput.checked = settings.autoCheck !== false;
      cacheTtlSecInput.value = settings.cacheTtlSec || 60;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  // Универсальный тест Jellyseerr (сначала прямой вызов, затем через background)
  btnTestJellyseerr.addEventListener('click', async () => {
    const url = jellyseerrUrlInput.value.trim();
    const apiKey = jellyseerrApiKeyInput.value.trim();

    if (!url || !apiKey) {
      statusJellyseerr.className = 'connection-status err';
      statusJellyseerr.textContent = 'Укажите URL и API ключ';
      return;
    }

    statusJellyseerr.className = 'connection-status loading';
    statusJellyseerr.textContent = 'Проверка подключения...';
    btnTestJellyseerr.disabled = true;

    try {
      let res = null;
      // 1. Пробуем прямой вызов API
      if (globalThis.JellyseerrApi && globalThis.JellyseerrApi.testConnection) {
        try {
          res = await globalThis.JellyseerrApi.testConnection(url, apiKey);
        } catch (e) {
          console.warn('Direct testConnection failed, trying background:', e);
        }
      }

      // 2. Если прямой не сработал или нет модуля, пробуем background
      if (!res || !res.success) {
        res = await new Promise((resolve) => {
          extApi.runtime.sendMessage({
            action: 'TEST_CONNECTION',
            service: 'jellyseerr',
            url,
            apiKey
          }, (bgRes) => resolve(bgRes));
        });
      }

      if (res && res.success) {
        statusJellyseerr.className = 'connection-status ok';
        statusJellyseerr.textContent = `✓ Успешно подключено (версия: ${res.version})`;
      } else {
        statusJellyseerr.className = 'connection-status err';
        statusJellyseerr.textContent = `✗ Ошибка: ${res?.error || 'Сервер недоступен'}`;
      }
    } catch (err) {
      statusJellyseerr.className = 'connection-status err';
      statusJellyseerr.textContent = `✗ Ошибка: ${err.message}`;
    } finally {
      btnTestJellyseerr.disabled = false;
    }
  });

  // Универсальный тест Jellyfin (сначала прямой вызов, затем через background)
  btnTestJellyfin.addEventListener('click', async () => {
    const url = jellyfinUrlInput.value.trim();
    const apiKey = jellyfinApiKeyInput.value.trim();

    if (!url) {
      statusJellyfin.className = 'connection-status err';
      statusJellyfin.textContent = 'Укажите URL сервера Jellyfin';
      return;
    }

    statusJellyfin.className = 'connection-status loading';
    statusJellyfin.textContent = 'Проверка подключения...';
    btnTestJellyfin.disabled = true;

    try {
      let res = null;
      // 1. Пробуем прямой вызов API
      if (globalThis.JellyfinApi && globalThis.JellyfinApi.testConnection) {
        try {
          res = await globalThis.JellyfinApi.testConnection(url, apiKey);
        } catch (e) {
          console.warn('Direct Jellyfin test failed, trying background:', e);
        }
      }

      // 2. Fallback на background
      if (!res || !res.success) {
        res = await new Promise((resolve) => {
          extApi.runtime.sendMessage({
            action: 'TEST_CONNECTION',
            service: 'jellyfin',
            url,
            apiKey
          }, (bgRes) => resolve(bgRes));
        });
      }

      if (res && res.success) {
        statusJellyfin.className = 'connection-status ok';
        statusJellyfin.textContent = `✓ Успешно подключено (${res.serverName}, v${res.version})`;
      } else {
        statusJellyfin.className = 'connection-status err';
        statusJellyfin.textContent = `✗ Ошибка: ${res?.error || 'Сервер недоступен'}`;
      }
    } catch (err) {
      statusJellyfin.className = 'connection-status err';
      statusJellyfin.textContent = `✗ Ошибка: ${err.message}`;
    } finally {
      btnTestJellyfin.disabled = false;
    }
  });

  // Сохранение настроек (сохраняет напрямую в storage + уведомляет background)
  btnSave.addEventListener('click', async () => {
    const newSettings = {
      jellyseerrUrl: jellyseerrUrlInput.value.trim(),
      jellyseerrApiKey: jellyseerrApiKeyInput.value.trim(),
      jellyfinUrl: jellyfinUrlInput.value.trim(),
      jellyfinApiKey: jellyfinApiKeyInput.value.trim(),
      autoCheck: autoCheckInput.checked,
      cacheTtlSec: parseInt(cacheTtlSecInput.value, 10) || 60
    };

    btnSave.disabled = true;
    btnSave.textContent = 'Сохранение...';

    try {
      const storage = getStorageArea();
      if (!storage) {
        throw new Error('Storage API недоступно в данном браузере');
      }

      // 1. Сохраняем напрямую в storage
      await new Promise((resolve, reject) => {
        storage.set(newSettings, () => {
          if (extApi.runtime.lastError) {
            return reject(extApi.runtime.lastError);
          }
          resolve(true);
        });
      });

      // 2. Уведомляем background script о сбросе кэша
      try {
        extApi.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: newSettings });
      } catch (_) {}

      showToast('✓ Настройки успешно сохранены!', 'success');
    } catch (err) {
      console.error('Save error:', err);
      showToast(`✗ Ошибка сохранения: ${err.message}`, 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Сохранить настройки';
    }
  });
});
