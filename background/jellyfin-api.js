/**
 * Kinopoisk MediaStack Extension - Jellyfin API Client
 * Поддерживает работу с Jellyfin API: проверка подключения, поиск элементов и формирование ссылок на веб-плеер.
 */

(function () {
  'use strict';

  function normalizeUrl(url) {
    if (!url) return '';
    return url.trim().replace(/\/+$/, '');
  }

  /**
   * Сборка ссылки на веб-интерфейс Jellyfin для открытия карточки/плеера
   */
  function buildPlayUrl(baseUrl, jellyfinMediaId) {
    if (!baseUrl || !jellyfinMediaId) return null;
    const cleanUrl = normalizeUrl(baseUrl);
    return `${cleanUrl}/web/index.html#!/details?id=${jellyfinMediaId}`;
  }

  /**
   * Проверка связи с Jellyfin
   */
  async function testConnection(baseUrl, apiKey) {
    if (!baseUrl) {
      return { success: false, error: 'Укажите URL сервера Jellyfin' };
    }

    const cleanUrl = normalizeUrl(baseUrl);
    try {
      // 1. Проверяем публичный статус сервера
      const publicRes = await fetch(`${cleanUrl}/System/Info/Public`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!publicRes.ok) {
        throw new Error(`HTTP ${publicRes.status}: ${publicRes.statusText}`);
      }

      const publicInfo = await publicRes.json();

      // 2. Если передан API ключ / токен пользователя, проверим его
      if (apiKey && apiKey.trim()) {
        const authRes = await fetch(`${cleanUrl}/System/Info`, {
          headers: {
            'Accept': 'application/json',
            'X-Emby-Token': apiKey.trim()
          }
        });
        if (!authRes.ok) {
          return {
            success: false,
            error: 'Сервер Jellyfin доступен, но API ключ отклонен (401/403)'
          };
        }
      }

      return {
        success: true,
        serverName: publicInfo.ServerName || 'Jellyfin Server',
        version: publicInfo.Version || 'unknown'
      };
    } catch (err) {
      console.error('[JellyfinApi] Test connection failed:', err);
      return {
        success: false,
        error: err.message || 'Не удалось подключиться к Jellyfin'
      };
    }
  }

  /**
   * Поиск тайтла в медиатеке Jellyfin (fallback, если в Jellyseerr нет jellyfinMediaId)
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {Object} queryMeta - { title, originalTitle, year, type }
   */
  async function findMediaItem(baseUrl, apiKey, queryMeta) {
    if (!baseUrl) return null;
    const cleanUrl = normalizeUrl(baseUrl);
    const { title, originalTitle, year, type } = queryMeta;
    const itemType = type === 'tv' ? 'Series' : 'Movie';

    const queries = [];
    if (originalTitle) queries.push(originalTitle);
    if (title && title !== originalTitle) queries.push(title);

    for (const q of queries) {
      try {
        const params = new URLSearchParams({
          searchTerm: q,
          includeItemTypes: itemType,
          recursive: 'true',
          limit: '10'
        });

        const headers = { 'Accept': 'application/json' };
        if (apiKey && apiKey.trim()) {
          headers['X-Emby-Token'] = apiKey.trim();
        }

        const res = await fetch(`${cleanUrl}/Items?${params.toString()}`, { headers });
        if (!res.ok) continue;

        const data = await res.json();
        const items = data.Items || [];

        if (items.length > 0) {
          const targetYear = year ? parseInt(year, 10) : null;
          // Ищем совпадение по году
          const match = items.find((it) => {
            if (!targetYear || !it.ProductionYear) return true;
            return Math.abs(it.ProductionYear - targetYear) <= 1;
          });

          if (match) {
            return match.Id;
          }
          return items[0].Id;
        }
      } catch (err) {
        console.warn(`[JellyfinApi] Search for "${q}" failed:`, err);
      }
    }

    return null;
  }

  globalThis.JellyfinApi = {
    buildPlayUrl,
    testConnection,
    findMediaItem
  };
})();
