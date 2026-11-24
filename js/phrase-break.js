/*
 * 日本語の文章を、文節の区切りでだけ折り返す（「千代／田区」「読み取／る」のような、単語の途中の改行を防ぐ）。
 *
 * なぜ必要か：CSS の word-break:auto-phrase は、Chrome などでしか使えません。iPhone の Safari や Firefox では、
 *   単語の途中でも折り返してしまい、狭い画面（iPhone SE など）で、1文字だけの行（「ル」「る」「す。」）ができます。
 *   そこで、文章の中の、文節の区切りに <wbr>（折り返してよい位置）を入れ、区切りでだけ折り返すようにします（brand.css の [data-pb]）。
 *
 * 区切りの決め方（2段階）：
 *   1. Google の BudouX（Apache-2.0）の日本語のモデル（js/vendor/budoux-ja-model.js）で、文節の区切りの候補を出す。
 *      下の budouxCuts() は、BudouX の parseBoundaries と同じ計算です。
 *      BudouX: https://github.com/google/budoux  Copyright 2021 Google LLC  Licensed under the Apache License, Version 2.0
 *   2. 候補のうち、ブラウザの単語分割（Intl.Segmenter）で、単語の途中になるもの（「喫｜煙」「笑｜顔」）を除く。
 *      さらに、助詞・語尾（「たち」「ながら」「ました」など）が行の頭に取り残される区切り・開きかっこの直後・1文字だけの文節ができる区切りも除く。
 *      そのうえで、開きかっこの前・閉じかっこの後（と、全角の空白の後）に、折り返してよい位置を足す。
 *   Intl.Segmenter がないブラウザでは、何もしません（これまでどおりの折り返しになります）。
 *
 * ・ページを開いたときに、画面の中の日本語の文章に、自動で入れます。あとから、JavaScript が入れた文章にも、自動で入れます（MutationObserver）。
 *   文章を書きかえたときも、何もしなくて大丈夫です（HTML や JavaScript に、区切りを書く必要はありません）。
 * ・太字（<strong>）やリンク（<a>）をまたぐ文章も、1つの文として、区切りを判定します。
 *   太字・マーカー（<span class="mk">）の、いちばん最初の位置には、折り返し位置を入れません（外の、直前に入れる）。
 *   マーカーの背景だけが、行末に残るのを防ぐためです。
 * ・見た目で変わるのは、折り返す位置だけです。文字は、変わりません（<wbr> は、コピーしたときも、読み上げのときも、文字になりません）。
 * ・入れたくない場所は、その要素（または親）に data-nopb を付けます。時刻（<time>）・コード・数字や英語の表示（.num / .en）には、入れません。
 * ・flex / grid の中に、直接ある文字には、入れません（文字が、別々の項目に分かれて、並びが崩れるため）。
 * ・「折り返さない」要素（white-space:nowrap）には、入れません（Chrome は、nowrap の中でも、<wbr> で折り返してしまい、ゲージの「3個で景品」が2行になるため）。
 * ・JavaScript が使えないとき・モデルが読み込めないときも、何もしません。
 * ・確かめるとき：ページのURLの最後に ?pb=0（すでに ? があるときは &pb=0）を付けると、この仕組みを使わずに表示します（折り返しの見た目を、比べられます）。
 *
 * window.PhraseBreak.boundaries(文字列)：区切りの位置の一覧 ／ .apply(要素)：その要素の中の文章に、いま入れる ／ .stats：入れた数と、かかった時間（確認用）
 */
(function () {
  "use strict";
  var MODEL = window.BUDOUX_JA_MODEL;
  if (!MODEL || !window.MutationObserver || !window.WeakSet || !document.createTreeWalker || !Array.from || !Element.prototype.closest) return;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return;
  if (/[?&]pb=0(&|$)/.test(window.location.search)) return;                  // ?pb=0：この仕組みを使わない（見た目を、比べるため）
  var segmenter;
  try { segmenter = new Intl.Segmenter("ja", { granularity: "word" }); } catch (e) { return; }

  // ---------- 区切りの候補（BudouX と同じ計算） ----------
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
  // 戻り値：区切りの位置（UTF-16 の文字の数え方で、その位置の「前」で折り返してよい）
  function budouxCuts(text) {
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
    return out;
  }

  // ---------- 区切りを整える ----------
  var HIRAGANA = /^[ぁ-ゖゝゞー]+$/;                    // ひらがなだけ
  var STARTS_WORD = /^[一-龥々〆㐀-䶵ァ-ヺ]/;              // 漢字・カタカナで始まる
  var OPENING = "（「『【〔［｛", CLOSING = "）」』】〕］｝", PUNCT = "、。，．！？…・：；", IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
  var SMALL_KANA = "ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々";   // 行の頭に来てはいけない文字（小さい仮名・長音）
  var NO_LINE_START = PUNCT + CLOSING + SMALL_KANA;
  var PARTICLES = "はがをにでともへやのかねよわな";            // 1文字の助詞。この直後は、文節の始まりとして、区切ってよい
  var MAX_PHRASE = 14;                                      // 1つの文節が、これより長いとき（狭い画面で、行より長くなって、緊急の折り返しで、かっこや句読点が行頭に来ることがある）は、単語の境目で区切る
  var PREFIXES = "ごお御";                                  // 「ご参加」「お絵描き」の、「ご」「お」は、次の語と、一緒にする

  // 候補のうち、単語の途中のもの・助詞や語尾が取り残されるもの・開きかっこの直後・1文字だけの文節ができるものを除く
  function refine(text, cuts, segs) {
    var at = {}, k;
    for (k = 0; k < segs.length; k++) at[segs[k].index] = k;
    var kept = [], c, i, cur, prev, next, prevChar;
    for (i = 0; i < cuts.length; i++) {
      c = cuts[i];
      if (!has.call(at, c)) continue;                                        // 単語の途中（「喫｜煙」）は、区切らない
      k = at[c]; cur = segs[k].segment; prev = k > 0 ? segs[k - 1].segment : ""; next = k + 1 < segs.length ? segs[k + 1].segment : "";
      prevChar = text.charAt(c - 1);
      if (OPENING.indexOf(prevChar) >= 0) continue;                          // 開きかっこの直後は、区切らない
      if (NO_LINE_START.indexOf(text.charAt(c)) >= 0) continue;              // 句読点・閉じかっこ・小さい仮名の前は、区切らない（行頭に来てしまう）
      if (HIRAGANA.test(cur) && PUNCT.indexOf(prevChar) < 0) {               // ひらがなだけの語：助詞・語尾（「たち」「ながら」「ました」）は、前の語に付ける
        var prefix = cur.length === 1 && PREFIXES.indexOf(cur) >= 0 && STARTS_WORD.test(next);   // 「ご｜参加」：次の語と一緒にするので、ここは区切ってよい
        var afterParticle = prev.length === 1 && PARTICLES.indexOf(prev) >= 0 && cur.length >= 2;   // 「中に｜ありながら」：助詞の直後の、2文字以上の語は、区切ってよい
        if (cur.length <= 3 && !prefix && !afterParticle) continue;
      }
      kept.push(c);
    }
    return kept;
  }

  // 区切りの仕上げ：
  //   1. 開きかっこの前・閉じかっこの後（と、全角の空白の後）を足す。iPhone の Safari は、word-break:keep-all のとき、
  //      「（」の前や、全角の空白の後でも折り返さないため、長い文節が、途中で切れてしまう。
  //   2. 長すぎる文節（MAX_PHRASE 文字より長い）は、単語の境目で、区切る（行より長いと、ブラウザが、緊急で、どこでも折り返すため）。
  //   3. 1文字だけの文節（句読点・かっこだけのものは除く）は、次の文節と一緒にする（最後なら、前と一緒にする）。
  //   4. 最後の文節が、3文字以下で、文末（「です。」）かひらがなだけのときは、前の文節と一緒にする（短い最後の行が、できにくいように）。
  //   5. 開きかっこの前で、直前の語が2文字以下（「暗渠」＋「（あんきょ）」の、読み仮名・注釈）のときは、離さない。
  // 足す区切りは、1文字だけの文節（「」の」「）に」などの助詞）ができるとき・行頭に置けない文字の前・開きかっこの直後には、足さない。
  function finish(text, cuts, segs) {
    var chars = Array.from(text), n = chars.length, offs = [], at = {}, cand = [], i, o = 0;
    for (i = 0; i < n; i++) { offs.push(o); o += chars[i].length; }
    offs.push(o);
    for (i = 0; i <= n; i++) at[offs[i]] = i;                                // 位置（UTF-16）→ 何文字目か
    var marks = cuts.map(function (c) { return at[c]; }).filter(function (m) { return m !== undefined; });   // 区切りの、文字の番号（昇順）
    var addable = function (c) { return c > 0 && c < n && NO_LINE_START.indexOf(chars[c]) < 0 && OPENING.indexOf(chars[c - 1]) < 0 && !/\s/.test(chars[c]) && !/\s/.test(chars[c - 1]); };
    var neighbors = function (c) {
      var prev = 0, next = n, j;
      for (j = 0; j < marks.length; j++) { if (marks[j] < c) prev = marks[j]; else { next = marks[j]; break; } }
      return [prev, next];
    };
    var insert = function (c) { marks.push(c); marks.sort(function (a, b) { return a - b; }); };
    // 1. かっこ・全角の空白
    for (i = 0; i < n; i++) {
      if (i > 0 && OPENING.indexOf(chars[i]) >= 0 && OPENING.indexOf(chars[i - 1]) < 0) cand.push(i);                                       // この文字の前
      if (i < n - 1 && (CLOSING.indexOf(chars[i]) >= 0 || chars[i] === IDEOGRAPHIC_SPACE)) cand.push(i + 1);                              // この文字の後
    }
    var k, c, nb;
    for (k = 0; k < cand.length; k++) {
      c = cand[k];
      if (marks.indexOf(c) >= 0 || !addable(c)) continue;
      nb = neighbors(c);
      // 開きかっこの前で、直前の語が2文字以下（「暗渠（あんきょ）」の、読み仮名・注釈）のときは、離さない
      if (c - nb[0] >= (OPENING.indexOf(chars[c]) >= 0 ? 3 : 2) && nb[1] - c >= 2) insert(c);
    }
    // 2. 長すぎる文節：単語の境目のうち、中央にいちばん近いものを足す（足せるものがなくなるまで）
    var icu = [];
    segs.forEach(function (s) { if (has.call(at, s.index)) icu.push(at[s.index]); });
    var stuck = {}, guard = 0, best, start, end, mid, j, longest;
    while (guard++ < 200) {
      longest = null;
      for (j = 0; j <= marks.length; j++) {
        start = j === 0 ? 0 : marks[j - 1]; end = j < marks.length ? marks[j] : n;
        if (end - start > MAX_PHRASE && !stuck[start] && (!longest || end - start > longest[1] - longest[0])) longest = [start, end];
      }
      if (!longest) break;
      mid = (longest[0] + longest[1]) / 2; best = -1;
      for (j = 0; j < icu.length; j++) {
        c = icu[j];
        if (c - longest[0] >= 2 && longest[1] - c >= 2 && addable(c) && (best < 0 || Math.abs(c - mid) < Math.abs(best - mid))) best = c;
      }
      if (best < 0) stuck[longest[0]] = true; else insert(best);
    }
    // 5. 開きかっこの前で、直前の語が2文字以下
    for (j = marks.length - 1; j >= 0; j--) {
      if (OPENING.indexOf(chars[marks[j]]) >= 0 && marks[j] - (j > 0 ? marks[j - 1] : 0) <= 2 && j > 0) marks.splice(j, 1);
    }
    // 3. 1文字だけの文節
    var changed = true, b, len, ch;
    guard = 0;
    while (changed && guard++ < 1000) {
      changed = false;
      for (j = 0; j <= marks.length; j++) {
        b = j === 0 ? 0 : marks[j - 1]; len = (j < marks.length ? marks[j] : n) - b; ch = chars[b];
        if (len === 1 && PUNCT.indexOf(ch) < 0 && OPENING.indexOf(ch) < 0 && CLOSING.indexOf(ch) < 0 && !/\s/.test(ch)) {
          marks.splice(j < marks.length ? j : j - 1, 1); changed = true; break;
        }
      }
    }
    // 4. 最後の文節が、3文字以下で、文末（。！？）か、ひらがなだけ（「です。」「ます」）のとき
    if (marks.length && n - marks[marks.length - 1] <= 3) {
      var tail = chars.slice(marks[marks.length - 1]).join(""), before = marks.length > 1 ? marks[marks.length - 2] : 0;
      if ((/[。！？]$/.test(tail) || HIRAGANA.test(tail)) && n - before <= MAX_PHRASE) marks.pop();
    }
    return marks.map(function (m) { return offs[m]; });
  }

  function boundaries(text) {
    var segs = Array.from(segmenter.segment(text));
    return finish(text, refine(text, budouxCuts(text), segs), segs);
  }

  // ---------- 文章に入れる ----------
  var JAPANESE = /[ぁ-ヿ㐀-䶵一-龥ｦ-ﾟ]/;                      // ひらがな・カタカナ・漢字
  var SKIP = "[data-nopb],script,style,noscript,textarea,select,option,code,pre,time,svg,title,.num,.en";
  var done = new WeakSet();                                                                      // 処理が済んだ文字（自分が入れたものも含む）
  var stats = { runs: 0, breaks: 0, ms: 0 };

  // 要素の表示方法（display）と、「折り返さない」指定（white-space:nowrap など）。hidden で隠れているときは、いったん表示して調べる（出てきたときに、flex だったら、並びが崩れるため）
  // 「折り返さない」要素には、入れない：Chrome は、white-space:nowrap の中でも、<wbr> で折り返してしまうため（ゲージの「3個で景品」が2行になる）
  function styleOf(el) {
    var cs = window.getComputedStyle(el), d = cs.display, ws = cs.whiteSpace, tw = cs.textWrapMode;
    if (d === "none" && el.hidden) {
      el.hidden = false;
      cs = window.getComputedStyle(el); d = cs.display; ws = cs.whiteSpace; tw = cs.textWrapMode;
      el.hidden = true;
    }
    return { display: d, noWrap: /^(nowrap|pre)$/.test(ws) || tw === "nowrap" };
  }
  var NO_DIRECT_TEXT = /flex|grid|contents|none/;   // この表示の要素の直下の文字には、<wbr> を入れない

  // 文字 node の「前」に入れる <wbr> の置き場所。node が、太字・マーカーなどの、いちばん最初の文字なら、その要素の「外」（直前）にする
  // （要素の中の、先頭に入れると、折り返したとき、マーカーの背景だけが、前の行の終わりに、断片として残るため）
  function anchorFor(node, block) {
    var el = node;
    while (!el.previousSibling && el.parentNode && el.parentNode !== block && el.parentNode.nodeType === 1) el = el.parentNode;
    return el;
  }

  // 1つの文（同じ行の流れで、つながっている文字の並び）に、区切りを入れる。nodes：その文を作る文字（DOM の順）
  function breakRun(nodes, block) {
    var text = "", starts = [], i;
    for (i = 0; i < nodes.length; i++) { starts.push(text.length); text += nodes[i].nodeValue; done.add(nodes[i]); }
    if (text.length < 4 || !JAPANESE.test(text)) return;
    block.setAttribute("data-pb", "");                          // brand.css：[data-pb]{word-break:keep-all!important;…}（中の太字・リンクにも引き継がれる）。区切りが見つからない固有名詞なども、単語の途中では折り返さない
    var cuts = boundaries(text);
    if (!cuts.length) return;
    stats.runs++;
    stats.breaks += cuts.length;
    var ci = 0;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i], start = starts[i], end = start + node.nodeValue.length, local = [];
      while (ci < cuts.length && cuts[ci] < end) { local.push(cuts[ci] - start); ci++; }
      if (!local.length) continue;
      if (local[0] === 0) {                                      // この文字の、いちばん最初：要素の外（直前）に入れる
        var anchor = anchorFor(node, block);
        anchor.parentNode.insertBefore(document.createElement("wbr"), anchor);
        local.shift();
      }
      if (!local.length) continue;
      var parent = node.parentNode, value = node.nodeValue, frag = document.createDocumentFragment(), last = 0, k, piece;
      for (k = 0; k < local.length; k++) {
        piece = document.createTextNode(value.slice(last, local[k])); done.add(piece); frag.appendChild(piece);
        frag.appendChild(document.createElement("wbr"));
        last = local[k];
      }
      piece = document.createTextNode(value.slice(last)); done.add(piece); frag.appendChild(piece);
      parent.replaceChild(frag, node);
    }
  }

  // 要素 block の中の、日本語の文章に区切りを入れる。太字・リンクなど（display:inline）をまたぐ文字は、1つの文として扱う。
  // inline-block（.ph）・ブロック・flex などの要素は、別の文として、その中を、同じように処理する
  function processBlock(block, style) {
    if (block.closest(SKIP)) return;
    var st = style || styleOf(block);
    if (st.noWrap) return;                                                        // 「折り返さない」要素は、何もしない
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
        var ns = styleOf(n);
        if (ns.noWrap) { flush(); continue; }                                      // 「折り返さない」要素は、境目として、飛ばす
        if (ns.display === "inline") walk(n, textOk);                             // 同じ文の続き（太字・リンクなど）
        else { flush(); processBlock(n, ns); }                                     // 別の文（中を、別に処理する）
      }
    }
    walk(block, !NO_DIRECT_TEXT.test(st.display));
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

  window.PhraseBreak = { boundaries: boundaries, budouxCuts: budouxCuts, apply: apply, stats: stats };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
