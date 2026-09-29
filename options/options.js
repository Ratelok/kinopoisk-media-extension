/**
 * Kinopoisk MediaStack Extension - Options Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const extApi = typeof browser !== 'undefined' ? browser : chrome;

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
    }, 3500);
  }

  // Загрузка сохраненных настроек
  try {
    const settings = await new Promise((resolve) => {
      extApi.runtime.sendMessage({ action: 'GET_SETTINGS' }, (res) => resolve(res || {}));
    });

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
    showToast('Не удалось загрузить настройки', 'error');
  }

  // Тест Jellyseerr
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
      const res = await new Promise((resolve) => {
        extApi.runtime.sendMessage({
          action: 'TEST_CONNECTION',
          service: 'jellyseerr',
          url,
          apiKey
        }, resolve);
      });

      if (res && res.success) {
        statusJellyseerr.className = 'connection-status ok';
        statusJellyseerr.textContent = `✓ Успешно подключено (версия: ${res.version})`;
      } else {
        statusJellyseerr.className = 'connection-status err';
        statusJellyseerr.textContent = `✗ Ошибка: ${res?.error || 'Недоступен'}`;
      }
    } catch (err) {
      statusJellyseerr.className = 'connection-status err';
      statusJellyseerr.textContent = `✗ Ошибка: ${err.message}`;
    } finally {
      btnTestJellyseerr.disabled = false;
    }
  });

  // Тест Jellyfin
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
      const res = await new Promise((resolve) => {
        extApi.runtime.sendMessage({
          action: 'TEST_CONNECTION',
          service: 'jellyfin',
          url,
          apiKey
        }, resolve);
      });

      if (res && res.success) {
        statusJellyfin.className = 'connection-status ok';
        statusJellyfin.textContent = `✓ Успешно подключено (${res.serverName}, v${res.version})`;
      } else {
        statusJellyfin.className = 'connection-status err';
        statusJellyfin.textContent = `✗ Ошибка: ${res?.error || 'Недоступен'}`;
      }
    } catch (err) {
      statusJellyfin.className = 'connection-status err';
      statusJellyfin.textContent = `✗ Ошибка: ${err.message}`;
    } finally {
      btnTestJellyfin.disabled = false;
    }
  });

  // Сохранение настроек
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

    try {
      const res = await new Promise((resolve) => {
        extApi.runtime.sendMessage({
          action: 'SAVE_SETTINGS',
          settings: newSettings
        }, resolve);
      });

      if (res && res.success) {
        showToast('Настройки успешно сохранены!', 'success');
      } else {
        showToast('Ошибка при сохранении настроек', 'error');
      }
    } catch (err) {
      showToast(`Ошибка: ${err.message}`, 'error');
    } finally {
      btnSave.disabled = false;
    }
  });
});
