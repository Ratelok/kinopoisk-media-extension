/**
 * Kinopoisk MediaStack Extension - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  const movieCard = document.getElementById('movieCard');
  const btnOpenOptions = document.getElementById('btnOpenOptions');
  const btnOpenJellyseerr = document.getElementById('btnOpenJellyseerr');
  const btnOpenJellyfin = document.getElementById('btnOpenJellyfin');

  // Получаем настройки для быстрых ссылок
  const settings = await new Promise((resolve) => {
    extApi.runtime.sendMessage({ action: 'GET_SETTINGS' }, (res) => resolve(res || {}));
  });

  btnOpenOptions.addEventListener('click', () => {
    if (extApi.runtime.openOptionsPage) {
      extApi.runtime.openOptionsPage();
    } else {
      extApi.tabs.create({ url: extApi.runtime.getURL('options/options.html') });
    }
  });

  btnOpenJellyseerr.addEventListener('click', () => {
    if (settings.jellyseerrUrl) {
      extApi.tabs.create({ url: settings.jellyseerrUrl });
    } else {
      btnOpenOptions.click();
    }
  });

  btnOpenJellyfin.addEventListener('click', () => {
    if (settings.jellyfinUrl) {
      extApi.tabs.create({ url: settings.jellyfinUrl });
    } else {
      btnOpenOptions.click();
    }
  });

  // Проверяем текущую вкладку
  try {
    const [tab] = await extApi.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      renderNotKinopoisk();
      return;
    }

    const isKinopoiskMovie = tab.url.match(/kinopoisk\.ru\/(film|series)\/(\d+)/);
    if (!isKinopoiskMovie) {
      renderNotKinopoisk();
      return;
    }

    // Запрашиваем статус у фонового скрипта
    const urlMatch = isKinopoiskMovie;
    const kpId = urlMatch[2];
    const type = urlMatch[1] === 'series' ? 'tv' : 'movie';

    const statusRes = await extApi.runtime.sendMessage({
      action: 'CHECK_STATUS',
      meta: { kinopoiskId: kpId, type }
    });

    renderMovieStatus(statusRes, tab.id);
  } catch (err) {
    console.error('Popup init error:', err);
    renderNotKinopoisk();
  }

  function renderNotKinopoisk() {
    const msg = document.createElement('div');
    msg.className = 'not-kinopoisk-msg';
    const strong = document.createElement('strong');
    strong.textContent = 'Кинопоиске';
    msg.append('Откройте страницу фильма или сериала на ', strong, ' для управления загрузкой и просмотром.');
    movieCard.replaceChildren(msg);
  }

  function renderMovieStatus(res, tabId) {
    if (!res || res.status === 'NOT_CONFIGURED') {
      const msg = document.createElement('div');
      msg.className = 'not-kinopoisk-msg';
      msg.textContent = 'Медиастек еще не настроен. Нажмите иконку шестеренки вверху для ввода адреса сервера и ключа.';
      movieCard.replaceChildren(msg);
      return;
    }

    const title = res.title || 'Фильм на Кинопоиске';
    const orig = res.originalTitle && res.originalTitle !== title ? res.originalTitle : '';

    let badgeClass = 'status-not_requested';
    let badgeText = 'Не в медиатеке';

    if (res.status === 'AVAILABLE') {
      badgeClass = 'status-available';
      badgeText = '✓ В медиатеке Jellyfin';
    } else if (res.status === 'DOWNLOADING') {
      badgeClass = 'status-downloading';
      badgeText = `⏬ Качается (${res.progress || 0}%)`;
    } else if (res.status === 'REQUESTED') {
      badgeClass = 'status-requested';
      badgeText = '🕒 Запрошен';
    }

    const movieInfo = document.createElement('div');
    movieInfo.className = 'movie-info';

    const movieTitle = document.createElement('div');
    movieTitle.className = 'movie-title';
    movieTitle.textContent = title;
    movieInfo.appendChild(movieTitle);

    if (orig) {
      const movieOrigTitle = document.createElement('div');
      movieOrigTitle.className = 'movie-orig-title';
      movieOrigTitle.textContent = orig;
      movieInfo.appendChild(movieOrigTitle);
    }

    const badge = document.createElement('div');
    badge.className = `status-badge ${badgeClass}`;
    badge.textContent = badgeText;

    const elements = [movieInfo, badge];

    if (res.status === 'AVAILABLE') {
      if (res.jellyfinUrl) {
        const watchLink = document.createElement('a');
        watchLink.className = 'card-action-btn btn-watch';
        watchLink.href = res.jellyfinUrl;
        watchLink.target = '_blank';
        watchLink.rel = 'noopener noreferrer';
        watchLink.textContent = '▶ Смотреть в Jellyfin';
        elements.push(watchLink);
      }
    } else if (res.status !== 'DOWNLOADING' && res.status !== 'REQUESTED') {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'card-action-btn btn-download';
      downloadBtn.id = 'popupBtnDownload';
      downloadBtn.textContent = '📥 Скачать в медиастек';
      downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Отправка...';
        await extApi.runtime.sendMessage({
          action: 'REQUEST_DOWNLOAD',
          meta: res.meta || { tmdbId: res.tmdbId, mediaType: res.mediaType }
        });
        window.close();
      });
      elements.push(downloadBtn);
    }

    movieCard.replaceChildren(...elements);
  }
});
