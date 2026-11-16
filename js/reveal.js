/*
 * スクロールしたときに、段落や画像が、順番に、ふわっと現れるようにする（トップページ）。
 *
 * ・動かしたい要素に、data-reveal 属性を付けます（<p data-reveal>…</p>、<figure data-reveal>…</figure> など）。
 * ・画面に入ったとき、要素に is-in クラスを付けます。動きそのものは、style.css が決めています。
 * ・同時に画面に入った要素は、上から順に、少しずつ遅らせて現します（変数 --d に、遅らせる秒数を入れる）。
 * ・速いスクロールで、一度も見えずに通りすぎた要素は、動きなしで、すぐに現す状態にします（あとで上に戻ったとき、空白にならないように）。
 * ・JavaScriptが動かないとき、IntersectionObserver がないとき、OSで「視差効果を減らす」を選んでいるときは、何もしません
 *   （html に reveal-on を付けないので、最初から、全部が見える）。
 *
 * このファイルは、ちらつかないよう、<head> で読み込みます（最初の描画の前に、reveal-on が付く）。
 */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("reveal-on");

  function start() {
    var pending = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    var io = new IntersectionObserver(function (entries) {
      var visible = entries
        .filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      visible.forEach(function (entry, i) {
        entry.target.style.setProperty("--d", Math.min(i * 0.14, 0.7).toFixed(2) + "s");
        show(entry.target);
      });
      sweep();
    }, { threshold: 0.15, rootMargin: "0px 0px -48px 0px" });

    function show(el) {
      el.classList.add("is-in");
      io.unobserve(el);
    }
    // 画面より上にある要素（速いスクロールで飛ばされたものや、再読み込みで、途中から表示したときの上の部分）は、すぐに現す。
    // IntersectionObserver は、「見えた／見えなくなった」の切り替わりしか知らせないため、一度も見えずに通りすぎた要素は、ここで拾う
    // （あとで上に戻ったとき、空白にならないように）
    function sweep() {
      pending = pending.filter(function (el) {
        if (el.classList.contains("is-in")) return false;
        if (el.getBoundingClientRect().bottom < 0) { show(el); return false; }
        return true;
      });
      if (!pending.length) window.removeEventListener("scroll", onScroll);
    }
    var queued = false;
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; sweep(); });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    pending.forEach(function (el) { io.observe(el); });
    sweep();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
