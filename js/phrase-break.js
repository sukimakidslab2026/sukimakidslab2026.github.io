/*
 * 日本語の文章を、文節の区切りでだけ折り返す（「千代／田区」「読み取／る」のような、単語の途中の改行を防ぐ）。
 *
 * なぜ必要か：CSS の word-break:auto-phrase は、Chrome などでしか使えません。iPhone の Safari や Firefox では、
 *   単語の途中でも折り返してしまい、狭い画面（iPhone SE など）で、1文字だけの行（「ル」「る」「す。」）ができます。
 *   そこで、文章の中の、文節の区切りに <wbr>（折り返してよい位置）を入れ、区切りでだけ折り返すようにします（brand.css の [data-pb]）。
 *
 * 区切りの判定：Google の BudouX（Apache-2.0）の、日本語の学習済みモデル（js/vendor/budoux-ja-model.js）を使います。
 *   下の boundaries() は、BudouX の parseBoundaries と同じ計算です（モデルを、そのまま使うため、判定の結果は同じです）。
 *   BudouX: https://github.com/google/budoux  Copyright 2021 Google LLC  Licensed under the Apache License, Version 2.0
 *
 * ・ページを開いたときに、画面の中の日本語の文章に、自動で入れます。あとから、JavaScript が入れた文章にも、自動で入れます（MutationObserver）。
 *   文章を書きかえたときも、何もしなくて大丈夫です（HTML や JavaScript に、区切りを書く必要はありません）。
 * ・太字（<strong>）やリンク（<a>）をまたぐ文章も、1つの文として、区切りを判定します。
 * ・見た目で変わるのは、折り返す位置だけです。文字は、変わりません（<wbr> は、コピーしたときも、読み上げのときも、文字になりません）。
 * ・入れたくない場所は、その要素（または親）に data-nopb を付けます。時刻（<time>）・コード・数字や英語の表示（.num / .en）には、入れません。
 * ・flex / grid の中に、直接ある文字には、入れません（文字が、別々の項目に分かれて、並びが崩れるため）。
 * ・JavaScript が使えないとき・モデルが読み込めないときは、何もしません（これまでどおりの折り返しになります）。
 *
 * window.PhraseBreak.boundaries(文字列)：区切りの位置の一覧 ／ .apply(要素)：その要素の中の文章に、いま入れる ／ .stats：入れた数と、かかった時間（確認用）
 */
(function () {
  "use strict";
  var MODEL = window.BUDOUX_JA_MODEL;
  if (!MODEL || !window.MutationObserver || !window.WeakSet || !document.createTreeWalker || !Array.from || !Element.prototype.closest) return;

  // ---------- 区切りの判定（BudouX と同じ） ----------
  var base = 0;
  Object.keys(MODEL).forEach(function (group) {
    var scores = MODEL[group];
    Object.keys(scores).forEach(function (key) { base += scores[key]; });
  });
  base = -0.5 * base;
  var has = Object.prototype.hasOwnProperty;
  function score(group, key) {
    var scores = MODEL[group];
    return scores && has.call(scores, key) ? scores[key] : 0;
  }
  // BudouX の区切りに、かっこの前後（開きかっこの前・閉じかっこの後）と、全角の空白（　）の後を足す。
  // iPhone の Safari は、word-break:keep-all のとき、「（」の前や、全角の空白の後でも折り返さないため、長い文節が、途中（「）」が行の頭など）で切れてしまう。
  // ただし、足した区切りで、1文字だけの文節（「」の」「）に」などの助詞）ができるときは、足さない（1文字だけの行が、できないように）
  var OPENING = "（「『【〔［｛", CLOSING = "）」』】〕］｝", NO_LINE_START = "、。，．！？）」』】〕］｝・：；";
  function withBrackets(text, cuts) {
    var chars = Array.from(text), n = chars.length, offs = [], at = {}, cand = [], i, o = 0;
    for (i = 0; i < n; i++) { offs.push(o); o += chars[i].length; }
    offs.push(o);
    for (i = 0; i < n; i++) {
      if (i > 0 && OPENING.indexOf(chars[i]) >= 0 && OPENING.indexOf(chars[i - 1]) < 0 && !/\s/.test(chars[i - 1])) cand.push(i);                                  // この文字の前
      if (i < n - 1 && (CLOSING.indexOf(chars[i]) >= 0 || chars[i] === "\u3000") && NO_LINE_START.indexOf(chars[i + 1]) < 0 && !/\s/.test(chars[i + 1])) cand.push(i + 1);   // この文字の後
    }
    if (!cand.length) return cuts;
    for (i = 0; i <= n; i++) at[offs[i]] = i;                      // 位置（UTF-16）→ 何文字目か
    var marks = cuts.map(function (c) { return at[c]; }), k, c, prev, next, j;   // marks：区切りの、文字の番号（昇順）
    for (k = 0; k < cand.length; k++) {
      c = cand[k];
      if (marks.indexOf(c) >= 0) continue;
      prev = 0; next = n;
      for (j = 0; j < marks.length; j++) { if (marks[j] < c) prev = marks[j]; else { next = marks[j]; break; } }
      if (c - prev >= 2 && next - c >= 2) { marks.push(c); marks.sort(function (a, b) { return a - b; }); }
    }
    return marks.map(function (m) { return offs[m]; });
  }

  // 戻り値：区切りの位置（UTF-16 の文字の数え方で、その位置の「前」で折り返してよい）
  function boundaries(text) {
    var chars = Array.from(text), out = [], offset = 0, i, s;
    for (i = 1; i < chars.length; i++) {
      offset += chars[i - 1].length;
      s = base;
      if (i > 2) s += score("UW1", chars[i - 3]) + score("TW1", chars[i - 3] + chars[i - 2] + chars[i - 1]);
      if (i > 1) s += score("UW2", chars[i - 2]) + score("BW1", chars[i - 2] + chars[i - 1]) + score("TW2", chars[i - 2] + chars[i - 1] + chars[i]);
      s += score("UW3", chars[i - 1]) + score("UW4", chars[i]) + score("BW2", chars[i - 1] + chars[i]);
      if (i + 1 < chars.length) s += score("UW5", chars[i + 1]) + score("BW3", chars[i] + chars[i + 1]) + score("TW3", chars[i - 1] + chars[i] + chars[i + 1]);
      if (i + 2 < chars.length) s += score("UW6", chars[i + 2]) + score("TW4", chars[i] + chars[i + 1] + chars[i + 2]);
      if (s > 0) out.push(offset);
    }
    return withBrackets(text, out);
  }

  // ---------- 文章に入れる ----------
  var JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;                      // ひらがな・カタカナ・漢字
  var SKIP = "[data-nopb],script,style,noscript,textarea,select,option,code,pre,time,svg,title,.num,.en";
  var done = new WeakSet();                                                                      // 処理が済んだ文字（自分が入れたものも含む）
  var stats = { runs: 0, breaks: 0, ms: 0 };

  // 要素の表示方法（display）。hidden で隠れているときは、いったん表示して調べる（出てきたときに、flex だったら、並びが崩れるため）
  function displayOf(el) {
    var d = window.getComputedStyle(el).display;
    if (d === "none" && el.hidden) {
      el.hidden = false;
      d = window.getComputedStyle(el).display;
      el.hidden = true;
    }
    return d;
  }
  var NO_DIRECT_TEXT = /flex|grid|contents|none/;   // この表示の要素の直下の文字には、<wbr> を入れない

  // 1つの文（同じ行の流れで、つながっている文字の並び）に、区切りを入れる。nodes：その文を作る文字（DOM の順）
  function breakRun(nodes, block) {
    var text = "", starts = [], i;
    for (i = 0; i < nodes.length; i++) { starts.push(text.length); text += nodes[i].nodeValue; done.add(nodes[i]); }
    if (text.length < 4 || !JAPANESE.test(text)) return;
    block.setAttribute("data-pb", "");                          // brand.css：[data-pb]{word-break:keep-all!important;overflow-wrap:anywhere}（中の太字・リンクにも引き継がれる）。区切りが見つからない固有名詞なども、単語の途中では折り返さない
    var cuts = boundaries(text);
    if (!cuts.length) return;
    stats.runs++;
    stats.breaks += cuts.length;
    var ci = 0;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i], start = starts[i], end = start + node.nodeValue.length, local = [];
      while (ci < cuts.length && cuts[ci] < end) { local.push(cuts[ci] - start); ci++; }
      if (!local.length) continue;
      var parent = node.parentNode, value = node.nodeValue, frag = document.createDocumentFragment(), last = 0, k, piece;
      for (k = 0; k < local.length; k++) {
        if (local[k] > last) { piece = document.createTextNode(value.slice(last, local[k])); done.add(piece); frag.appendChild(piece); }
        frag.appendChild(document.createElement("wbr"));       // local[k] が 0 のとき：この文字（要素のはじめ）の直前
        last = local[k];
      }
      piece = document.createTextNode(value.slice(last)); done.add(piece); frag.appendChild(piece);
      parent.replaceChild(frag, node);
    }
  }

  // 要素 block の中の、日本語の文章に区切りを入れる。太字・リンクなど（display:inline）をまたぐ文字は、1つの文として扱う。
  // inline-block（.ph）・ブロック・flex などの要素は、別の文として、その中を、同じように処理する
  function processBlock(block) {
    if (block.closest(SKIP)) return;
    var run = [];
    function flush() { if (run.length) breakRun(run, block); run = []; }
    function walk(parent, textOk) {
      for (var n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          if (textOk && !done.has(n) && n.nodeValue) run.push(n); else flush();   // 処理が済んだ文字は、文の境目として扱う
          continue;
        }
        if (n.nodeType !== 1) continue;
        if (n.matches(SKIP) || n.nodeName === "BR" || n.nodeName === "WBR") { flush(); continue; }
        if (displayOf(n) === "inline") walk(n, textOk);                           // 同じ文の続き（太字・リンクなど）
        else { flush(); processBlock(n); }                                         // 別の文（中を、別に処理する）
      }
    }
    walk(block, !NO_DIRECT_TEXT.test(displayOf(block)));
    flush();
  }

  function apply(root) {
    if (!root) return;
    var t0 = window.performance && performance.now ? performance.now() : 0;
    if (root.nodeType === 3) {
      if (!done.has(root) && root.parentNode && root.parentNode.nodeType === 1) processBlock(root.parentNode);
    } else if (root.nodeType === 1) {
      if (root.nodeName !== "WBR") processBlock(root);
    }
    if (t0) stats.ms += performance.now() - t0;
  }

  function start() {
    apply(document.body);
    // あとから足された文章（JavaScript が作ったもの・読み込んだ規約の本文など）にも、入れる。自分が入れたもの（done・<wbr>）は、すぐに飛ばす
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        for (var i = 0; i < record.addedNodes.length; i++) apply(record.addedNodes[i]);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.PhraseBreak = { boundaries: boundaries, apply: apply, stats: stats };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
