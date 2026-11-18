/*
 * この端末（このブラウザ）に保存された、サイトの履歴を確認して、すべて消す。
 *
 * 消すもの：localStorage（参加者ID・スタンプ・サーバーに未送信のスタンプ・アンケートに回答した印・
 *   ルール説明の「次回からは表示しない」などの設定・管理者のログイン情報）のすべて。
 *   あわせて、sessionStorage・Cache Storage・IndexedDB・Service Worker・Cookie も消す（今は使っていませんが、将来使っても、一緒に消えます）。
 * 消さないもの：サーバー（Supabase）に送信済みの記録。ほかの端末・ほかのブラウザの履歴。
 *
 * localStorage は、キーを指定せず、まるごと消します（新しい履歴の種類を足しても、消し忘れないように）。
 * 下の LABELS に載っているものは、名前をつけて一覧に出し、載っていないものは、「その他の履歴」として数えます
 * （scripts/check_site.py が、サイトが保存している履歴の名前が、LABELS に、すべて載っているかを確認します）。
 */
const $ = id => document.getElementById(id);

const LABELS = [
  { key: "stamp_rally_participant_id", name: "参加者ID", detail: v => v },
  { key: "stamp_rally_stamps", name: "取得したスタンプ", detail: v => `${listLength(v)}個` },
  { key: "stamp_rally_stamp_times", name: "スタンプを取った時刻" },
  { key: "stamp_rally_pending", name: "サーバーに、まだ送っていないスタンプ", detail: v => `${listLength(v)}個`, warn: v => listLength(v) > 0 ? "サーバーに送れていないスタンプが残っています。消すと、このスタンプは、記録されません。" : "" },
  { key: "stamp_rally_survey_submitted", name: "アンケートに回答した印" },
  { key: "stamp_rally_reset_count", name: "管理者のリセットの確認回数", detail: v => v },
  { key: "stamp_rally_fish_order", name: "お魚が増えていく順番（前回の保存）" },
  { key: "stamp_rally_hide_rules", name: "ルール説明の「次回からは表示しない」の設定", detail: v => v === "1" ? "表示しない" : "" },
];
const ADMIN_LOGIN = /^sb-.+-auth-token/;   // 管理者のログイン情報（Supabase Auth が保存するもの）

function listLength(value) {
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.length : 0;
  } catch (e) { return 0; }
}

// この端末に保存されている履歴を、すべて読む。戻り値：{entries: [[キー, 値], ...], blocked: 保存を許可していないか}
function readEntries() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      entries.push([key, localStorage.getItem(key)]);
    }
    return { entries, blocked: false };
  } catch (e) {
    return { entries: [], blocked: true };
  }
}

function describe(entries) {
  const items = [], warnings = [];
  let others = 0, admin = 0;
  for (const [key, value] of entries) {
    const label = LABELS.find(l => l.key === key);
    if (label) {
      const detail = label.detail ? label.detail(value) : "";
      items.push({ name: label.name, detail });
      const warning = label.warn ? label.warn(value) : "";
      if (warning) warnings.push(warning);
    } else if (ADMIN_LOGIN.test(key)) admin++;
    else others++;
  }
  if (admin) items.push({ name: "管理者のログイン情報", detail: "消すと、ログアウトされます" });
  if (others) items.push({ name: "その他の履歴", detail: `${others}件` });
  return { items, warnings };
}

function render() {
  const { entries, blocked } = readEntries();
  const { items, warnings } = describe(entries);
  const list = $("storedList");
  list.replaceChildren(...items.map(item => {
    const li = document.createElement("li");
    li.textContent = item.name;
    if (item.detail) {
      const span = document.createElement("span");
      span.className = "detail";
      span.textContent = `：${item.detail}`;
      li.append(span);
    }
    return li;
  }));
  for (const text of warnings) {
    const li = document.createElement("li");
    li.className = "warn-item";
    li.textContent = text;
    list.append(li);
  }
  $("storedEmpty").hidden = blocked || items.length > 0;
  $("storedBlocked").hidden = !blocked;
  return { count: entries.length, blocked };
}

function deleteDatabase(name) {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

// 履歴をすべて消す。戻り値：消す前にあった localStorage の件数
async function clearAll() {
  const before = readEntries().entries.length;
  try { localStorage.clear(); } catch (e) { /* 保存できない設定のブラウザでは、消すものがない */ }
  try { sessionStorage.clear(); } catch (e) { /* 同上 */ }
  try {
    if ("caches" in window) for (const name of await caches.keys()) await caches.delete(name);
  } catch (e) { console.error(e); }
  try {
    if (navigator.serviceWorker) for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  } catch (e) { console.error(e); }
  try {
    if (window.indexedDB && indexedDB.databases) for (const db of await indexedDB.databases()) if (db.name) await deleteDatabase(db.name);
  } catch (e) { console.error(e); }
  try {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  } catch (e) { console.error(e); }
  return before;
}

$("confirmBox").onchange = () => { $("clearBtn").disabled = !$("confirmBox").checked; };

$("clearBtn").onclick = async () => {
  $("clearBtn").disabled = true;
  $("clearMsg").textContent = "消しています…";
  const before = await clearAll();
  const after = readEntries();
  let sessionLeft = 0;
  try { sessionLeft = sessionStorage.length; } catch (e) { /* なし */ }
  if (after.entries.length || sessionLeft) {
    $("clearMsg").textContent = "一部の履歴を消せませんでした。ブラウザの設定（サイトのデータの削除）から、このサイトのデータを消してください。";
    $("clearBtn").disabled = !$("confirmBox").checked;
    render();
    return;
  }
  $("resetMain").hidden = true;
  $("doneText").textContent = before
    ? `この端末の履歴（${before}件）を、すべて消しました。次にスタンプラリーを開くと、はじめて開いたときの状態（新しい参加者）から始まります。`
    : "この端末の履歴を確認しました。消す履歴は、ありませんでした。";
  $("doneBlock").hidden = false;
  window.scrollTo(0, 0);
};

render();
$("resetMain").hidden = false;
