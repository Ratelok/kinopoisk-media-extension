/**
 * Kinopoisk MediaStack Extension - Content Script
 * Инжектирует кнопки управления и статус медиастека на страницах фильмов и сериалов Кинопоиска.
 */

(function () {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;
  let currentKinopoiskId = null;
  let isProcessing = false;

  // SVG иконки
  const ICONS = {
    download: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>`,
    play: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    check: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    clock: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
    settings: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    warning: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`
  };

  /**
   * Извлечение метаданных фильма/сериала со страницы
   */
  function extractPageMetadata() {
    const urlMatch = window.location.pathname.match(/\/(film|series)\/(\d+)/);
    if (!urlMatch) return null;

    const mediaType = urlMatch[1] === 'series' ? 'tv' : 'movie';
    const kinopoiskId = urlMatch[2];

    let title = '';
    let originalTitle = '';
    let year = null;

    // 1. Пробуем извлечь из структурированных данных JSON-LD
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const json = JSON.parse(script.textContent);
        const item = Array.isArray(json) ? json[0] : json;
        if (item && (item['@type'] === 'Movie' || item['@type'] === 'TVSeries' || item['@type'] === 'Series')) {
          title = item.name || '';
          originalTitle = item.alternateName || item.alternativeHeadline || '';
          if (item.datePublished) {
            const y = parseInt(item.datePublished.substring(0, 4), 10);
            if (!isNaN(y)) year = y;
          }
          break;
        }
      } catch (_) {}
    }

    // 2. Fallback: парсинг из заголовка h1 и DOM
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1) {
        title = h1.textContent.trim().replace(/\s*\(\d{4}\)$/, '');
      }
    }

    // 3. Fallback оригинального названия и года
    if (!originalTitle) {
      const origSpan = document.querySelector('span[class*="originalTitle"], span[data-tid*="OriginalTitle"]');
      if (origSpan) {
        originalTitle = origSpan.textContent.trim();
      }
    }

    if (!year) {
      // Ищем ссылку на год фильма
      const yearLink = document.querySelector('a[href*="/lists/movies/year--"]');
      if (yearLink) {
        const parsed = parseInt(yearLink.textContent.trim(), 10);
        if (!isNaN(parsed)) year = parsed;
      } else {
        // Ищем 4 цифры года в шапке
        const textNodes = document.body.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (textNodes) year = parseInt(textNodes[0], 10);
      }
    }

    if (!title && !originalTitle) return null;

    return {
      kinopoiskId,
      type: mediaType,
      title,
      originalTitle: originalTitle || title,
      year
    };
  }

  /**
   * Поиск лучшего контейнера для размещения виджета
   */
  function findTargetContainer() {
    // 1. Ищем контейнер кнопок действий ("Буду смотреть", "В список" и т.п.)
    const selectors = [
      'div[class*="styles_buttonsContainer"]',
      'div[class*="styles_watchOnline"]',
      'div[class*="styles_buttonContainer"]',
      'div[class*="styles_actionsContainer"]',
      'div[data-tid="ButtonsContainer"]',
      'div[data-tid="ActionsBar"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // 2. Пробуем найти родительский блок первой кнопки "Буду смотреть"
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.innerText.toLowerCase();
      if (text.includes('буду смотреть') || text.includes('смотреть') || text.includes('оценить')) {
        const parent = btn.parentElement;
        if (parent && parent.offsetHeight > 0) {
          return parent;
        }
      }
    }

    // 3. Fallback: размещаем сразу под заголовком h1
    const h1 = document.querySelector('h1');
    if (h1 && h1.parentElement) {
      return h1.parentElement;
    }

    return null;
  }

  /**
   * Получение или создание корневого DOM-элемента виджета
   */
  function getOrCreateWidget() {
    let root = document.getElementById('kp-ms-widget');
    if (root) return root;

    const container = findTargetContainer();
    if (!container) return null;

    root = document.createElement('div');
    root.id = 'kp-ms-widget';
    root.className = 'kp-ms-root';

    // Вставляем виджет аккуратно в контейнер
    container.appendChild(root);
    return root;
  }

  /**
   * Отрисовка состояния загрузки
   */
  function renderLoading(text = 'Проверка медиастека...') {
    const root = getOrCreateWidget();
    if (!root) return;

    root.innerHTML = `
      <div class="kp-ms-badge kp-ms-badge-loading">
        <div class="kp-ms-spinner"></div>
        <span>${text}</span>
      </div>
    `;
  }

  /**
   * Отрисовка состояния ошибки / предупреждения
   */
  function renderWarning(text, tooltip, action = null) {
    const root = getOrCreateWidget();
    if (!root) return;

    root.innerHTML = `
      <div class="kp-ms-tooltip-container">
        <div class="kp-ms-badge kp-ms-badge-warning" id="kp-ms-warning-btn">
          ${ICONS.warning}
          <span>${text}</span>
        </div>
        ${tooltip ? `<div class="kp-ms-tooltip">${tooltip}</div>` : ''}
      </div>
    `;

    if (action) {
      const btn = root.querySelector('#kp-ms-warning-btn');
      if (btn) btn.onclick = action;
    }
  }

  /**
   * Отрисовка кнопки «Скачать»
   */
  function renderDownload(meta, tmdbId) {
    const root = getOrCreateWidget();
    if (!root) return;

    root.innerHTML = `
      <button class="kp-ms-btn kp-ms-btn-download" id="kp-ms-download-btn" title="Отправить запрос на скачивание в Jellyseerr">
        ${ICONS.download}
        <span>Скачать</span>
      </button>
    `;

    const btn = root.querySelector('#kp-ms-download-btn');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        renderLoading('Отправка запроса...');

        try {
          const res = await extApi.runtime.sendMessage({
            action: 'REQUEST_DOWNLOAD',
            meta: { ...meta, tmdbId }
          });

          if (res && res.success) {
            renderState(res.updatedStatus, meta);
          } else {
            renderWarning('Ошибка запроса', res?.error || 'Не удалось отправить запрос в Jellyseerr');
          }
        } catch (err) {
          renderWarning('Ошибка', err.message);
        }
      };
    }
  }

  /**
   * Отрисовка состояния «Запрошен / В очереди»
   */
  function renderRequested() {
    const root = getOrCreateWidget();
    if (!root) return;

    root.innerHTML = `
      <div class="kp-ms-tooltip-container">
        <div class="kp-ms-badge kp-ms-badge-requested">
          ${ICONS.clock}
          <span>Запрошен</span>
        </div>
        <div class="kp-ms-tooltip">Фильм запрошен и ожидает одобрения/загрузки в медиастеке</div>
      </div>
    `;
  }

  /**
   * Отрисовка состояния «Качается (X%)»
   */
  function renderDownloading(progress) {
    const root = getOrCreateWidget();
    if (!root) return;

    const percentText = progress !== null ? ` ${progress}%` : '';
    const progressWidth = progress !== null ? Math.min(100, Math.max(5, progress)) : 100;

    root.innerHTML = `
      <div class="kp-ms-tooltip-container">
        <div class="kp-ms-badge kp-ms-badge-downloading">
          <div class="kp-ms-spinner"></div>
          <span>Качается${percentText}</span>
          <div class="kp-ms-progress-bar" style="width: ${progressWidth}%"></div>
        </div>
        <div class="kp-ms-tooltip">Тайтл загружается торрент-клиентом в медиатеку</div>
      </div>
    `;
  }

  /**
   * Отрисовка состояния «Скачан / В медиатеке» и кнопки «Смотреть в Jellyfin»
   */
  function renderAvailable(jellyfinUrl) {
    const root = getOrCreateWidget();
    if (!root) return;

    let watchBtnHtml = '';
    if (jellyfinUrl) {
      watchBtnHtml = `
        <a class="kp-ms-btn kp-ms-btn-watch" href="${jellyfinUrl}" target="_blank" rel="noopener noreferrer" title="Смотреть прямо в Jellyfin">
          ${ICONS.play}
          <span>Смотреть в Jellyfin</span>
        </a>
      `;
    }

    root.innerHTML = `
      <div class="kp-ms-badge kp-ms-badge-available">
        ${ICONS.check}
        <span>В медиатеке</span>
      </div>
      ${watchBtnHtml}
    `;
  }

  /**
   * Главный диспетчер отрисовки состояния
   */
  function renderState(res, meta) {
    if (!res) {
      renderWarning('Нет данных', 'Не удалось получить ответ от расширения');
      return;
    }

    switch (res.status) {
      case 'NOT_CONFIGURED':
        renderWarning('Настроить стек', res.message || 'Кликните, чтобы открыть настройки расширения', () => {
          extApi.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
        });
        break;

      case 'AVAILABLE':
        renderAvailable(res.jellyfinUrl);
        break;

      case 'DOWNLOADING':
        renderDownloading(res.progress);
        break;

      case 'REQUESTED':
        renderRequested();
        break;

      case 'NOT_REQUESTED':
        renderDownload(meta, res.tmdbId);
        break;

      case 'NOT_FOUND':
        renderWarning('Не найден', 'Фильм не найден в каталоге TMDb/Jellyseerr');
        break;

      case 'ERROR':
      default:
        renderWarning('Медиастек недоступен', res.message || 'Проверьте соединение с сервером');
        break;
    }
  }

  /**
   * Инициализация виджета на текущей странице
   */
  async function initWidget(force = false) {
    const meta = extractPageMetadata();
    if (!meta) return;

    if (!force && currentKinopoiskId === meta.kinopoiskId && document.getElementById('kp-ms-widget')) {
      return; // Уже инициализирован для этого фильма
    }

    currentKinopoiskId = meta.kinopoiskId;
    if (isProcessing) return;
    isProcessing = true;

    try {
      renderLoading();

      const response = await extApi.runtime.sendMessage({
        action: 'CHECK_STATUS',
        meta
      });

      renderState(response, meta);
    } catch (err) {
      console.error('[Content] Check status failed:', err);
      renderWarning('Ошибка', err.message);
    } finally {
      isProcessing = false;
    }
  }

  // --- Отслеживание SPA переходов Кинопоиска ---
  let lastUrl = window.location.href;

  function onUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      const oldWidget = document.getElementById('kp-ms-widget');
      if (oldWidget) oldWidget.remove();
      currentKinopoiskId = null;
      setTimeout(() => initWidget(true), 400);
    }
  }

  // Перехват pushState и replaceState
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  // Наблюдатель мутаций DOM (для случаев, когда React перерендеривает контейнер кнопок)
  let observerDebounce = null;
  const observer = new MutationObserver(() => {
    if (observerDebounce) clearTimeout(observerDebounce);
    observerDebounce = setTimeout(() => {
      onUrlChange();
      if (!document.getElementById('kp-ms-widget') && window.location.pathname.match(/\/(film|series)\/\d+/)) {
        initWidget();
      }
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Первоначальный запуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWidget());
  } else {
    initWidget();
  }
})();
