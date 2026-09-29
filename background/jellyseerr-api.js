/**
 * Kinopoisk MediaStack Extension - Jellyseerr API Client
 * Поддерживает работу с Jellyseerr / Overseerr v1 API.
 */

(function () {
  'use strict';

  // Статусы медиа в Jellyseerr
  const MEDIA_STATUS = {
    UNKNOWN: 0,
    PENDING_APPROVAL: 1, // Запрошен (ожидает одобрения)
    PROCESSING: 2,       // Одобрен / Передан в Radarr/Sonarr / Качается
    DECLINED: 3,         // Отклонен
    AVAILABLE: 4,        // Скачан / Доступен в медиатеке
    PARTIALLY_AVAILABLE: 5 // Для сериалов: доступны некоторые серии/сезоны
  };

  /**
   * Нормализация URL сервера (удаление хвостового слэша)
   */
  function normalizeUrl(url) {
    if (!url) return '';
    return url.trim().replace(/\/+$/, '');
  }

  /**
   * Выполнение авторизованного HTTP-запроса к Jellyseerr
   */
  async function apiRequest(baseUrl, apiKey, endpoint, options = {}) {
    const url = `${normalizeUrl(baseUrl)}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey || '',
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData.message) errorMsg = errData.message;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (err) {
      console.error(`[JellyseerrApi] Request to ${endpoint} failed:`, err);
      throw err;
    }
  }

  /**
   * Проверка связи с сервером Jellyseerr
   */
  async function testConnection(baseUrl, apiKey) {
    if (!baseUrl || !apiKey) {
      return { success: false, error: 'Укажите URL сервера и API ключ' };
    }

    try {
      const data = await apiRequest(baseUrl, apiKey, '/api/v1/status');
      return {
        success: true,
        version: data.version || 'unknown',
        commitTag: data.commitTag || ''
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Не удалось подключиться к серверу Jellyseerr'
      };
    }
  }

  /**
   * Поиск фильма или сериала в Jellyseerr (через встроенный прокси TMDb)
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {Object} queryMeta - { title, originalTitle, year, type }
   */
  async function searchMedia(baseUrl, apiKey, queryMeta) {
    const { title, originalTitle, year, type } = queryMeta;
    const targetType = type === 'tv' ? 'tv' : 'movie';

    // Формируем запросы: сначала пробуем оригинальное название (наиболее точное в TMDb), затем русское
    const queries = [];
    if (originalTitle && originalTitle.trim()) {
      queries.push(originalTitle.trim());
    }
    if (title && title.trim() && title.trim() !== originalTitle?.trim()) {
      queries.push(title.trim());
    }

    if (queries.length === 0) {
      throw new Error('Отсутствует название фильма или сериала для поиска');
    }

    let allResults = [];

    for (const q of queries) {
      try {
        const encodedQuery = encodeURIComponent(q);
        const data = await apiRequest(baseUrl, apiKey, `/api/v1/search?query=${encodedQuery}&page=1`);
        if (data.results && data.results.length > 0) {
          allResults = data.results;
          break; // нашли результаты по первому точному запросу
        }
      } catch (err) {
        console.warn(`[JellyseerrApi] Search failed for query "${q}":`, err);
      }
    }

    if (!allResults || allResults.length === 0) {
      return null;
    }

    // Фильтрация и ранжирование кандидатов
    const targetYear = year ? parseInt(year, 10) : null;

    // Сначала ищем точное совпадение по типу и году (плюс-минус 1 год для учета дат проката)
    let bestMatch = allResults.find((item) => {
      const itemType = item.mediaType;
      if (itemType !== targetType) return false;

      const itemDate = item.releaseDate || item.firstAirDate;
      if (!itemDate || !targetYear) return true;

      const itemYear = parseInt(itemDate.substring(0, 4), 10);
      return Math.abs(itemYear - targetYear) <= 1;
    });

    // Если точного по году нет, берем первый элемент нужного типа
    if (!bestMatch) {
      bestMatch = allResults.find((item) => item.mediaType === targetType);
    }

    // Если вообще нужного типа нет, берем 1-й результат
    if (!bestMatch) {
      bestMatch = allResults[0];
    }

    return bestMatch;
  }

  /**
   * Получение полной информации о медиа и статусе загрузки
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {number|string} tmdbId
   * @param {'movie'|'tv'} mediaType
   */
  async function getMediaDetails(baseUrl, apiKey, tmdbId, mediaType = 'movie') {
    const endpoint = mediaType === 'tv' ? `/api/v1/tv/${tmdbId}` : `/api/v1/movie/${tmdbId}`;
    const data = await apiRequest(baseUrl, apiKey, endpoint);

    const mediaInfo = data.mediaInfo || {};
    const rawStatus = mediaInfo.status || MEDIA_STATUS.UNKNOWN;

    // Вычисляем процент загрузки, если в очереди есть загрузки
    let downloadProgress = null;
    let isDownloading = false;

    if (mediaInfo.downloadStatus && Array.isArray(mediaInfo.downloadStatus) && mediaInfo.downloadStatus.length > 0) {
      let totalSize = 0;
      let totalLeft = 0;

      for (const dl of mediaInfo.downloadStatus) {
        if (dl.size && dl.sizeLeft !== undefined) {
          totalSize += dl.size;
          totalLeft += dl.sizeLeft;
        }
      }

      if (totalSize > 0) {
        downloadProgress = Math.round(((totalSize - totalLeft) / totalSize) * 100);
        isDownloading = true;
      }
    }

    // Если статус PROCESSING (2), и при этом есть процесс загрузки
    if (rawStatus === MEDIA_STATUS.PROCESSING && downloadProgress === null) {
      downloadProgress = 0;
    }

    let parsedStatus = 'NOT_REQUESTED';
    // 1. Если тайтл уже привязан к Jellyfin - он 100% скачан и доступен
    if (mediaInfo.jellyfinMediaId || mediaInfo.jellyfinMediaId4k) {
      parsedStatus = 'AVAILABLE';
    }
    // 2. Если статус Jellyseerr: Доступен (4) или Частично доступен (5)
    else if (rawStatus === MEDIA_STATUS.AVAILABLE || rawStatus === MEDIA_STATUS.PARTIALLY_AVAILABLE) {
      parsedStatus = 'AVAILABLE';
    }
    // 3. Если скачивание завершено на 100% (размер скачан, сидирование или импорт)
    else if (downloadProgress !== null && downloadProgress >= 100) {
      parsedStatus = 'AVAILABLE';
    }
    // 4. Если процесс скачивания активен и процент < 100%
    else if (isDownloading && downloadProgress !== null && downloadProgress < 100) {
      parsedStatus = 'DOWNLOADING';
    }
    // 5. Если запрошен / ожидает одобрения
    else if (rawStatus === MEDIA_STATUS.PROCESSING || rawStatus === MEDIA_STATUS.PENDING_APPROVAL) {
      parsedStatus = 'REQUESTED';
    }

    return {
      tmdbId: data.id,
      mediaType,
      title: data.title || data.name,
      originalTitle: data.originalTitle || data.originalName,
      releaseDate: data.releaseDate || data.firstAirDate,
      status: parsedStatus,
      rawStatus,
      progress: downloadProgress,
      jellyfinMediaId: mediaInfo.jellyfinMediaId || mediaInfo.jellyfinMediaId4k || null,
      requestsCount: mediaInfo.requests ? mediaInfo.requests.length : 0,
      rawMediaInfo: mediaInfo
    };
  }

  /**
   * Отправка запроса на скачивание медиа в Jellyseerr
   * @param {string} baseUrl
   * @param {string} apiKey
   * @param {number|string} tmdbId
   * @param {'movie'|'tv'} mediaType
   * @param {Array<number>|'all'} seasons
   */
  async function requestMedia(baseUrl, apiKey, tmdbId, mediaType = 'movie', seasons = 'all') {
    const payload = {
      mediaType,
      mediaId: parseInt(tmdbId, 10)
    };

    if (mediaType === 'tv') {
      payload.seasons = seasons;
    }

    const response = await apiRequest(baseUrl, apiKey, '/api/v1/request', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return response;
  }

  // Экспорт в глобальное окружение
  globalThis.JellyseerrApi = {
    MEDIA_STATUS,
    testConnection,
    searchMedia,
    getMediaDetails,
    requestMedia
  };
})();
