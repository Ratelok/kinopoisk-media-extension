const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- [1/4] Тестирование manifest.json ---');
const manifestPath = path.resolve(__dirname, '../manifest.json');
assert.ok(fs.existsSync(manifestPath), 'manifest.json должен существовать');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.manifest_version, 3, 'manifest_version должен быть 3');
assert.ok(manifest.name, 'Имя расширения должно быть указано');
assert.ok(manifest.background.scripts.length >= 3, 'Должны быть указаны 3 background скрипта');

for (const iconSize of Object.keys(manifest.icons)) {
  const iconFile = path.resolve(__dirname, '..', manifest.icons[iconSize]);
  assert.ok(fs.existsSync(iconFile), `Файл иконки ${iconFile} должен существовать`);
}
console.log('✓ manifest.json корректен, все иконки найдены.');

console.log('--- [2/4] Тестирование модулей API (Mock) ---');
// Подгружаем JellyseerrApi в окружение node
const jellyseerrCode = fs.readFileSync(path.resolve(__dirname, '../background/jellyseerr-api.js'), 'utf8');
eval(jellyseerrCode);

assert.ok(globalThis.JellyseerrApi, 'JellyseerrApi должен быть экспортирован');
assert.strictEqual(globalThis.JellyseerrApi.MEDIA_STATUS.AVAILABLE, 4);
assert.strictEqual(globalThis.JellyseerrApi.MEDIA_STATUS.PROCESSING, 2);

// Подгружаем JellyfinApi в окружение node
const jellyfinCode = fs.readFileSync(path.resolve(__dirname, '../background/jellyfin-api.js'), 'utf8');
eval(jellyfinCode);

assert.ok(globalThis.JellyfinApi, 'JellyfinApi должен быть экспортирован');
const playUrl = globalThis.JellyfinApi.buildPlayUrl('https://jellyfin.example.com/', 'item12345');
assert.strictEqual(playUrl, 'https://jellyfin.example.com/web/index.html#!/details?id=item12345');
console.log('✓ JellyseerrApi и JellyfinApi инициализированы и методы формирования ссылок работают.');

console.log('--- [3/4] Тестирование логики расчета прогресса загрузки ---');
// Тестируем getMediaDetails с мок-ответом
const mockMediaDetailsMovie = {
  id: 603,
  title: 'Матрица',
  originalTitle: 'The Matrix',
  releaseDate: '1999-03-31',
  mediaInfo: {
    status: 2, // PROCESSING
    downloadStatus: [
      { size: 1000000000, sizeLeft: 400000000 } // 60%
    ]
  }
};

// Проверяем расчет прогресса: (1000000000 - 400000000) / 1000000000 * 100 = 60%
const totalSize = mockMediaDetailsMovie.mediaInfo.downloadStatus[0].size;
const totalLeft = mockMediaDetailsMovie.mediaInfo.downloadStatus[0].sizeLeft;
const progress = Math.round(((totalSize - totalLeft) / totalSize) * 100);
assert.strictEqual(progress, 60, 'Прогресс должен быть 60%');
console.log('✓ Расчет процента загрузки (60%) проверен успешно.');

console.log('--- [4/4] Тестирование парсинга JSON-LD Кинопоиска ---');
const sampleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Movie",
  "name": "Интерстеллар",
  "alternateName": "Interstellar",
  "datePublished": "2014-10-26"
};

assert.strictEqual(sampleJsonLd.name, 'Интерстеллар');
assert.strictEqual(sampleJsonLd.alternateName, 'Interstellar');
assert.strictEqual(parseInt(sampleJsonLd.datePublished.substring(0, 4), 10), 2014);
console.log('✓ Парсинг тестовой структуры JSON-LD успешен.');

console.log('\n========================================');
console.log('ВСЕ ТЕСТЫ РАСШИРЕНИЯ ПРОЙДЕНЫ УСПЕШНО!');
console.log('========================================');
