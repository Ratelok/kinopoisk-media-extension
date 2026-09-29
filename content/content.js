/**
 * Kinopoisk MediaStack Extension - Content Script
 * Инжектирует кнопки управления и статус медиастека на страницах фильмов и сериалов Кинопоиска.
 */

(function () {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;
  let currentKinopoiskId = null;
  let isProcessing = false;

  // Иконки SVG в фирменном стиле Кинопоиска
  const ICONS = {
    download: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>`,
    play: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    check: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    clock: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
    warning: `<svg class="kp-ms-icon" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`
  };

  /**
   * Определение темы (Светлая или Тёмная) на странице Кинопоиска
   */
  function detectTheme() {
    try {
      const bg = window.getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const brightness = (parseInt(rgb[0], 10) * 299 + parseInt(rgb[1], 10) * 587 + parseInt(rgb[2], 10) * 114) / 1000;
        return brightness < 128 ? 'dark' : 'light';
      }
    } catch (_) {}
    return 'light';
  }

  /**
   * Синхронизация геометрии (высота, скругления) с нативными кнопками Кинопоиска
   */
  function syncNativeGeometry(root, container) {
    if (!root || !container) return;
    try {
      const nativeBtn = container.querySelector('button');
      if (nativeBtn) {
        const comp = window.getComputedStyle(nativeBtn);
        if (comp.height && parseInt(comp.height, 10) >= 36) {
          root.style.setProperty('--kp-ms-height', comp.height);
        }
        if (comp.borderRadius) {
          root.style.setProperty('--kp-ms-radius', comp.borderRadius);
        }
      }
    } catch (_) {}
  }

  /**
   * Извлечение метаданных фильма/сериала со страницы Кинопоиска
   */
  function extractPageMetadata() {
    const urlMatch = window.location.pathname.match(/\/(film|series)\/(\d+)/);
    if (!urlMatch) return null;

    const mediaType = urlMatch[1] === 'series' ? 'tv' : 'movie';
    const kinopoiskId = urlMatch[2];

    let title = '';
    let originalTitle = '';
    let year = null;

    // 1. JSON-LD структурированные данные
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

    // 2. Fallback: h1
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1) {
        title = h1.textContent.trim().replace(/\s*\(\d{4}\)$/, '');
      }
    }

    // 3. Fallback: оригинальное название и год
    if (!originalTitle) {
      const origSpan = document.querySelector('span[class*="originalTitle"], span[data-tid*="OriginalTitle"]');
      if (origSpan) {
        originalTitle = origSpan.textContent.trim();
      }
    }

    if (!year) {
      const yearLink = document.querySelector('a[href*="/lists/movies/year--"]');
      if (yearLink) {
        const parsed = parseInt(yearLink.textContent.trim(), 10);
        if (!isNaN(parsed)) year = parsed;
      } else {
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
   * Поиск родительского контейнера для вставки виджета
   */
  function findTargetContainer() {
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

    const h1 = document.querySelector('h1');
    if (h1 && h1.parentElement) {
      return h1.parentElement;
    }

    return null;
  }

  /**
   * Получение или создание корневого контейнера виджета
   */
  function getOrCreateWidget() {
    let root = document.getElementById('kp-ms-widget');
    if (root) {
      // Обновляем тему
      applyTheme(root);
      return root;
    }

    const container = findTargetContainer();
    if (!container) return null;

    root = document.createElement('div');
    root.id = 'kp-ms-widget';
    root.className = 'kp-ms-root';

    applyTheme(root);
    syncNativeGeometry(root, container);

    container.appendChild(root);
    return root;
  }

  function applyTheme(root) {
    const theme = detectTheme();
    root.classList.remove('kp-ms-theme-light', 'kp-ms-theme-dark');
    root.classList.add(theme === 'dark' ? 'kp-ms-theme-dark' : 'kp-ms-theme-light');
  }

  /**
   * Отрисовка состояния загрузки
   */
  function renderLoading(text = 'Проверка...') {
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
   * Отрисовка предупреждения
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
   * Отрисовка кнопки «Скачать» (в нативном стиле вторичной кнопки Кинопоиска)
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
            renderWarning('Ошибка', res?.error || 'Не удалось отправить запрос в Jellyseerr');
          }
        } catch (err) {
          renderWarning('Ошибка', err.message);
        }
      };
    }
  }

  /**
   * Отрисовка состояния «Запрошен»
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
        <div class="kp-ms-tooltip">Фильм запрошен в медиастеке и ожидает загрузки</div>
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
        <div class="kp-ms-tooltip">Тайтл активно загружается торрент-клиентом</div>
      </div>
    `;
  }

  /**
   * Отрисовка состояния «Скачан» и кнопки «Смотреть в Jellyfin»
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
      ${watchBtnHtml}
      <div class="kp-ms-badge kp-ms-badge-available" title="Фильм находится в вашей домашней медиатеке">
        ${ICONS.check}
        <span>Скачан</span>
      </div>
    `;
  }

  /**
   * Главный диспетчер отрисовки
   */
  function renderState(res, meta) {
    if (!res) {
      renderWarning('Нет данных', 'Не удалось получить статус');
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
        renderWarning('Ошибка стека', res.message || 'Проверьте соединение с сервером');
        break;
    }
  }

  /**
   * Инициализация виджета
   */
  async function initWidget(force = false) {
    const meta = extractPageMetadata();
    if (!meta) return;

    if (!force && currentKinopoiskId === meta.kinopoiskId && document.getElementById('kp-ms-widget')) {
      return;
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

  // Наблюдатель мутаций DOM
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWidget());
  } else {
    initWidget();
  }
})();
