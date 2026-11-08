/*
 * 魚のスタンプ（図鑑）と、魚が増えていく川の、共通の部品（スタンプラリー画面・管理画面で使う）。
 *
 * ・魚の名前・画像の名前と大きさ：js/fish-data.js（scripts/make_fish_assets.py が自動で作る）
 * ・魚が増えていく順番：サーバー（管理画面の「スタンプ設定」で変える）。参加者の画面は、開くたびに読み込む。
 * ・下の RALLY_FISH_DEFAULT_ORDER は、サーバーから読み込めないとき（通信できない・初めて開いたときなど）に使う順番です。
 *   sql/schema.sql の rally_default_fish_order() と同じにしてください（scripts/check_site.py が確認します）。
 */
window.RALLY_FISH_DEFAULT_ORDER = ["namazu", "koi", "medaka", "funa", "dojo", "haze"];

window.RallyFish = (function () {
  var FISH = window.RALLY_FISH || {};
  var SCENE = window.RALLY_FISH_SCENE || { file: "scene.webp", width: 1500, height: 629 };
  var BASE = window.RALLY_FISH_BASE || "../assets/fish/";
  var KEYS = Object.keys(FISH);

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; });
  }
  function url(file) { return BASE + file; }
  function has(key) { return Object.prototype.hasOwnProperty.call(FISH, key); }

  // 魚の種類をちょうど1回ずつ並べた配列だけを、順番として受け付ける（それ以外は null）
  function normalizeOrder(value) {
    if (!Array.isArray(value) || value.length !== KEYS.length) return null;
    var seen = {};
    for (var i = 0; i < value.length; i++) {
      var k = value[i];
      if (typeof k !== "string" || !has(k) || seen[k]) return null;
      seen[k] = true;
    }
    return value.slice();
  }
  function defaultOrder() { return normalizeOrder(window.RALLY_FISH_DEFAULT_ORDER) || KEYS.slice(); }

  // 川の背景の画像
  function sceneHtml() {
    return '<img class="river-bg" src="' + esc(url(SCENE.file)) + '" width="' + SCENE.width + '" height="' + SCENE.height + '" alt="" draggable="false">';
  }
  // 魚1種類ぶんの重ね画像（背景と同じ大きさ）。魚が現れるアニメーションの中心は、その魚がいる位置
  function layerHtml(key, isNew) {
    var f = FISH[key];
    if (!f) return "";
    return '<img data-key="' + esc(key) + '"' + (isNew ? ' class="is-new"' : "") + ' src="' + esc(url(f.layer)) + '" width="' + SCENE.width + '" height="' + SCENE.height +
      '" alt="" draggable="false" style="transform-origin:' + (f.cx * 100).toFixed(1) + "% " + (f.cy * 100).toFixed(1) + '%">';
  }
  // 川の絵（背景＋ 順番どおりに、先頭から count 種類の魚）。管理画面のプレビューなど、動かさない場面で使う
  function riverInnerHtml(order, count) {
    var n = Math.max(0, Math.min(count, order.length));
    return sceneHtml() + '<div class="river-fish">' + order.slice(0, n).map(function (k) { return layerHtml(k, false); }).join("") + "</div>";
  }

  // 画像を先に読み込んでおく（魚が現れる瞬間に、画像が遅れて出ないように）。timeoutMs を過ぎたら、待たずに先へ進む
  function loadImage(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = img.onerror = function () { resolve(img); };
      img.src = url(file);
    });
  }
  function preload(keys, timeoutMs) {
    var files = [];
    (keys || []).forEach(function (k) { if (has(k)) files.push(FISH[k].stamp, FISH[k].layer); });
    if (!files.length) return Promise.resolve();
    var limit = new Promise(function (resolve) { setTimeout(resolve, timeoutMs || 2000); });
    return Promise.race([Promise.all(files.map(loadImage)), limit]);
  }

  return { keys: KEYS, fish: FISH, scene: SCENE, url: url, has: has, esc: esc, normalizeOrder: normalizeOrder, defaultOrder: defaultOrder,
    sceneHtml: sceneHtml, layerHtml: layerHtml, riverInnerHtml: riverInnerHtml, preload: preload };
})();
