/**
 * Kinopoisk MediaStack Extension - Content Script
 * Инжектирует кнопки управления и статус медиастека на страницах фильмов и сериалов Кинопоиска.
 */

(function () {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;
  let currentActiveId = null;

  // Иконки SVG (четкий острый геометрический треугольник Play, идентичный Кинопоиску)
  function createSvg(viewBox, pathD, extraClass = '', pathFill = null, svgAttrs = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('class', ('kp-ms-icon ' + extraClass).trim());
    for (const [k, v] of Object.entries(svgAttrs)) {
      svg.setAttribute(k, v);
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    if (pathFill) {
      path.setAttribute('fill', pathFill);
    }
    svg.appendChild(path);
    return svg;
  }

  const ICONS = {
    download: () => createSvg('0 0 24 24', 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z'),
    play: () => createSvg('0 0 24 24', 'M6 3.375 21 12 6 20.625V3.375Z', 'kp-ms-icon-play', '#ffffff', { width: '24', height: '24', fill: 'none' }),
    check: () => createSvg('0 0 24 24', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'),
    clock: () => createSvg('0 0 24 24', 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z'),
    warning: () => createSvg('0 0 24 24', 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z')
  };

  /**
   * Надёжное определение темы страницы (Светлая или Тёмная)
   * Учитывает классы нативных кнопок Кинопоиска (Light / Dark) и заголовка h1.
   */
  function detectTheme(container) {
    try {
      // 1. По нативным кнопкам в контейнере действий
      if (container) {
        const nativeBtns = container.querySelectorAll('button:not(#kp-ms-download-btn):not(#kp-ms-warning-btn)');
        for (const btn of nativeBtns) {
          const cls = btn.className || '';
          if (cls.includes('Light') || cls.includes('light')) return 'light';
          if (cls.includes('Dark') || cls.includes('dark')) return 'dark';
        }
      }

      // 2. По классу или цвету заголовка фильма (h1)
      const h1 = document.querySelector('h1');
      if (h1) {
        const cls = h1.className || '';
        if (cls.includes('InLight') || cls.includes('Light') || cls.includes('light')) return 'light';
        if (cls.includes('InDark') || cls.includes('Dark') || cls.includes('dark')) return 'dark';

        const colorComp = window.getComputedStyle(h1).color;
        const rgb = colorComp ? colorComp.match(/\d+/g) : null;
        if (rgb && rgb.length >= 3) {
          const brightness = (parseInt(rgb[0], 10) * 299 + parseInt(rgb[1], 10) * 587 + parseInt(rgb[2], 10) * 114) / 1000;
          return brightness > 150 ? 'dark' : 'light';
        }
      }

      // 3. По цвету фона контейнера (только если непрозрачный)
      let el = container;
      while (el && el !== document.body) {
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) {
          const rgb = bg.match(/\d+/g);
          if (rgb && rgb.length >= 3) {
            const a = rgb[3] !== undefined ? parseFloat(rgb[3]) : 1;
            if (a > 0.5) {
              const brightness = (parseInt(rgb[0], 10) * 299 + parseInt(rgb[1], 10) * 587 + parseInt(rgb[2], 10) * 114) / 1000;
              return brightness < 128 ? 'dark' : 'light';
            }
          }
        }
        el = el.parentElement;
      }
    } catch (_) {}

    return 'light'; // По умолчанию на Кинопоиске — светлая тема
  }

  /**
   * Точная адаптация геометрии и цветов под нативные кнопки Кинопоиска
   */
  function syncNativeGeometry(root, container) {
    if (!root || !container) return;
    try {
      const buttons = container.querySelectorAll('button:not(#kp-ms-download-btn):not(#kp-ms-warning-btn)');
      let targetBtn = null;

      // Ищем вторичную серую кнопку ("Буду смотреть" или "..."), не главную оранжевую
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text.includes('буду смотреть') || text.includes('...') || text.includes('оценить') || text === '') {
          targetBtn = btn;
          break;
        }
      }

      if (!targetBtn && buttons.length > 0) {
        targetBtn = buttons[0];
      }

      if (targetBtn) {
        const comp = window.getComputedStyle(targetBtn);
        if (comp.backgroundColor && comp.backgroundColor !== 'transparent' && !comp.backgroundColor.startsWith('rgba(0, 0, 0, 0)')) {
          root.style.setProperty('--kp-ms-bg-btn', comp.backgroundColor);
        }
        if (comp.color) {
          root.style.setProperty('--kp-ms-text-primary', comp.color);
        }
        if (comp.height && parseInt(comp.height, 10) >= 36) {
          root.style.setProperty('--kp-ms-height', comp.height);
        }
        if (comp.borderRadius && !comp.borderRadius.includes('%')) {
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
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item && (item['@type'] === 'Movie' || item['@type'] === 'TVSeries' || item['@type'] === 'Series')) {
            title = item.name || '';
            originalTitle = item.alternateName || item.alternativeHeadline || '';
            if (item.datePublished) {
              const y = parseInt(item.datePublished.substring(0, 4), 10);
              if (!isNaN(y)) year = y;
            }
            break;
          }
        }
        if (title) break;
      } catch (_) {}
    }

    // 2. Fallback из h1
    const h1 = document.querySelector('h1');
    if (h1) {
      const h1Text = h1.textContent.trim();
      if (!title) {
        title = h1Text.replace(/\s*\(\d{4}\)$/, '');
      }
      if (!year) {
        const h1YearMatch = h1Text.match(/\b(19\d\d|20\d\d)\b/);
        if (h1YearMatch) year = parseInt(h1YearMatch[1], 10);
      }
    }

    // 3. Fallback оригинального названия (очищаем от возрастного рейтинга "18+", "16+")
    if (!originalTitle) {
      const origSpan = document.querySelector('span[class*="originalTitle"], span[data-tid*="OriginalTitle"]');
      if (origSpan) {
        originalTitle = origSpan.textContent.trim();
      }
    }

    if (originalTitle) {
      originalTitle = originalTitle.replace(/\s*\b\d+\+\s*$/, '').trim();
    }

    // 4. Fallback года
    if (!year) {
      const yearLink = document.querySelector('a[href*="/lists/movies/year--"]');
      if (yearLink) {
        const parsed = parseInt(yearLink.textContent.trim(), 10);
        if (!isNaN(parsed)) year = parsed;
      } else {
        const match = document.body.innerText.match(/\b(19\d\d|20\d\d)\b/);
        if (match) year = parseInt(match[0], 10);
      }
    }

    if (!title && !originalTitle) return null;

    return {
      kinopoiskId,
      type: mediaType,
      title: title || originalTitle,
      originalTitle: originalTitle || title,
      year
    };
  }

  /**
   * Поиск целевого контейнера строки действий
   */
  function findTargetContainer() {
    // 1. Ищем кнопку "Буду смотреть" и поднимаемся к общему flex-контейнеру строки
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('буду смотреть') || text.includes('смотреть') || text.includes('оценить')) {
        let parent = btn.parentElement;
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (style.display && style.display.includes('flex')) {
            return parent;
          }
          parent = parent.parentElement;
        }
        return btn.parentElement;
      }
    }

    // 2. Селекторы контейнеров кнопок
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

    // 3. Fallback под заголовком h1
    const h1 = document.querySelector('h1');
    if (h1 && h1.parentElement) {
      return h1.parentElement;
    }

    return null;
  }

  /**
   * Ожидание появления контейнера в DOM
   */
  async function waitForContainer(maxRetries = 15, delayMs = 200) {
    for (let i = 0; i < maxRetries; i++) {
      const container = findTargetContainer();
      if (container) return container;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  /**
   * Получение или создание корневого контейнера виджета
   */
  function getOrCreateWidget(container) {
    let root = document.getElementById('kp-ms-widget');
    if (root) {
      applyTheme(root, container);
      if (container) syncNativeGeometry(root, container);
      return root;
    }

    if (!container) return null;

    root = document.createElement('div');
    root.id = 'kp-ms-widget';
    root.className = 'kp-ms-root';

    applyTheme(root, container);
    syncNativeGeometry(root, container);

    container.appendChild(root);
    return root;
  }

  function applyTheme(root, container) {
    const theme = detectTheme(container);
    root.classList.remove('kp-ms-theme-light', 'kp-ms-theme-dark');
    root.classList.add(theme === 'dark' ? 'kp-ms-theme-dark' : 'kp-ms-theme-light');
  }

  /**
   * Отрисовка загрузки
   */
  function renderLoading(container, text = 'Проверка...') {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const badge = document.createElement('div');
    badge.className = 'kp-ms-badge kp-ms-badge-loading';

    const spinner = document.createElement('div');
    spinner.className = 'kp-ms-spinner';

    const label = document.createElement('span');
    label.className = 'kp-ms-text';
    label.textContent = text;

    badge.append(spinner, label);
    root.replaceChildren(badge);
  }

  /**
   * Отрисовка ошибки / предупреждения
   */
  function renderWarning(container, text, tooltip, action = null) {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const tooltipContainer = document.createElement('div');
    tooltipContainer.className = 'kp-ms-tooltip-container';

    const badge = document.createElement('div');
    badge.className = 'kp-ms-badge kp-ms-badge-warning';
    badge.id = 'kp-ms-warning-btn';
    badge.appendChild(ICONS.warning());

    const label = document.createElement('span');
    label.className = 'kp-ms-text';
    label.textContent = text;
    badge.appendChild(label);

    tooltipContainer.appendChild(badge);

    if (tooltip) {
      const tip = document.createElement('div');
      tip.className = 'kp-ms-tooltip';
      tip.textContent = tooltip;
      tooltipContainer.appendChild(tip);
    }

    if (action) {
      badge.onclick = action;
    }

    root.replaceChildren(tooltipContainer);
  }

  /**
   * Отрисовка кнопки «Скачать» (в нативном сером стиле кнопки «Буду смотреть»)
   */
  function renderDownload(container, meta, tmdbId) {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const btn = document.createElement('button');
    btn.className = 'kp-ms-btn kp-ms-btn-download';
    btn.id = 'kp-ms-download-btn';
    btn.title = 'Отправить запрос на скачивание в Jellyseerr';
    btn.appendChild(ICONS.download());

    const span = document.createElement('span');
    span.textContent = 'Скачать';
    btn.appendChild(span);

    btn.onclick = async () => {
      btn.disabled = true;
      renderLoading(container, 'Отправка запроса...');

      try {
        const res = await extApi.runtime.sendMessage({
          action: 'REQUEST_DOWNLOAD',
          meta: { ...meta, tmdbId }
        });

        if (res && res.success) {
          renderState(container, res.updatedStatus, meta);
        } else {
          renderWarning(container, 'Ошибка', res?.error || 'Не удалось отправить запрос в Jellyseerr');
        }
      } catch (err) {
        renderWarning(container, 'Ошибка', err.message);
      }
    };

    root.replaceChildren(btn);
  }

  /**
   * Отрисовка состояния «Запрошен» (серый фон + янтарный значок)
   */
  function renderRequested(container) {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const tooltipContainer = document.createElement('div');
    tooltipContainer.className = 'kp-ms-tooltip-container';

    const badge = document.createElement('div');
    badge.className = 'kp-ms-badge kp-ms-badge-requested';
    badge.appendChild(ICONS.clock());

    const span = document.createElement('span');
    span.textContent = 'Запрошен';
    badge.appendChild(span);

    const tip = document.createElement('div');
    tip.className = 'kp-ms-tooltip';
    tip.textContent = 'Фильм запрошен в медиастеке и ожидает загрузки';

    tooltipContainer.append(badge, tip);
    root.replaceChildren(tooltipContainer);
  }

  /**
   * Отрисовка состояния «Качается (X%)» (серый фон + синяя полоса)
   */
  function renderDownloading(container, progress) {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const percentText = progress !== null ? ` ${progress}%` : '';
    const progressWidth = progress !== null ? Math.min(100, Math.max(5, progress)) : 100;

    const tooltipContainer = document.createElement('div');
    tooltipContainer.className = 'kp-ms-tooltip-container';

    const badge = document.createElement('div');
    badge.className = 'kp-ms-badge kp-ms-badge-downloading';

    const spinner = document.createElement('div');
    spinner.className = 'kp-ms-spinner';

    const label = document.createElement('span');
    label.className = 'kp-ms-text';
    label.textContent = `Качается${percentText}`;

    const bar = document.createElement('div');
    bar.className = 'kp-ms-progress-bar';
    bar.style.width = `${progressWidth}%`;

    badge.append(spinner, label, bar);

    const tip = document.createElement('div');
    tip.className = 'kp-ms-tooltip';
    tip.textContent = 'Тайтл активно загружается торрент-клиентом';

    tooltipContainer.append(badge, tip);
    root.replaceChildren(tooltipContainer);
  }

  /**
   * Отрисовка «Смотреть в Jellyfin» (острый Play треугольник) + серый бейдж «Скачан»
   */
  function renderAvailable(container, jellyfinUrl) {
    const root = getOrCreateWidget(container);
    if (!root) return;

    const elements = [];

    if (jellyfinUrl) {
      const link = document.createElement('a');
      link.className = 'kp-ms-btn kp-ms-btn-watch';
      link.id = 'kp-ms-watch-link';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = 'Смотреть прямо в Jellyfin';
      link.href = jellyfinUrl;
      link.appendChild(ICONS.play());

      const spanWatch = document.createElement('span');
      spanWatch.textContent = 'Смотреть в Jellyfin';
      link.appendChild(spanWatch);

      elements.push(link);
    }

    const badge = document.createElement('div');
    badge.className = 'kp-ms-badge kp-ms-badge-available';
    badge.title = 'Фильм находится в вашей домашней медиатеке';
    badge.appendChild(ICONS.check());

    const spanDownloaded = document.createElement('span');
    spanDownloaded.textContent = 'Скачан';
    badge.appendChild(spanDownloaded);

    elements.push(badge);

    root.replaceChildren(...elements);
  }

  /**
   * Главный диспетчер отрисовки
   */
  function renderState(container, res, meta) {
    if (!res) {
      renderWarning(container, 'Нет данных', 'Не удалось получить статус');
      return;
    }

    switch (res.status) {
      case 'NOT_CONFIGURED':
        renderWarning(container, 'Настроить стек', res.message || 'Кликните, чтобы открыть настройки расширения', () => {
          extApi.runtime.sendMessage({ action: 'OPEN_OPTIONS' });
        });
        break;

      case 'AVAILABLE':
        renderAvailable(container, res.jellyfinUrl);
        break;

      case 'DOWNLOADING':
        renderDownloading(container, res.progress);
        break;

      case 'REQUESTED':
        renderRequested(container);
        break;

      case 'NOT_REQUESTED':
        renderDownload(container, meta, res.tmdbId);
        break;

      case 'NOT_FOUND':
        renderWarning(container, 'Не найден', 'Фильм не найден в каталоге TMDb/Jellyseerr');
        break;

      case 'ERROR':
      default:
        renderWarning(container, 'Ошибка стека', res.message || 'Проверьте соединение с сервером');
        break;
    }
  }

  /**
   * Инициализация виджета
   */
  async function initWidget(force = false) {
    const meta = extractPageMetadata();
    if (!meta) return;

    const reqId = meta.kinopoiskId;
    if (!force && currentActiveId === reqId && document.getElementById('kp-ms-widget')) {
      return;
    }

    currentActiveId = reqId;

    // Ждем появления контейнера кнопок
    const container = await waitForContainer();
    if (!container || currentActiveId !== reqId) return;

    renderLoading(container);

    try {
      const response = await extApi.runtime.sendMessage({
        action: 'CHECK_STATUS',
        meta
      });

      if (currentActiveId !== reqId) return;
      renderState(container, response, meta);
    } catch (err) {
      console.error('[Content] Check status error:', err);
      if (currentActiveId === reqId) {
        renderWarning(container, 'Ошибка', err.message);
      }
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
      currentActiveId = null;
      setTimeout(() => initWidget(true), 250);
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
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWidget());
  } else {
    initWidget();
  }
})();
