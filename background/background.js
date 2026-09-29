/**
 * Kinopoisk MediaStack Extension - Background Script
 * Координирует запросы между content script, popup, options и API серверов.
 */

(function () {
  'use strict';

  // Совместимость с chrome/browser API
  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    jellyseerrUrl: '',
    jellyseerrApiKey: '',
    jellyfinUrl: '',
    jellyfinApiKey: '',
    autoCheck: true,
    cacheTtlSec: 60
  };

  // Кэш статусов в памяти: key -> { data, timestamp }
  const statusCache = new Map();

  /**
   * Получение настроек из storage
   */
  async function getSettings() {
    return new Promise((resolve) => {
      const storage = extApi.storage?.local || extApi.storage?.sync;
      if (!storage) {
        return resolve(DEFAULT_SETTINGS);
      }
      storage.get(DEFAULT_SETTINGS, (items) => {
        resolve({ ...DEFAULT_SETTINGS, ...(items || {}) });
      });
    });
  }

  /**
   * Сохранение настроек в storage
   */
  async function saveSettings(newSettings) {
    return new Promise((resolve, reject) => {
      const storage = extApi.storage?.local || extApi.storage?.sync;
      if (!storage) {
        return reject(new Error('Storage API недоступно'));
      }
      storage.set(newSettings, () => {
        if (extApi.runtime.lastError) {
          return reject(extApi.runtime.lastError);
        }
        statusCache.clear();
        resolve(true);
      });
    });
  }

  /**
   * Генерация ключа для кэша
   */
  function makeCacheKey(meta) {
    if (meta.kinopoiskId) {
      return `kp_${meta.kinopoiskId}`;
    }
    const cleanTitle = (meta.originalTitle || meta.title || '').trim().toLowerCase();
    return `title_${cleanTitle}_${meta.year || ''}_${meta.type || ''}`;
  }

  /**
   * Проверка статуса медиа
   */
  async function checkMediaStatus(meta, forceRefresh = false) {
    const settings = await getSettings();

    if (!settings.jellyseerrUrl || !settings.jellyseerrApiKey) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'Требуется настроить адрес и API ключ Jellyseerr в параметрах расширения'
      };
    }

    const cacheKey = makeCacheKey(meta);
    const now = Date.now();
    const ttlMs = (settings.cacheTtlSec || 60) * 1000;

    if (!forceRefresh && statusCache.has(cacheKey)) {
      const cached = statusCache.get(cacheKey);
      if (now - cached.timestamp < ttlMs) {
        return cached.data;
      }
    }

    try {
      // 1. Поиск фильма/сериала в Jellyseerr
      const searchResult = await globalThis.JellyseerrApi.searchMedia(
        settings.jellyseerrUrl,
        settings.jellyseerrApiKey,
        meta
      );

      if (!searchResult) {
        const notFoundData = {
          status: 'NOT_FOUND',
          meta,
          message: 'Тайтл не найден в базе TMDb/Jellyseerr'
        };
        statusCache.set(cacheKey, { data: notFoundData, timestamp: now });
        return notFoundData;
      }

      const tmdbId = searchResult.id;
      const mediaType = searchResult.mediaType || (meta.type === 'tv' ? 'tv' : 'movie');

      // 2. Получение детальной информации и статуса
      const details = await globalThis.JellyseerrApi.getMediaDetails(
        settings.jellyseerrUrl,
        settings.jellyseerrApiKey,
        tmdbId,
        mediaType
      );

      // 3. Дополнительная проверка в Jellyfin (если настроен)
      let jellyfinPlayUrl = null;
      let finalStatus = details.status;

      if (settings.jellyfinUrl) {
        let itemId = details.jellyfinMediaId;

        // Если ID нет в Jellyseerr или статус еще не AVAILABLE, проверяем саму библиотеку Jellyfin
        if (!itemId && settings.jellyfinApiKey) {
          try {
            itemId = await globalThis.JellyfinApi.findMediaItem(
              settings.jellyfinUrl,
              settings.jellyfinApiKey,
              meta
            );
          } catch (_) {}
        }

        // Если нашли ID в Jellyfin -> фильм 100% скачан и доступен!
        if (itemId) {
          finalStatus = 'AVAILABLE';
          jellyfinPlayUrl = globalThis.JellyfinApi.buildPlayUrl(
            settings.jellyfinUrl,
            itemId
          );
        } else if (finalStatus === 'AVAILABLE') {
          // Если Jellyseerr считает доступным, но конкретный ID неизвестен - даем ссылку на поиск
          const cleanQuery = encodeURIComponent(details.title || meta.title || '');
          jellyfinPlayUrl = `${settings.jellyfinUrl.replace(/\/+$/, '')}/web/index.html#!/search.html?query=${cleanQuery}`;
        }
      }

      const result = {
        status: finalStatus,
        tmdbId,
        mediaType,
        title: details.title,
        originalTitle: details.originalTitle,
        progress: details.progress,
        jellyfinUrl: jellyfinPlayUrl,
        rawStatus: details.rawStatus,
        meta
      };

      statusCache.set(cacheKey, { data: result, timestamp: now });
      return result;
    } catch (err) {
      console.error('[Background] checkMediaStatus error:', err);
      return {
        status: 'ERROR',
        message: err.message || 'Ошибка связи с сервером Jellyseerr',
        meta
      };
    }
  }

  /**
   * Отправка запроса на скачивание
   */
  async function requestDownload(meta, seasons = 'all') {
    const settings = await getSettings();

    if (!settings.jellyseerrUrl || !settings.jellyseerrApiKey) {
      return {
        success: false,
        error: 'Настройки Jellyseerr не заполнены'
      };
    }

    try {
      let tmdbId = meta.tmdbId;
      let mediaType = meta.mediaType || (meta.type === 'tv' ? 'tv' : 'movie');

      if (!tmdbId) {
        const found = await globalThis.JellyseerrApi.searchMedia(
          settings.jellyseerrUrl,
          settings.jellyseerrApiKey,
          meta
        );
        if (!found) {
          throw new Error('Не удалось найти медиа в TMDb для запроса');
        }
        tmdbId = found.id;
        mediaType = found.mediaType || mediaType;
      }

      await globalThis.JellyseerrApi.requestMedia(
        settings.jellyseerrUrl,
        settings.jellyseerrApiKey,
        tmdbId,
        mediaType,
        seasons
      );

      // Сбрасываем кэш для этого тайтла
      const cacheKey = makeCacheKey(meta);
      statusCache.delete(cacheKey);

      // Запрашиваем обновленный статус
      const updatedStatus = await checkMediaStatus({ ...meta, tmdbId, mediaType }, true);
      return {
        success: true,
        updatedStatus
      };
    } catch (err) {
      console.error('[Background] requestDownload error:', err);
      return {
        success: false,
        error: err.message || 'Ошибка отправки запроса в Jellyseerr'
      };
    }
  }

  /**
   * Обработчик входящих сообщений
   */
  extApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request;

    if (action === 'CHECK_STATUS') {
      checkMediaStatus(request.meta, request.forceRefresh)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ status: 'ERROR', message: err.message }));
      return true; // Асинхронный ответ
    }

    if (action === 'REQUEST_DOWNLOAD') {
      requestDownload(request.meta, request.seasons)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === 'GET_SETTINGS') {
      getSettings().then((settings) => sendResponse(settings));
      return true;
    }

    if (action === 'SAVE_SETTINGS') {
      saveSettings(request.settings)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === 'TEST_CONNECTION') {
      const { service, url, apiKey } = request;
      if (service === 'jellyseerr') {
        globalThis.JellyseerrApi.testConnection(url, apiKey)
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ success: false, error: err.message }));
      } else if (service === 'jellyfin') {
        globalThis.JellyfinApi.testConnection(url, apiKey)
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ success: false, error: err.message }));
      } else {
        sendResponse({ success: false, error: 'Неизвестный сервис' });
      }
      return true;
    }

    if (action === 'OPEN_OPTIONS') {
      if (extApi.runtime.openOptionsPage) {
        extApi.runtime.openOptionsPage();
      } else {
        extApi.tabs.create({ url: extApi.runtime.getURL('options/options.html') });
      }
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  console.log('[Background] Kinopoisk MediaStack Service Worker initialized');
})();
