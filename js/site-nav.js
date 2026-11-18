/*
 * 共通ヘッダーのメニュー（右上のハンバーガーボタン → サイドメニュー）の開閉。
 * 開く：ボタン　閉じる：×ボタン／メニューの外側（暗い部分）／Escキー／メニュー内のリンクを選んだとき
 * 開いている間は、メニュー以外のページの部分を操作できない状態（inert）にして、フォーカスをメニューの中に閉じ込め、
 * 背景のスクロールを止める。閉じたら、ボタンにフォーカスを戻す。
 *
 * ポップアップ（<dialog>）との関係：
 *  ・ポップアップは、inert にしません（inert にすると、メニューを開いている間に、ポップアップが自動で開いたとき、
 *    ポップアップも、その下のメニューも、操作できなくなり、ページが固まってしまうため）。
 *  ・メニューを開いている間に、ポップアップが開いたら、メニューを自動で閉じます（ポップアップを、すぐに操作できるようにする）。
 *  ・自動で出すポップアップは、メニューが閉じるまで待たせる：window.SiteNav.whenClosed() で、閉じるまで待てます。
 */
(function () {
  var toggle = document.getElementById("menuToggle");
  var menu = document.getElementById("siteMenu");
  var backdrop = document.getElementById("menuBackdrop");
  if (!toggle || !menu || !backdrop) return;
  var closeButton = menu.querySelector(".menu-close");
  var root = document.documentElement;
  var closeWaiters = [];

  function isOpen() { return menu.classList.contains("is-open"); }
  function focusables() {
    return Array.prototype.slice.call(menu.querySelectorAll("a[href], button:not([disabled])"));
  }

  // メニューが開いている間、メニューとその背景（暗い部分）以外のページの部分を、操作できない状態にする
  // （Tabキーでメニューの外に出たり、読み上げソフトが背景を読んだりしないように）。ポップアップ（dialog）は、対象にしない。
  var inerted = [];
  function setBackgroundInert(on) {
    if (on) {
      Array.prototype.forEach.call(document.body.children, function (el) {
        if (el === menu || el === backdrop || /^(SCRIPT|STYLE|LINK|NOSCRIPT|DIALOG)$/.test(el.tagName) || el.hasAttribute("inert")) return;
        el.setAttribute("inert", "");
        inerted.push(el);
      });
    } else {
      inerted.forEach(function (el) { el.removeAttribute("inert"); });
      inerted = [];
    }
  }

  function setOpen(open, restoreFocus) {
    if (open === isOpen()) return;
    menu.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);
    root.classList.toggle("menu-open", open);
    setBackgroundInert(open);
    menu.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    if (open) {
      if (closeButton) closeButton.focus();
    } else {
      if (restoreFocus !== false) toggle.focus();
      var waiters = closeWaiters;
      closeWaiters = [];
      waiters.forEach(function (resolve) { resolve(); });
    }
  }

  // 他のプログラムから使う口：メニューが開いているか／閉じる／閉じるまで待つ（閉じていれば、すぐに終わる）
  window.SiteNav = {
    isOpen: isOpen,
    close: function () { setOpen(false, false); },
    whenClosed: function () {
      return isOpen() ? new Promise(function (resolve) { closeWaiters.push(resolve); }) : Promise.resolve();
    }
  };

  toggle.addEventListener("click", function () { setOpen(!isOpen()); });
  if (closeButton) closeButton.addEventListener("click", function () { setOpen(false); });
  backdrop.addEventListener("click", function () { setOpen(false); });
  // 今開いているページへのリンクなどでは、ページが切り替わらないので、メニューを閉じる
  menu.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("a[href]") : null;
    if (link && link.getAttribute("target") !== "_blank") setOpen(false, false);
  });

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (e.key !== "Tab") return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (items.indexOf(document.activeElement) === -1) { e.preventDefault(); first.focus(); }
  });

  // メニューを開いている間に、ポップアップ（dialog）が開いたら、メニューを閉じて、ポップアップに操作を渡す
  if (typeof MutationObserver === "function") {
    new MutationObserver(function () {
      if (!isOpen()) return;
      var dialog = document.querySelector("dialog[open]");
      if (!dialog) return;
      setOpen(false, false);
      var target = dialog.querySelector("[autofocus]") || dialog;
      if (target.focus) target.focus();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  }

  // 「戻る」で戻ってきたとき（ページの再表示）は、閉じた状態にする
  window.addEventListener("pageshow", function (e) { if (e.persisted) setOpen(false, false); });
})();
