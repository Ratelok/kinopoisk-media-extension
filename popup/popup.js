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
    movieCard.innerHTML = `
      <div class="not-kinopoisk-msg">
        Откройте страницу фильма или сериала на <strong>Кинопоиске</strong> для управления загрузкой и просмотром.
      </div>
    `;
  }

  function renderMovieStatus(res, tabId) {
    if (!res || res.status === 'NOT_CONFIGURED') {
      movieCard.innerHTML = `
        <div class="not-kinopoisk-msg">
          Медиастек еще не настроен. Нажмите иконку шестеренки вверху для ввода адреса сервера и ключа.
        </div>
      `;
      return;
    }

    const title = res.title || 'Фильм на Кинопоиске';
    const orig = res.originalTitle && res.originalTitle !== title ? res.originalTitle : '';

    let badgeClass = 'status-not_requested';
    let badgeText = 'Не в медиатеке';
    let actionBtnHtml = '';

    if (res.status === 'AVAILABLE') {
      badgeClass = 'status-available';
      badgeText = '✓ В медиатеке Jellyfin';
      if (res.jellyfinUrl) {
        actionBtnHtml = `
          <a class="card-action-btn btn-watch" href="${res.jellyfinUrl}" target="_blank">
            ▶ Смотреть в Jellyfin
          </a>
        `;
      }
    } else if (res.status === 'DOWNLOADING') {
      badgeClass = 'status-downloading';
      badgeText = `⏬ Качается (${res.progress || 0}%)`;
    } else if (res.status === 'REQUESTED') {
      badgeClass = 'status-requested';
      badgeText = '🕒 Запрошен';
    } else {
      actionBtnHtml = `
        <button class="card-action-btn btn-download" id="popupBtnDownload">
          📥 Скачать в медиастек
        </button>
      `;
    }

    movieCard.innerHTML = `
      <div class="movie-info">
        <div class="movie-title">${title}</div>
        ${orig ? `<div class="movie-orig-title">${orig}</div>` : ''}
      </div>
      <div class="status-badge ${badgeClass}">${badgeText}</div>
      ${actionBtnHtml}
    `;

    const downloadBtn = movieCard.querySelector('#popupBtnDownload');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Отправка...';
        await extApi.runtime.sendMessage({
          action: 'REQUEST_DOWNLOAD',
          meta: res.meta || { tmdbId: res.tmdbId, mediaType: res.mediaType }
        });
        window.close();
      });
    }
  }
});
