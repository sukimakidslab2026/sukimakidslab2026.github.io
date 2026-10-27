/**
 * スタンプラリー：Supabase → Googleスプレッドシート 同期スクリプト（Google Apps Script）
 *
 * - Supabaseが正本です。このスクリプトはSupabaseから読み取るだけで、書き戻しはしません。
 * - 5分ごとに「前回から変化があったか」を軽い問い合わせで確認し、変化がなければ何も書き換えません。
 *   変化があったときだけデータを取得して、各シートを書き直します（手で編集した内容は消えます）。
 * - Google側の認証情報は不要です（このスクリプトは、自分が属するスプレッドシート、
 *   または SPREADSHEET_ID で指定したスプレッドシートに書き込みます）。
 * - Supabaseのservice_role key / secret key は使いません。
 *
 * スクリプトプロパティ（プロジェクトの設定 > スクリプト プロパティ）
 *   SUPABASE_URL              例: https://xxxx.supabase.co（js/config.js と同じ）
 *   SUPABASE_PUBLISHABLE_KEY  js/config.js と同じ公開キー（sb_publishable_...）
 *   SHEETS_SYNC_TOKEN         SQL Editorで select private.issue_sheets_token(); を実行して表示された値
 *   SPREADSHEET_ID            書き込み先スプレッドシートのID。スプレッドシートの「拡張機能 > Apps Script」から作った場合は不要。
 *                             script.google.com で単体のスクリプトとして作った場合は必須（URLの /d/ と /edit の間の文字列）。
 *   SYNC_SHIPPING             "true" のときだけ景品発送情報（個人情報）を同期します。未設定なら同期しません。
 *   SHIPPING_SPREADSHEET_ID   景品発送情報を書き込む別のスプレッドシートのID（推奨）。未設定ならこのスプレッドシート。
 *   （LAST_SYNC_STATE / DECORATED_LAYOUT はこのスクリプトが自動で管理します。触らないでください）
 */

// シートの列や見た目を変えたときに上げる数字。変えると、次の同期で全シートを作り直します。
const LAYOUT_VERSION = '3';
const SYNC_MINUTES = 5;

const SUMMARY_SHEET = '概要';
const PARTICIPANT_SHEET = '参加者';
const SPOT_SHEET = '掲示板別';
const LEGACY_SPOT_SHEET = 'スポット別'; // 旧版のシート名（この名前のシートが残っていたら、概要に削除を促す表示を出す）
const SURVEY_SHEET = 'アンケート';
const SCAN_SHEET = 'スキャン履歴';
const SHIPPING_SHEET = '景品発送（個人情報）';
const FREE_SHEET = 'メモ・分析用';
const SUMMARY_WIDTH = 5;

const PROP_LAST_STATE = 'LAST_SYNC_STATE';
const PROP_DECORATED = 'DECORATED_LAYOUT';

// セルの表示形式。text は「書式なしテキスト」で、電話番号の先頭の0が消えたり、
// 「=」で始まる文字が数式として実行されたりするのを防ぎます。
const FORMATS = {
  text: '@',
  datetime: 'yyyy/mm/dd hh:mm:ss',
  stamp: 'm/d hh:mm',
  int: '#,##0',
  pct: '0.0%',
  dec: '0.00',
};

// 列の定義：見出し・データのキー・種類・列幅(px)・折り返し
const PARTICIPANT_COLUMNS = [
  { title: '参加者ID', key: 'participant_id', type: 'text', width: 110 },
  { title: '状態', key: 'status', type: 'text', width: 100 },
  { title: '獲得数', key: 'stamps', type: 'int', width: 60 },
  { title: 'コンプリート日時', key: 'completed_at', type: 'datetime', width: 150 },
  { title: '取得順（掲示板の番号）', key: 'route', type: 'text', width: 380 },
  { title: '最初の読み取り', key: 'first_scan_at', type: 'datetime', width: 150 },
  { title: '最後の読み取り', key: 'last_scan_at', type: 'datetime', width: 150 },
  { title: '読み取り回数', key: 'total_scans', type: 'int', width: 90 },
  { title: '再スキャン回数', key: 'rescans', type: 'int', width: 100 },
  { title: '端末', key: 'device', type: 'text', width: 110 },
  { title: 'アンケート', key: 'survey', type: 'text', width: 90 },
  { title: 'ワークショップ', key: 'workshop', type: 'text', width: 160 },
];
const SPOT_COLUMNS = [
  { title: '掲示板', key: 'stamp_name', type: 'text', width: 110 },
  { title: '総読み取り回数', key: 'total_scans', type: 'int', width: 110 },
  { title: 'ユニーク参加者数', key: 'unique_participants', type: 'int', width: 120 },
  { title: '再スキャン回数', key: 'rescans', type: 'int', width: 110 },
  { title: '取得者数', key: 'claimed_participants', type: 'int', width: 90 },
  { title: '取得率（取得者÷参加者）', key: 'acquisition_rate', type: 'pct', width: 170 },
];
const SURVEY_COLUMNS = [
  { title: '回答日時', key: 'submitted_at', type: 'datetime', width: 150 },
  { title: '参加者ID', key: 'participant_id', type: 'text', width: 110 },
  { title: '満足度（1〜5）', key: 'satisfaction', type: 'int', width: 100 },
  { title: 'コメント', key: 'comment', type: 'text', width: 380, wrap: true },
  { title: 'ワークショップ参加', key: 'workshop', type: 'text', width: 170 },
  { title: '景品', key: 'prize', type: 'text', width: 90 },
];
const SCAN_COLUMNS = [
  { title: '読み取り日時', key: 'scanned_at', type: 'datetime', width: 150 },
  { title: '参加者ID', key: 'participant_id', type: 'text', width: 110 },
  { title: '掲示板', key: 'stamp_name', type: 'text', width: 100 },
  { title: '種別', key: 'scan_type', type: 'text', width: 90 },
  { title: '端末', key: 'device', type: 'text', width: 110 },
  { title: '再送', key: 'resend', type: 'text', width: 60 },
];
const SHIPPING_COLUMNS = [
  { title: '回答日時', key: 'submitted_at', type: 'datetime', width: 150 },
  { title: '参加者ID', key: 'participant_id', type: 'text', width: 110 },
  { title: '氏名', key: 'recipient_name', type: 'text', width: 140 },
  { title: '郵便番号', key: 'postal_code', type: 'text', width: 100 },
  { title: '住所', key: 'address', type: 'text', width: 380, wrap: true },
  { title: '電話番号', key: 'phone', type: 'text', width: 130 },
  { title: '同意した規約の版', key: 'privacy_version', type: 'text', width: 150 },
];

// ============================================================
// メニュー・初期設定
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('スタンプラリー同期')
    .addItem('今すぐ同期（変更があれば更新）', 'syncNow')
    .addItem('全体を強制的に書き直す', 'forceFullSync')
    .addItem('自動同期を開始（5分ごと）', 'setup')
    .addItem('自動同期を停止', 'stopAutoSync')
    .addToUi();
}

// 書き込み先：スプレッドシートに紐づいたスクリプトならそのファイル、単体のスクリプトなら SPREADSHEET_ID のファイル
function targetSpreadsheet_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  const id = (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (!id) {
    throw new Error('書き込み先のスプレッドシートが分かりません。スクリプトプロパティ SPREADSHEET_ID にスプレッドシートのIDを設定してください。');
  }
  return SpreadsheetApp.openById(id);
}

/** 初回、またはスクリプトを入れ替えたときに1回実行：タイムゾーン設定・5分ごとの自動同期・全体の書き直し */
function setup() {
  const ss = targetSpreadsheet_();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');
  stopAutoSync();
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(SYNC_MINUTES).create();
  PropertiesService.getScriptProperties().deleteProperty(PROP_LAST_STATE); // 必ず全体を書き直す
  syncNow();
  ensureFreeSheet_(ss);
}

function stopAutoSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function forceFullSync() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_LAST_STATE);
  syncNow();
}

// ============================================================
// 同期の本体
// ============================================================
function syncNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return; // 前回の同期が実行中
  let ss = null;
  try {
    ss = targetSpreadsheet_();
    const config = readConfig_();
    const props = PropertiesService.getScriptProperties();

    // 1. 軽い問い合わせ：Supabaseのデータが前回から変わったかだけを確認する
    const version = fetchVersion_(config);
    if (props.getProperty(PROP_LAST_STATE) === stateKey_(config, version) && sheetsExist_(ss, config)) {
      heartbeat_(ss); // 変更なし：シートは書き換えず、「確認した時刻」だけを更新する
      return;
    }

    // 2. 変わっていたときだけ、全データを取得して書き直す
    fullSync_(ss, config, props);
  } catch (error) {
    const message = String(error && error.message || error);
    if (ss) safe_(() => writeError_(ss, message));
    throw error; // トリガー実行の失敗としてGoogleから通知メールが届きます
  } finally {
    lock.releaseLock();
  }
}

// 前回の同期と同じ状態かを見分けるための印。データの指紋のほか、スクリプトの版や設定が変わったときも変わる。
function stateKey_(config, version) {
  return [LAYOUT_VERSION, config.syncShipping ? 'ship' : 'noship', config.shippingSpreadsheetId, version].join('|');
}

function sheetsExist_(ss, config) {
  const names = [SUMMARY_SHEET, PARTICIPANT_SHEET, SPOT_SHEET, SURVEY_SHEET, SCAN_SHEET];
  if (config.syncShipping && !config.shippingSpreadsheetId) names.push(SHIPPING_SHEET);
  return names.every(name => ss.getSheetByName(name) !== null);
}

function fullSync_(ss, config, props) {
  const data = fetchExport_(config);
  // 版が変わった（または初回）ときは、全シートを消して見た目から作り直す。通常は中身だけを入れ替える。
  const ctx = { layoutChanged: props.getProperty(PROP_DECORATED) !== LAYOUT_VERSION, created: {} };

  ensureSheets_(ss, [SUMMARY_SHEET, PARTICIPANT_SHEET, SPOT_SHEET, SURVEY_SHEET, SCAN_SHEET], ctx);
  removeBlankDefaultSheet_(ss);
  writeTable_(ss, PARTICIPANT_SHEET, PARTICIPANT_COLUMNS, data.participants, ctx);
  writeTable_(ss, SPOT_SHEET, SPOT_COLUMNS, data.spots, ctx);
  writeTable_(ss, SURVEY_SHEET, SURVEY_COLUMNS, data.surveys, ctx);
  writeTable_(ss, SCAN_SHEET, SCAN_COLUMNS, data.scans, ctx);
  if (config.syncShipping) writeShipping_(ss, config, data, ctx);
  writeSummary_(ss, data, config, ctx);

  // 最後まで書けたときだけ記録する（途中で失敗したら、次回もう一度やり直す）
  props.setProperties({
    [PROP_LAST_STATE]: stateKey_(config, data.version),
    [PROP_DECORATED]: LAYOUT_VERSION,
  });
}

function writeShipping_(ss, config, data, ctx) {
  const target = config.shippingSpreadsheetId ? SpreadsheetApp.openById(config.shippingSpreadsheetId) : ss;
  const shipCtx = { layoutChanged: ctx.layoutChanged, created: {} };
  ensureSheets_(target, [SHIPPING_SHEET], shipCtx);
  const rows = (data.shipping || []).map(r => Object.assign({}, r, { phone: formatPhone_(r.phone) }));
  writeTable_(target, SHIPPING_SHEET, SHIPPING_COLUMNS, rows, shipCtx);
}

// ============================================================
// Supabaseとの通信
// ============================================================
function readConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  const key = (props.getProperty('SUPABASE_PUBLISHABLE_KEY') || '').trim();
  const token = (props.getProperty('SHEETS_SYNC_TOKEN') || '').trim();
  if (!url || !key || !token) {
    throw new Error('スクリプトプロパティ SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SHEETS_SYNC_TOKEN を設定してください。');
  }
  return {
    url: url,
    key: key,
    token: token,
    syncShipping: (props.getProperty('SYNC_SHIPPING') || '').trim() === 'true',
    shippingSpreadsheetId: (props.getProperty('SHIPPING_SPREADSHEET_ID') || '').trim(),
  };
}

function rpc_(config, name, payload) {
  const response = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/' + name, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: config.key, Authorization: 'Bearer ' + config.key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code !== 200) {
    const hint = code === 404 ? '（Supabaseで最新の sql/schema.sql を実行したか確認してください）' : '';
    throw new Error('Supabaseからの取得に失敗しました（' + name + '、HTTP ' + code + '）' + hint + ': ' + body.slice(0, 300));
  }
  return JSON.parse(body);
}

// 軽い問い合わせ：データの「指紋」だけを返す（データ本体は転送しない）
function fetchVersion_(config) {
  return rpc_(config, 'sheets_version', { p_token: config.token });
}

function fetchExport_(config) {
  return rpc_(config, 'sheets_export', { p_token: config.token, p_include_shipping: config.syncShipping });
}

// ============================================================
// シートへの書き込み
// ============================================================
function ensureSheets_(ss, names, ctx) {
  names.forEach(name => {
    if (ss.getSheetByName(name)) return;
    ss.insertSheet(name, name === SUMMARY_SHEET ? 0 : ss.getSheets().length);
    ctx.created[name] = true;
  });
}

// 新しいスプレッドシートに最初からある空の「シート1」は、不要なので削除する（中身があれば触らない）
function removeBlankDefaultSheet_(ss) {
  ['シート1', 'Sheet1'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1 && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      ss.deleteSheet(sheet);
    }
  });
}

// シートの大きさが足りないと setValues が失敗するので、必要な分だけ行・列を増やす
function ensureSize_(sheet, rows, cols) {
  const maxRows = sheet.getMaxRows();
  const maxCols = sheet.getMaxColumns();
  if (maxRows < rows) sheet.insertRowsAfter(maxRows, rows - maxRows);
  if (maxCols < cols) sheet.insertColumnsAfter(maxCols, cols - maxCols);
}

function writeTable_(ss, name, columns, rows, ctx) {
  const sheet = ss.getSheetByName(name);
  const fresh = ctx.layoutChanged || ctx.created[name] === true;
  if (fresh) sheet.clear(); else sheet.clearContents(); // 通常は中身だけを消す（見た目・列幅・固定行は残る）

  const n = columns.length;
  const total = rows.length + 1;
  ensureSize_(sheet, total, n);

  if (rows.length) {
    // 値より先に表示形式を設定する（文字列を文字列のまま保存するため）
    const formats = columns.map(c => FORMATS[c.type]);
    sheet.getRange(2, 1, rows.length, n).setNumberFormats(rows.map(() => formats));
  }
  const values = [columns.map(c => c.title)].concat(rows.map(row => columns.map(c => convert_(row[c.key], c.type))));
  sheet.getRange(1, 1, total, n).setValues(values);

  if (fresh) decorateTable_(sheet, name, columns);
}

function convert_(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'datetime' || type === 'stamp') return new Date(value);
  if (type === 'int' || type === 'pct' || type === 'dec') return Number(value);
  return text_(value);
}

// 書式なしテキストのセルでは数式として扱われませんが、念のため「= + - @」で始まる文字には
// 先頭に半角スペースを入れます（コメント欄に悪意のある数式を書かれても実行されないようにするため）。
function text_(value) {
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? ' ' + s : s;
}

// 見た目の設定。見た目は失敗しても同期自体は成功させたいので、safe_ で包む。
function decorateTable_(sheet, name, columns) {
  const n = columns.length;
  safe_(() => {
    sheet.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#eef3f4');
    sheet.setFrozenRows(1);
    if (name === PARTICIPANT_SHEET) sheet.setFrozenColumns(1);
    columns.forEach((c, i) => sheet.setColumnWidth(i + 1, c.width || 100));
    columns.forEach((c, i) => {
      if (c.wrap) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    });
  });
  if (name === PARTICIPANT_SHEET) safe_(() => highlightCompleted_(sheet));
  safe_(() => protect_(sheet));
}

// 「状態」列が「コンプリート」のセルに色を付ける
function highlightCompleted_(sheet) {
  const range = sheet.getRange(2, 2, Math.max(sheet.getMaxRows() - 1, 1), 1);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('コンプリート')
    .setBackground('#dcecef')
    .setFontColor('#174b57')
    .setRanges([range])
    .build();
  sheet.setConditionalFormatRules([rule]);
}

// 手で編集しようとすると警告を出す（編集内容は次回の更新で消えるため）
function protect_(sheet) {
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
  sheet.protect()
    .setDescription('Supabaseから自動同期されるシートです。編集内容は、データが変わったときの次の更新で消えます。自由に使うシートは「' + FREE_SHEET + '」へ。')
    .setWarningOnly(true);
}

function safe_(fn) {
  try {
    fn();
  } catch (error) {
    console.warn('見た目の設定に失敗しました（同期は続けます）: ' + error);
  }
}

// 電話番号は、スプレッドシートで読みやすいようハイフン区切りにする（区切り位置は目安）
function formatPhone_(value) {
  const d = String(value === null || value === undefined ? '' : value);
  if (!/^0\d{9,10}$/.test(d)) return d;
  if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  if (d.indexOf('0120') === 0) return d.slice(0, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
  if (/^0[36]/.test(d)) return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6);
  return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

// ============================================================
// 「概要」シート
// ============================================================
function writeSummary_(ss, data, config, ctx) {
  const sheet = ss.getSheetByName(SUMMARY_SHEET);
  const now = new Date();
  const book = buildSummary_(data, config, now, ss);
  const rows = book.cells.length;

  sheet.clear(); // 概要は毎回すべて書き直す（見た目の設定もやり直す）
  ensureSize_(sheet, rows, SUMMARY_WIDTH);
  const range = sheet.getRange(1, 1, rows, SUMMARY_WIDTH);
  range.setNumberFormats(book.formats);
  range.setValues(book.values);
  safe_(() => {
    range.setBackgrounds(book.backgrounds);
    range.setFontWeights(book.weights);
    sheet.getRange(1, 1).setFontSize(14);
    if (ctx.layoutChanged || ctx.created[SUMMARY_SHEET]) {
      [230, 170, 170, 200, 150].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
    }
  });
  safe_(() => protect_(sheet));
}

// 概要シートの中身を組み立てる。cells の各行は { kind, cells } 。
// 2〜4行目（最終確認・最終更新・状態）は、変更がないときに heartbeat_ がその場所だけを書き換える。
function buildSummary_(data, config, now, ss) {
  const s = data.summary;
  const lines = [];
  const add = (kind, cells) => lines.push({ kind: kind, cells: cells || [] });
  const pct = (a, b) => (b > 0 ? { v: a / b, f: FORMATS.pct } : '');
  const dec = x => (x === null || x === undefined ? '' : { v: Number(x), f: FORMATS.dec });
  const sum = (list, key) => list.reduce((t, x) => t + Number(x[key] || 0), 0);

  let shippingText;
  if (!config.syncShipping) {
    shippingText = 'しない（個人情報はこのファイルに入れていません）';
    if (ss.getSheetByName(SHIPPING_SHEET)) {
      shippingText += '　※以前の「' + SHIPPING_SHEET + '」シートが残っています。不要なら削除してください。';
    }
  } else if (config.shippingSpreadsheetId) {
    shippingText = 'する（別のスプレッドシートの「' + SHIPPING_SHEET + '」シート）';
  } else {
    shippingText = 'する（このスプレッドシートの「' + SHIPPING_SHEET + '」シート）';
  }

  add('title', ['スタンプラリー 集計（自動同期）']);
  add('meta', ['最終確認（Supabaseを確認した時刻）', now, '更新しました（Supabaseのデータが変わっていました）']);
  add('meta', ['最終更新（このシートを書き換えた時刻）', now]);
  add('meta', ['状態', '正常']);
  add('meta', ['データの正本', 'Supabase（このファイルは閲覧・集計用です。データが変わると、同期されるシートは上書きされます。自由に使うシートは「' + FREE_SHEET + '」へ）']);
  add('meta', ['景品発送情報の同期', shippingText]);
  if (ss.getSheetByName(LEGACY_SPOT_SHEET)) {
    add('meta', ['旧シートについて', '以前の「' + LEGACY_SPOT_SHEET + '」シートが残っています。今は「' + SPOT_SHEET + '」シートに同期しています。不要なら削除してください。']);
  }
  add('blank');

  add('heading', ['■ 全体']);
  add('meta', ['参加者数', s.participants, 'QRを1回以上読み取った端末の数（除外した参加者は含みません）']);
  add('meta', ['クリア人数', s.completers, s.required + '個以上のスタンプを取得した人数（景品を希望できる条件を満たした人数）']);
  add('meta', ['クリア率', pct(s.completers, s.participants), 'クリア人数 ÷ 参加者数']);
  add('meta', ['総スキャン数', s.total_scans, '再スキャンを含む、QRの読み取り回数の合計']);
  add('meta', ['うち再スキャン', s.rescans, '取得済みのスタンプをもう一度読み取った回数']);
  add('meta', ['アンケート回答数', s.surveys]);
  add('meta', ['アンケート回答率', pct(s.surveys, s.completers), 'アンケート回答数 ÷ クリア人数']);
  add('meta', ['景品希望数', s.prize_requests]);
  add('meta', ['平均満足度', dec(s.avg_satisfaction), '5点満点']);
  add('meta', ['除外した参加者数', s.excluded_participants, 'テストなどで集計から外した人数（管理画面で設定。この表・各シートには含まれません）']);
  add('blank');

  add('heading', ['■ 獲得数別の人数（どこで離脱しているか）']);
  add('header', ['獲得数', 'ちょうどその数の人数', 'その数以上の人数', '参加者に対する割合（その数以上）']);
  data.funnel.forEach(f => add('body', [f.stamps + '個', f.exact, f.at_least, f.ratio === null ? '' : { v: Number(f.ratio), f: FORMATS.pct }]));
  add('blank');

  add('heading', ['■ ワークショップ参加別（アンケート回答者）']);
  add('header', ['ワークショップ参加', '回答数', '平均満足度', '景品希望数']);
  data.workshop.forEach(w => add('body', [w.label, w.responses, dec(w.avg_satisfaction), w.prize_requests]));
  add('body', ['合計', sum(data.workshop, 'responses'), dec(s.avg_satisfaction), sum(data.workshop, 'prize_requests')]);
  add('blank');

  add('heading', ['■ 満足度の分布']);
  add('header', ['満足度', '回答数']);
  data.satisfaction.forEach(x => add('body', [{ v: x.score, f: '0' }, x.count]));
  add('blank');

  add('heading', ['■ 日別（日本時間・新しい順）']);
  add('header', ['日付', '新規参加者', '読み取り数', 'コンプリート', 'アンケート回答']);
  data.daily.forEach(d => add('body', [d.date, d.new_participants, d.scans, d.completers, d.surveys]));

  const book = { cells: lines, values: [], formats: [], backgrounds: [], weights: [] };
  lines.forEach(line => {
    const values = [], formats = [], backgrounds = [], weights = [];
    for (let i = 0; i < SUMMARY_WIDTH; i++) {
      const cell = line.cells[i];
      const spec = (cell !== null && cell !== undefined && typeof cell === 'object' && !(cell instanceof Date)) ? cell : { v: cell };
      let v = spec.v === null || spec.v === undefined ? '' : spec.v;
      let f = spec.f;
      if (!f) f = v instanceof Date ? FORMATS.datetime : typeof v === 'number' ? FORMATS.int : FORMATS.text;
      if (typeof v === 'string') v = text_(v);
      values.push(v);
      formats.push(f);
      const heading = line.kind === 'heading', header = line.kind === 'header';
      backgrounds.push(heading ? '#dcecef' : header ? '#eef3f4' : null);
      weights.push(line.kind === 'title' || heading || header || (line.kind === 'meta' && i === 0) ? 'bold' : 'normal');
    }
    book.values.push(values);
    book.formats.push(formats);
    book.backgrounds.push(backgrounds);
    book.weights.push(weights);
  });
  return book;
}

// 変更がなかったとき：「最終確認」の時刻と状態だけを更新する（2セル分の書き込み）
function heartbeat_(ss) {
  const sheet = ss.getSheetByName(SUMMARY_SHEET);
  sheet.getRange('B2:C2').setValues([[new Date(), '変更なし（Supabaseのデータは前回から変わっていません）']]);
  sheet.getRange('B4').setValue('正常');
}

function writeError_(ss, message) {
  const sheet = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 0);
  const at = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  sheet.getRange('A4:B4').setValues([['状態', 'エラー（' + at + '）：' + text_(message)]]);
}

// 「メモ・分析用」シート：自動同期の対象外。メモや集計を自由に作れる場所として、初回に1回だけ作る。
function ensureFreeSheet_(ss) {
  if (ss.getSheetByName(FREE_SHEET)) return;
  const sheet = ss.insertSheet(FREE_SHEET, ss.getSheets().length);
  sheet.getRange('A1').setValue('このシートは自動同期の対象外です。メモ・集計・グラフ・発送管理などは、ここに自由に作ってください。').setFontWeight('bold');
  sheet.getRange('A3:A5').setValues([
    ['例1：コンプリートした人数'],
    ['例2：ワークショップ参加者の平均満足度'],
    ['例3：iPhoneからの読み取り回数'],
  ]);
  sheet.getRange('B3:B5').setFormulas([
    ["=COUNTIF('" + PARTICIPANT_SHEET + "'!B:B,\"コンプリート\")"],
    ["=IFERROR(AVERAGEIF('" + SURVEY_SHEET + "'!E:E,\"参加した\",'" + SURVEY_SHEET + "'!C:C),\"\")"],
    ["=COUNTIF('" + SCAN_SHEET + "'!E:E,\"iPhone\")"],
  ]);
  sheet.getRange('A7').setValue('※ 「概要」「参加者」「アンケート」などの同期されるシートは、データが変わるたびに中身が書き直されます。' +
    '列の追加・並べ替え・色付けは消えます。絞り込みや並べ替えをしたいときは、メニューの「データ → フィルタビュー」を使うと、書き直されても残ります。');
  sheet.setColumnWidth(1, 280);
}
