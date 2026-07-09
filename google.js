// ====== НАСТРОЙКИ ======
const SPREADSHEET_ID = 'ВСТАВЬТЕ_ID_ТАБЛИЦЫ';
// Фильтр по пути (регистронезависимо). Пустая строка '' = весь Drive.
const PATH_FILTER = 'My Drive/Backup all/Photo';
// =======================

// ---------- ФАЗА 1: сбор метаданных всех изображений ----------
// Запускайте scanDrive. Если упрётся в лимит времени — просто запустите ещё раз,
// продолжит с сохранённой позиции. Когда допишет всё — сообщит в логе.
function scanDrive() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('RawFiles');
  let pageToken = props.getProperty('pageToken');

  if (!sheet) {
    sheet = ss.insertSheet('RawFiles');
    sheet.appendRow(['FileId', 'Name', 'SizeBytes', 'Modified', 'MD5', 'ParentId']);
    pageToken = null;
    props.deleteProperty('scanDone');
  }
  if (props.getProperty('scanDone') === 'true') {
    Logger.log('Сканирование уже завершено. Запустите buildReport.');
    return;
  }

  const startTime = Date.now();
  const MAX_MS = 4.5 * 60 * 1000; // запас до 6-минутного лимита
  let total = 0;

  do {
    const resp = Drive.Files.list({
      q: "mimeType contains 'image/' and trashed = false",
      pageSize: 1000,
      fields: 'nextPageToken, files(id, name, size, md5Checksum, modifiedTime, parents)',
      pageToken: pageToken || undefined
    });

    const rows = (resp.files || [])
      .filter(f => f.md5Checksum) // у Google-форматов хэша нет
      .map(f => [f.id, f.name, f.size || 0, f.modifiedTime || '',
                 f.md5Checksum, (f.parents && f.parents[0]) || '']);
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
      total += rows.length;
    }

    pageToken = resp.nextPageToken;
    props.setProperty('pageToken', pageToken || '');

    if (Date.now() - startTime > MAX_MS) {
      Logger.log('Лимит времени. Добавлено файлов: ' + total +
                 '. Запустите scanDrive ещё раз для продолжения.');
      return;
    }
  } while (pageToken);

  props.setProperty('scanDone', 'true');
  props.deleteProperty('pageToken');
  Logger.log('Сканирование завершено. Всего в RawFiles: ' + (sheet.getLastRow() - 1) +
             '. Теперь запустите buildReport.');
}

// ---------- ФАЗА 2: группировка по MD5 и отчёт с путями ----------
function buildReport() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const raw = ss.getSheetByName('RawFiles');
  if (!raw) { Logger.log('Сначала запустите scanDrive.'); return; }

  const data = raw.getDataRange().getValues();
  data.shift(); // заголовок
  Logger.log('Файлов в индексе: ' + data.length);

  // Группируем по MD5
  const byHash = {};
  data.forEach(r => {
    const md5 = r[4];
    (byHash[md5] = byHash[md5] || []).push(r);
  });
  const dupGroups = Object.values(byHash).filter(g => g.length > 1);
  Logger.log('Групп с одинаковым содержимым: ' + dupGroups.length);

  // Кэш путей папок, чтобы не дёргать API повторно
  const pathCache = {};
  function folderPath(id) {
    if (!id) return '(без папки)';
    if (pathCache[id]) return pathCache[id];
    let parts = [], cur = id, depth = 0;
    while (cur && depth < 30) {
      if (pathCache[cur]) { parts.unshift(pathCache[cur]); break; }
      try {
        const f = Drive.Files.get(cur, { fields: 'id, name, parents' });
        parts.unshift(f.name);
        cur = (f.parents && f.parents[0]) || null;
      } catch (e) { parts.unshift('?'); break; }
      depth++;
    }
    const p = parts.join('/');
    pathCache[id] = p;
    return p;
  }

  let out = ss.getSheetByName('Duplicates');
  if (out) ss.deleteSheet(out);
  out = ss.insertSheet('Duplicates');
  out.appendRow(['Group', 'FileName', 'SizeBytes', 'Modified', 'MD5', 'FolderPath', 'Link']);

  const filter = PATH_FILTER.toLowerCase();
  let groupNo = 0, rows = [];

  dupGroups.forEach(g => {
    const enriched = g.map(r => {
      const path = folderPath(r[5]);
      return { row: r, path: path };
    });
    // фильтр: хотя бы один файл группы внутри нужной папки
    if (filter && !enriched.some(e => e.path.toLowerCase().indexOf(filter) === 0)) return;

    groupNo++;
    enriched.forEach(e => {
      rows.push([groupNo, e.row[1], e.row[2], e.row[3], e.row[4], e.path,
                 'https://drive.google.com/file/d/' + e.row[0] + '/view']);
    });
  });

  if (rows.length) {
    out.getRange(2, 1, rows.length, 7).setValues(rows);
    Logger.log('Готово: ' + groupNo + ' групп, ' + rows.length + ' файлов на листе Duplicates.');
  } else {
    Logger.log('Дубликаты не найдены (с учётом фильтра пути).');
  }
}

// ---------- Сброс, если нужно начать заново ----------
function resetScan() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('pageToken');
  props.deleteProperty('scanDone');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const raw = ss.getSheetByName('RawFiles');
  if (raw) ss.deleteSheet(raw);
  Logger.log('Состояние сброшено.');
}
