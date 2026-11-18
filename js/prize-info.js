/*
 * 「？ 景品について」のポップアップ（スタンプラリー画面・アンケート画面で共通）。
 *
 * ・ページに、<button type="button" class="prize-open" data-prize-open>…</button> を置くと、押したときに、このポップアップが開きます。
 * ・ポップアップは、最初に押されたときに作ります（画像も、そのときに読み込みます）。
 * ・見た目は、prize.css。画像は、assets/prize/（scripts/make_fish_assets.py が、prize-images/ の元の画像から作ります）。
 * ・ポップアップが開く前に、ハンバーガーのメニューが開いていたら、メニューを閉じます（js/site-nav.js）。
 */
(function () {
  // ▼▼ 景品の内容（ここを書きかえると、スタンプラリー画面・アンケート画面の、両方のポップアップが、いっしょに変わります） ▼▼
  var PRIZE = {
    name: "オリジナルマステ",
    required: 3,                          // 景品をゲットできる条件（スタンプの個数）。rally/app.js の PRIZE_REQUIRED と同じ数にします
    limit: "先着100名",                   // 数の限り（ポップアップに、目立つ形で出ます）
    perPerson: "おひとり様 一つ限り"
  };
  // 画像（assets/prize/ の中）。width・height は、画像の大きさと同じ値にします（scripts/check_site.py が確認します）
  var IMAGES = {
    flow: { file: "flow.webp", width: 689, height: 137, alt: "子どもたちが描いたお魚の長い紙が、マスキングテープになる流れの図" },
    tape: { file: "tape.webp", width: 880, height: 701, alt: "お魚の絵がデザインされたマスキングテープの写真（イメージ）" }
  };
  // ▲▲ 景品の内容（ここまで） ▲▲

  var script = document.currentScript;
  var base = (function () {
    try { return new URL("../assets/prize/", script.src).href; } catch (e) { return "../assets/prize/"; }
  })();
  var dialog = null;
  var opener = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; });
  }
  function image(key) {
    var i = IMAGES[key];
    return '<img src="' + esc(base + i.file) + '" width="' + i.width + '" height="' + i.height + '" alt="' + esc(i.alt) + '" loading="lazy" decoding="async" draggable="false">';
  }

  function build() {
    var el = document.createElement("dialog");
    el.id = "prizeDialog";
    el.className = "prize-dialog";
    el.setAttribute("aria-labelledby", "prizeTitle");
    el.innerHTML =
      '<div class="prize-card" tabindex="-1" autofocus>' +
        '<div class="prize-head">' +
          '<div><p class="prize-kicker en">PRESENT</p><h2 id="prizeTitle" class="prize-title">景品について</h2></div>' +
          '<button type="button" class="prize-x" data-prize-close aria-label="閉じる"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
        '</div>' +
        '<div class="prize-body" tabindex="0" role="region" aria-labelledby="prizeTitle">' +
          '<figure class="prize-flow">' + image("flow") +
            '<figcaption><span class="ph">イベント当日に描かれたお魚が</span><span class="ph">マスキングテープとなって</span><span class="ph">プレゼントされます！</span></figcaption>' +
          '</figure>' +
          '<h3 class="prize-lead">' + esc(PRIZE.name) + 'をゲット！</h3>' +
          '<p class="prize-text">スタンプを<strong>' + PRIZE.required + '個</strong>集めて、アンケートから申し込むと、<strong>' + esc(PRIZE.name) + '</strong>（マスキングテープ）をゲットできます。</p>' +
          '<figure class="prize-photo">' + image("tape") + '</figure>' +
          '<div class="prize-limit" role="note">' +
            '<p class="prize-limit-title">数に限りがあります</p>' +
            '<ul class="prize-chips" role="list"><li>' + esc(PRIZE.limit) + '</li><li>' + esc(PRIZE.perPerson) + '</li></ul>' +
            '<p class="prize-limit-note">なくなってしまう前に、お早めにお申し込みください。</p>' +
          '</div>' +
          '<h3 class="prize-lead">お申し込みの方法</h3>' +
          '<ol class="prize-steps" role="list">' +
            '<li><strong>スタンプを' + PRIZE.required + '個集める</strong><span>掲示板のQRコードを読み取ります。</span></li>' +
            '<li><strong>アンケートに答える</strong><span>スタンプラリー画面の「アンケートに回答する」から開きます。</span></li>' +
            '<li><strong>「景品を希望する」にチェックする</strong><span>発送先（お名前・ご住所・電話番号・メールアドレス）を入力して、送信します。</span></li>' +
          '</ol>' +
        '</div>' +
        '<div class="prize-foot"><button type="button" class="prize-ok" data-prize-close>とじる</button></div>' +
      '</div>';
    el.addEventListener("click", function (e) {
      if (e.target === el || (e.target.closest && e.target.closest("[data-prize-close]"))) close();   // 外（暗い部分）・×・とじる
    });
    el.addEventListener("close", function () {
      document.documentElement.classList.remove("prize-open");
      if (opener && opener.focus) opener.focus();
      opener = null;
    });
    document.body.appendChild(el);
    return el;
  }

  function open(from) {
    if (!dialog) dialog = build();
    if (dialog.open) return;
    if (window.SiteNav && window.SiteNav.isOpen()) window.SiteNav.close();   // メニューが開いたままだと、ポップアップを操作できなくなるため
    opener = from || document.activeElement;
    dialog.querySelector(".prize-body").scrollTop = 0;
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    document.documentElement.classList.add("prize-open");
  }
  function close() {
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
  }

  // 画像（合わせて 30KB ほど）を、ページを読み込んだあと、手が空いたときに、先に読み込んでおく（ポップアップを開いたとき、すぐに表示されるように）
  function prefetch() {
    Object.keys(IMAGES).forEach(function (key) { var img = new Image(); img.src = base + IMAGES[key].file; });
  }
  window.addEventListener("load", function () {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(prefetch, { timeout: 4000 });
    else setTimeout(prefetch, 1500);
  });

  document.addEventListener("click", function (e) {
    var button = e.target.closest ? e.target.closest("[data-prize-open]") : null;
    if (!button) return;
    e.preventDefault();
    open(button);
  });

  // 他のプログラムから使う口：開く・閉じる・ポップアップの要素（まだ作られていなければ null。開いているかの確認に使う）
  window.PrizeInfo = { open: open, close: close, info: PRIZE, element: function () { return dialog; } };
})();
