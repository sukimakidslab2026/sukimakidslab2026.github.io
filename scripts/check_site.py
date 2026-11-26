#!/usr/bin/env python3
"""
サイト全体の整合性を検査する（公開前のチェック用）。

  python3 scripts/check_site.py

検査する内容：
  1. HTMLの構造（閉じ忘れ、同じIDの重複）
  2. JavaScript が参照するIDが、そのページのHTMLにあるか
  3. HTMLが読み込むファイル（CSS・JS・リンク先）が実際に存在するか
  4. CSSで使っている変数（var(--…)）が、どこかで定義されているか
  5. 色：ブランドカラー（と、その淡い色）以外の色が使われていないか
  6. フォント：フォントファイルがリポジトリに入っていないか、フォント指定が brand.css に集約されているか
  7. hidden属性が、他のCSSに負けないようになっているか
  8. ファイルの版（?v=…）が最新か（scripts/stamp_assets.py --check）
  9. JavaScript の文法、秘密鍵が含まれていないこと、js/config.js が変更されていないこと
 10. 共通ヘッダー（ロゴ・メニュー）が、すべての公開ページで同じ内容か
 11. 景品をゲットできる条件（スタンプの個数）が、JavaScript・SQL・HTMLで同じか
 12. 掲示板のQRコードの文字列（合言葉）が、公開されるファイルに含まれていないか
 13. 旧仕様（6か所の名前付きスタンプ）の記述が残っていないか
 14. 魚の図鑑：画像・名前・順番が、JavaScript・SQL・画像の変換スクリプトで一致しているか
 15. 元の画像のフォルダ（fish-stamp-images など）が、GitHubに送られないようになっているか
 16. 参加者のスタンプのリセット：SQLの関数・権限と、参加者の画面・管理画面の呼び出しが、そろっているか
 17. スタンプラリー画面のバナー（中央）・獲得の演出（後光）・ルール説明のポップアップ（「次回からは表示しない」の保存）が、そろっているか
 18. トップページ（「すきまキッズラボとは？」）：紹介文・画像・スクロールで順番に現れる動き（js/reveal.js）が、そろっているか。
     公開ページの画像の width / height が、実際の画像の大きさと同じか
 19. アンケート・プライバシー規約・フッター：規約の項の番号と版が正しいか（【要確認】が残っていると注意として表示）、
     景品を希望するときに、規約への同意にチェックを入れるまで「送信する」を押せないか、フッターが小文字か
 20. メールアドレス：アンケートの入力欄・JavaScript・SQL（列・検査・関数の引数と権限）・管理画面の表とCSVが、そろっているか
 21. 管理画面の一括操作：参加者・アンケートのチェックボックス、一括の除外・リセット、アンケートの削除が、SQL（関数・管理者のみ・権限）と、画面で、そろっているか
 22. この端末の履歴の完全リセット（reset/）：サイトが端末に保存している履歴の名前が、すべて載っているか、消す処理・別のタブの開き直し・管理画面のリンクが、そろっているか
 23. 管理画面の「完全リセット」（参加者の端末のサイトの履歴も消す）と、アンケートを削除したあとの答え直し：SQL（列・関数・権限）・スタンプラリー画面・アンケート画面・管理画面が、そろっているか
 24. 「？ 景品について」のポップアップ（js/prize-info.js・prize.css・assets/prize/）：スタンプラリー画面・アンケート画面のボタンと、中身（画像の大きさ・スタンプの個数。先着・おひとり様一つ限りの説明は入れない）が、そろっているか
 25. コンプリート（お魚が全部そろった）ときの、川の左上のバナー・日時・完成画像の保存：画面と、保存する画像で、位置・大きさが同じか
 26. ハンバーガーのメニューとポップアップの関係（メニューを開いたまま、ポップアップが開いても、操作できなくならないか）
 27. 個人情報（発送先）を、スプレッドシートに同期しない：SQL・Apps Script・READMEに、個人情報を同期する仕組みが、残っていないか
 28. 文言の統一：「お魚」の表記・「景品をゲットできる」・川のタイトル・ルール説明の仮の注記の削除
 29. 公開の設定（管理画面）：掲示板の地図を出すか（初期は非公開）・Googleマイマップのリンク・開催開始日・「開催中！」の表示が、SQL（列・関数・権限・URLの形）・
     スタンプラリー画面（地図は最初は隠す・公開のときだけ表示・開催開始日はバナーの下）・管理画面（入力・保存）で、そろっているか。
     マイマップのURLの形（正規表現）が、SQL・参加者の画面・管理画面で、同じか
 30. 日本語の折り返しは、ブラウザの標準に任せる：文節の区切りを文章に入れる仕組み（phrase-break・BudouX・<wbr>）が、残っていないか。
     text-wrap（pretty・balance）・word-break:keep-all を、使っていないか
 31. トップページ（「すきまキッズラボとは？」）とアンケートの、バナー・見出し・見出しの下の線が、左右の中央にそろっているか
問題があると、× を表示して、終了コード1で終わります（注意は、終了コードに影響しません）。
"""
import html.parser
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "scripts"}
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "area", "base", "col", "embed", "param", "track", "wbr", "path", "circle", "use", "rect", "stop"}

INSTAGRAM_URL = "https://www.instagram.com/sukima.kids.lab/"
PUBLIC_PAGES = ["index.html", "rally/index.html", "survey/index.html", "survey/privacy.html", "reset/index.html"]   # 共通ヘッダーを入れるページ（管理画面は除く）
BRAND_COLORS = {"#30557e", "#4d89b7", "#62adca", "#dec632", "#ffffff", "#fff"}      # 主色・サブ・アクセント・差し色（マスタード）・白
TINTS = {"#ecf5f9", "#dcedf3", "#c8e2ec", "#d2e2ed", "#eef1f5", "#4f6e91", "#f8f4d6"}   # 上の色を白に重ねた色／補助の文字色（brand.css で定義）
ADMIN_ERROR = {"#b42318", "#fdecea", "#f3b8b2"}                                     # 管理画面のエラー表示だけの例外
RGB_OK = {(255, 255, 255), (48, 85, 126), (98, 173, 202), (222, 198, 50)}

failures, warnings = [], []


def ok(msg):
    print(f"  ✓ {msg}")


def bad(msg):
    failures.append(msg)
    print(f"  × {msg}")


def warn(msg):
    warnings.append(msg)
    print(f"  △ {msg}")


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def files(ext):
    out = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        out += [os.path.relpath(os.path.join(base, n), ROOT) for n in names if n.endswith(ext)]
    return sorted(out)


class Page(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.dups, self.stack, self.errors = set(), [], [], []
        self.assets, self.links, self.in_comment = [], [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            if a["id"] in self.ids:
                self.dups.append(a["id"])
            self.ids.add(a["id"])
        if tag == "link" and a.get("href"):
            self.assets.append(a["href"])
        if tag == "script" and a.get("src"):
            self.assets.append(a["src"])
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass  # <path/> などの自己閉じ

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.errors.append(f"<{self.stack.pop()}> が閉じられていません")
            self.stack.pop()
        else:
            self.errors.append(f"</{tag}> に対応する開始タグがありません")


def parse(rel):
    p = Page()
    p.feed(read(rel))
    p.errors += [f"<{t}> が閉じられていません" for t in p.stack if t not in {"html", "body", "head"}]
    return p


def header_block(src):
    """共通ヘッダーの部分（<header class="site-header"> から </nav> まで）を取り出す。"""
    m = re.search(r'<header class="site-header">.*?</nav>', src, flags=re.S)
    return m.group(0) if m else None


def check_header():
    blocks = {}
    for rel in PUBLIC_PAGES:
        src = read(rel)
        block = header_block(src)
        if block is None:
            bad(f"{rel}: 共通ヘッダー（<header class=\"site-header\">…</nav>）がありません")
            continue
        depth = rel.count("/")
        prefix = "../" * depth if depth else "./"
        # ページごとに違うのは、ファイルの場所に合わせた相対パスの先頭と、「今開いているページ」の印だけ
        norm = block.replace(prefix, "{P}").replace(' aria-current="page"', "")
        blocks[rel] = (norm, block, prefix)
        if prefix + "assets/logo.webp" not in block:
            bad(f"{rel}: ロゴ画像のパスが正しくありません")
        # ロゴのリンク先は、スタンプラリー（rally/index.html）。「すきまキッズラボとは？」（トップページ）ではない
        m = re.search(r'<a class="site-logo" href="([^"]+)"', block)
        target = os.path.normpath(os.path.join(ROOT, os.path.dirname(rel), m.group(1), "index.html")) if m else None
        if not target or target != os.path.join(ROOT, "rally", "index.html"):
            bad(f"{rel}: ロゴのリンク先が、スタンプラリー（rally/index.html）になっていません")
        if 'aria-label="すきまキッズラボ スタンプラリーへ"' not in block:
            bad(f"{rel}: ロゴのリンクの aria-label が「すきまキッズラボ スタンプラリーへ」になっていません")
        if INSTAGRAM_URL not in block or 'rel="noopener noreferrer"' not in block:
            bad(f"{rel}: Instagramのリンク（{INSTAGRAM_URL}）が、安全な指定（noopener noreferrer）付きで入っていません")
        if "js/site-nav.js" not in src:
            bad(f"{rel}: メニューの開閉（js/site-nav.js）を読み込んでいません")
        if "assets/favicon-64.png" not in src or "assets/apple-touch-icon.png" not in src:
            bad(f"{rel}: アイコン（favicon・apple-touch-icon）の指定がありません")
    if blocks:
        base_rel, (base_norm, _, _) = next(iter(blocks.items()))
        diff = [rel for rel, (norm, _, _) in blocks.items() if norm != base_norm]
        if diff:
            bad(f"共通ヘッダーの内容が、{base_rel} と違います：{diff}")
        else:
            ok(f"共通ヘッダーは、{len(blocks)} ページで同じ内容です（ロゴ → スタンプラリー、メニュー → 「すきまキッズラボ」とは？・Instagram）")
    # メニューの順番：「すきまキッズラボ」とは？ の直後に Instagram
    for rel, (_, block, _) in blocks.items():
        about = re.search(r"「すきまキッズラボ」(?:<[^>]+>)*とは？", block)
        if not about or block.find("menu-instagram") < about.start():
            bad(f"{rel}: メニューで、「すきまキッズラボ」とは？ の下にInstagramがありません")
    for name in ("logo.webp", "banner.webp", "banner-rally.webp", "apple-touch-icon.png", "favicon-64.png", "favicon-32.png"):
        (ok if os.path.exists(os.path.join(ROOT, "assets", name)) else bad)(f"assets/{name}" + ("" if os.path.exists(os.path.join(ROOT, "assets", name)) else " がありません"))


def check_required():
    js = re.search(r"const\s+PRIZE_REQUIRED\s*=\s*(\d+)\s*;", read("rally/app.js"))
    sql = re.search(r"function public\.rally_required_stamps\(\).*?select\s+(\d+)\s*;", read("sql/schema.sql"), flags=re.S)
    if not js or not sql:
        bad("PRIZE_REQUIRED（rally/app.js）または rally_required_stamps()（sql/schema.sql）が見つかりません")
        return
    n = js.group(1)
    if js.group(1) != sql.group(1):
        bad(f"景品の条件が一致しません：rally/app.js は {js.group(1)} 個、sql/schema.sql は {sql.group(1)} 個")
        return
    html = read("rally/index.html")
    fish = len(re.findall(r"^  \w+: \{", read("js/fish-data.js"), flags=re.M))
    pairs = [("requiredCount（景品の条件の個数）", re.search(r'id="requiredCount">(\d+)<', html), n),
             ("riverTotal（川が完成する個数）", re.search(r'id="riverTotal">(\d+)<', html), str(fish)),
             ("total（バナーの分母）", re.search(r'id="total"[^>]*>(\d+)<', html), str(fish)),
             ("aria-valuemax（ゲージ）", re.search(r'aria-valuemax="(\d+)"', html), str(fish)),
             ]
    css = read("rally/style.css")
    pairs += [("rally/style.css の --segs（ゲージの区切りの数）", re.search(r"\.gauge\{[^}]*--segs:(\d+)", css), str(fish)),
              ("rally/style.css の --prize-col（景品の目盛りの位置）", re.search(r"\.gauge\{[^}]*--prize-col:(\d+)", css), n)]
    wrong = [f"{label}：{m.group(1) if m else '（なし）'}、正しくは {want}" for label, m, want in pairs if not m or m.group(1) != want]
    if wrong:
        bad("初期表示が、設定と一致していません：" + " / ".join(wrong))
    else:
        ok(f"景品の条件は {n} 個、川の完成は {fish} 個（魚 {fish} 種類）で、JavaScript・SQL・HTMLが一致しています")


def check_fish():
    data = read("js/fish-data.js")
    fish = re.findall(r"^  (\w+): (\{.*\})", data, flags=re.M)
    keys = [k for k, _ in fish]
    if not keys:
        bad("js/fish-data.js に、魚のデータがありません（python3 scripts/make_fish_assets.py を実行してください）")
        return
    missing = []
    for key, body in fish:
        for file in re.findall(r'"(?:stamp|silhouette|layer)": "([^"]+)"', body):
            if not os.path.exists(os.path.join(ROOT, "assets", "fish", file)):
                missing.append(file)
    scene = re.search(r'"file": "([^"]+)"', data)
    if not scene or not os.path.exists(os.path.join(ROOT, "assets", "fish", scene.group(1))):
        missing.append("（川の背景）")
    (bad if missing else ok)(f"魚の画像が見つかりません：{missing}" if missing else f"魚 {len(keys)} 種類の画像（スタンプ・シルエット・重ね画像）と川の背景が、すべてあります")

    sql_keys = re.search(r"function public\.rally_fish_keys\(\).*?array\[([^\]]*)\]", read("sql/schema.sql"), flags=re.S)
    sql_keys = re.findall(r"'(\w+)'", sql_keys.group(1)) if sql_keys else []
    (ok if sorted(sql_keys) == sorted(keys) else bad)(
        f"魚の種類が、js/fish-data.js と sql/schema.sql の rally_fish_keys() で一致しています" if sorted(sql_keys) == sorted(keys)
        else f"魚の種類が一致しません：JavaScript {sorted(keys)} / SQL {sorted(sql_keys)}")
    script_keys = re.findall(r'^\s+\("(\w+)", "[^"]+", "[^"]+"\),?$', read("scripts/make_fish_assets.py"), flags=re.M)
    (ok if sorted(script_keys) == sorted(keys) else bad)(
        "魚の種類が、scripts/make_fish_assets.py の FISH とも一致しています" if sorted(script_keys) == sorted(keys)
        else f"魚の種類が一致しません：js/fish-data.js {sorted(keys)} / scripts/make_fish_assets.py {sorted(script_keys)}（変換スクリプトを実行し直してください）")

    js_order = re.search(r"RALLY_FISH_DEFAULT_ORDER\s*=\s*\[([^\]]*)\]", read("js/fish.js"))
    js_order = re.findall(r'"(\w+)"', js_order.group(1)) if js_order else []
    sql_order = re.search(r"function public\.rally_default_fish_order\(\).*?array\[([^\]]*)\]", read("sql/schema.sql"), flags=re.S)
    sql_order = re.findall(r"'(\w+)'", sql_order.group(1)) if sql_order else []
    if sorted(js_order) != sorted(keys):
        bad(f"js/fish.js の RALLY_FISH_DEFAULT_ORDER が、魚の種類をちょうど1回ずつ並べたものになっていません：{js_order}")
    elif js_order != sql_order:
        bad(f"魚の初期の順番が一致しません：js/fish.js {js_order} / sql/schema.sql {sql_order}")
    else:
        ok(f"魚の初期の順番が、JavaScriptとSQLで一致しています（{' → '.join(js_order)}）")

    needs = {"rally/index.html": ["fish-data.js", "fish.js", "app.js"], "admin/index.html": ["fish-data.js", "fish.js", "app.js"]}
    for rel, order in needs.items():
        src = read(rel)
        pos = []
        for name in order:
            m = re.search(r'<script[^>]+src="[^"]*' + re.escape(name), src)   # コメントの中の名前ではなく、実際の <script> の位置
            pos.append(m.start() if m else -1)
        (ok if all(p >= 0 for p in pos) and pos == sorted(pos) else bad)(
            f"{rel}: fish-data.js → fish.js → app.js の順に読み込んでいます" if all(p >= 0 for p in pos) and pos == sorted(pos)
            else f"{rel}: fish-data.js → fish.js → app.js の順に読み込んでいません")


def check_reset():
    """参加者のスタンプのリセット：SQLの関数・権限と、参加者の画面・管理画面の呼び出しが、そろっているか"""
    sql = read("sql/schema.sql")
    problems = []
    if not re.search(r"alter table public\.participant_resets enable row level security", sql):
        problems.append("participant_resets の行レベルセキュリティ（RLS）が有効になっていません")
    if not re.search(r"revoke all on [^;]*public\.participant_resets[^;]*from public, anon, authenticated", sql):
        problems.append("participant_resets への直接のアクセスが、取り消されていません（revoke）")
    admin = re.search(r"function public\.admin_reset_progress\(.*?\n\$\$;", sql, flags=re.S)
    if not admin or "public.is_admin()" not in admin.group(0):
        problems.append("admin_reset_progress が、管理者かどうかを確かめていません（is_admin）")
    if not re.search(r"revoke all on function public\.admin_reset_progress\(text, boolean\) from public, anon", sql) \
            or not re.search(r"grant execute on function public\.admin_reset_progress\(text, boolean\) to authenticated", sql):
        problems.append("admin_reset_progress の実行権限（anon は不可・ログイン済みのみ）が、正しくありません")
    if not re.search(r"grant execute on function public\.rally_reset_count\(text\) to anon", sql):
        problems.append("rally_reset_count を、参加者（anon）が呼べません")
    if not re.search(r"function public\.record_scan\([^)]*p_reset_count integer default null", sql, flags=re.S) \
            or not re.search(r"drop function if exists public\.record_scan\(text, text, text\);", sql):
        problems.append("record_scan に p_reset_count がない、または旧版の関数を削除していません")
    rally, adm = read("rally/app.js"), read("admin/app.js")
    if '"rally_reset_count"' not in rally or "p_reset_count" not in rally:
        problems.append("rally/app.js が、rally_reset_count の確認と、record_scan への p_reset_count の送信をしていません")
    if '"admin_reset_progress"' not in adm or "p_delete_survey" not in adm:
        problems.append("admin/app.js が、admin_reset_progress（p_delete_survey つき）を呼んでいません")
    (bad if problems else ok)("；".join(problems) if problems else "スタンプのリセット：SQLの関数・権限（管理者のみ・RLS）と、画面からの呼び出しが、そろっています")


def check_popups():
    """スタンプラリー画面：バナー（中央）・獲得の演出（後光）・ルール説明のポップアップ"""
    html, css, js = read("rally/index.html"), read("rally/style.css"), read("rally/app.js")
    problems = []

    # バナー：「スタンプラリー」の文字つきの画像が、h1 の中にあり、左右の中央に置かれている
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, flags=re.S)
    img = re.search(r"<img\b[^>]*>", h1.group(1)) if h1 else None
    attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', img.group(0))) if img else {}
    if attrs.get("src") != "../assets/banner-rally.webp" or "スタンプラリー" not in attrs.get("alt", ""):
        problems.append("rally/index.html の h1 に、バナー（assets/banner-rally.webp。alt に「スタンプラリー」を含む）がありません")
    else:
        path = os.path.join(ROOT, "assets", "banner-rally.webp")
        try:
            from PIL import Image
            with Image.open(path) as im:
                if (str(im.width), str(im.height)) != (attrs.get("width"), attrs.get("height")):
                    problems.append(f"バナーの width / height（{attrs.get('width')}×{attrs.get('height')}）が、画像の大きさ {im.width}×{im.height} と違います")
        except ImportError:
            pass
    if not re.search(r"\.hero-banner\.rally\{[^}]*margin-left:auto[^}]*margin-right:auto", css):
        problems.append("rally/style.css: バナー（.hero-banner.rally）が、左右の中央（margin-left / margin-right:auto）になっていません")

    # ポップアップ：<dialog> と、その見出し（aria-labelledby）。閉じているときは、見えないこと
    for dialog_id in ("getDialog", "rulesDialog"):
        m = re.search(r'<dialog id="' + dialog_id + r'"[^>]*aria-labelledby="([^"]+)"', html)
        if not m or f'id="{m.group(1)}"' not in html:
            problems.append(f"rally/index.html: {dialog_id} がない、または、見出し（aria-labelledby）の先が、ありません")
    if not re.search(r"dialog:not\(\[open\]\)\{display:none\}", css):
        problems.append("rally/style.css: dialog:not([open]){display:none} がありません（古いブラウザで、閉じているはずの中身が見えてしまいます）")
    if "prefers-reduced-motion" not in css:
        problems.append("rally/style.css: 「視差効果を減らす」設定への対応（prefers-reduced-motion）がありません")

    # ルール説明：「次回からは表示しない」を、端末に保存し（参加者IDと同じ store）、獲得の演出のあとに出す
    if not re.search(r'const\s+rulesKey\s*=\s*"stamp_rally_hide_rules"', js) or "store.set(rulesKey" not in js or "store.remove(rulesKey" not in js:
        problems.append("rally/app.js: 「次回からは表示しない」を、store（端末への保存）に保存・解除していません")
    if "await celebration" not in js or "showRules()" not in js:
        problems.append("rally/app.js: 獲得の演出が終わってから、ルール説明を出す流れ（await celebration → showRules）がありません")
    if "showModal" not in js:
        problems.append("rally/app.js: ポップアップを、<dialog> の showModal() で開いていません")

    if problems:
        bad("；".join(problems))
    else:
        ok("バナーは左右の中央・獲得の演出・ルール説明（「次回からは表示しない」を端末に保存）が、そろっています")


def image_size_problems(rel):
    """<img> の width / height が、画像ファイルの実際の大きさと同じか（Pillow があるときだけ確認する。違うと、読み込み中に、レイアウトがずれる）"""
    try:
        from PIL import Image
    except ImportError:
        return []
    out = []
    base = os.path.dirname(rel)
    for tag in re.findall(r"<img\b[^>]*>", read(rel)):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', tag))
        src = attrs.get("src", "")
        if not src or src.startswith(("http", "data:")):
            continue
        path = os.path.normpath(os.path.join(ROOT, base, src))
        if not os.path.isfile(path):
            out.append(f"{rel}: 画像 {src} がありません")
            continue
        with Image.open(path) as im:
            if (str(im.width), str(im.height)) != (attrs.get("width"), attrs.get("height")):
                out.append(f"{rel}: {src} の width / height（{attrs.get('width')}×{attrs.get('height')}）が、画像の大きさ {im.width}×{im.height} と違います")
    return out


def check_story():
    """トップページ：紹介文（段落）・画像・スクロールで順番に現れる動き"""
    html, css = read("index.html"), read("style.css")
    problems = []
    m = re.search(r'<div class="story">(.*?)\n  </div>', html, flags=re.S)
    if not m:
        bad("index.html: 紹介文の入れもの（<div class=\"story\">）がありません")
        return
    block = m.group(1)
    tags = re.findall(r"<(?:p|figure)\b[^>]*>", block)
    missing = [t for t in tags if "data-reveal" not in t]
    if not tags:
        problems.append("紹介文の段落（<p>）や画像（<figure>）が、1つもありません")
    if missing:
        problems.append(f"data-reveal がない段落・画像があります（スクロールで現れる動きが付きません）：{missing[:2]}")
    for tag in re.findall(r"<img\b[^>]*>", block):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', tag))
        if len(attrs.get("alt", "")) < 3:
            problems.append(f"画像 {attrs.get('src')} に、alt（画像の説明）がありません")
        if attrs.get("loading") != "lazy":
            problems.append(f"画像 {attrs.get('src')} が、遅延読み込み（loading=\"lazy\"）になっていません")
    # 動きの部品：ちらつかないよう、<head> で、そのまま（defer・asyncなしで）読み込む
    head = re.search(r"<head>.*?</head>", html, flags=re.S)
    tag = re.search(r'<script\b[^>]*src="js/reveal\.js[^"]*"[^>]*>', head.group(0)) if head else None
    if not tag or re.search(r"\b(defer|async)\b", tag.group(0)):
        problems.append("index.html: js/reveal.js を、<head> の中で、defer・asyncなしで読み込んでいません")
    js = read("js/reveal.js")
    if "prefers-reduced-motion" not in js or '"IntersectionObserver" in window' not in js:
        problems.append("js/reveal.js: 「視差効果を減らす」・IntersectionObserver がないときに、動きを止める処理がありません")
    if not re.search(r"\.reveal-on \[data-reveal\]\{", css) or "prefers-reduced-motion" not in css:
        problems.append("style.css: スクロールで現れる動き（.reveal-on [data-reveal]）、または、「視差効果を減らす」への対応が、ありません")
    for rel in PUBLIC_PAGES:
        problems += image_size_problems(rel)
    if problems:
        bad("；".join(problems))
    else:
        n_p, n_f = len(re.findall(r"<p\b", block)), len(re.findall(r"<figure\b", block))
        ok(f"トップページの紹介文（段落 {n_p}・画像 {n_f}）は、すべて、スクロールで順番に現れる設定で、画像の説明（alt）・大きさ（width/height）も、そろっています")


def check_policy():
    """プライバシー規約（survey/privacy.html）・アンケートの同意・フッターの表記"""
    policy, survey, js = read("survey/privacy.html"), read("survey/index.html"), read("survey/app.js")
    problems = []
    # 規約：項の番号が、1から順に並んでいるか。版（data-version）と、本文の「版：」が同じか
    nums = [int(n) for n in re.findall(r"<h2>(\d+)\. ", policy)]
    if nums != list(range(1, len(nums) + 1)) or not nums:
        problems.append(f"survey/privacy.html: 項の番号が、1から順に並んでいません（{nums}）")
    version = re.search(r'data-version="([^"]+)"', policy)
    shown = re.search(r"版：([\w-]+)", policy)
    if not version or not shown or version.group(1) != shown.group(1):
        problems.append(f"survey/privacy.html: data-version（{version.group(1) if version else 'なし'}）と、本文の「版：」（{shown.group(1) if shown else 'なし'}）が違います")
    # アンケート：要点の枠は削除済み。規約の全文は、同意欄のリンクから開く
    if "privacy-summary" in survey or "個人情報の取り扱い（要点）" in survey:
        problems.append("survey/index.html: 「個人情報の取り扱い（要点）」の枠が残っています（削除する指示です）")
    consent = re.search(r'<label class="check consent">.*?</label>', survey, flags=re.S)
    if not consent or "data-open-privacy" not in consent.group(0):
        problems.append("survey/index.html: 同意の欄から、プライバシー規約の全文を開けません")
    # 景品を希望するときは、同意にチェックを入れるまで「送信する」を押せない
    if "submitBtn.disabled=prizeRequested.checked && !consent.checked" not in js or "consent.onchange=syncSubmit" not in js or "submitBtn.disabled=false" in js:
        problems.append("survey/app.js: 景品を希望するとき、規約への同意にチェックを入れるまで「送信する」を押せない処理が、そろっていません")
    # 規約の第8項：問い合わせのときに知らせてもらうのは、「参加者ID」と「氏名」
    sec8 = re.search(r"<h2>8\. .*?(?=<h2>9\. )", policy, flags=re.S)
    if not sec8 or "「参加者ID」と「氏名」" not in sec8.group(0):
        problems.append("survey/privacy.html: 第8項に、「参加者ID」と「氏名」をお知らせいただく、という文がありません")
    # 規約の第2項：収集する情報が、アンケートの実際の質問と合っているか
    sec2 = re.search(r"<h2>2\. .*?(?=<h2>3\. )", policy, flags=re.S)
    for word in ("楽しかった", "普段行かない場所", "掲示板を見る", "以外の掲示物", "きっかけ", "ご意見・ご感想"):
        if not sec2 or word not in sec2.group(0):
            problems.append(f"survey/privacy.html: 第2項（収集する情報）に、アンケートの質問「{word}」が書かれていません")
    # フッター：お問い合わせ・運営のロゴ・小文字のコピーライト。5ページで同じ内容
    blocks = {}
    for rel in ("index.html", "rally/index.html", "survey/index.html", "survey/privacy.html", "reset/index.html"):
        m = re.search(r'<footer class="site-footer">.*?</footer>', read(rel), flags=re.S)
        if not m:
            problems.append(f"{rel}: 共通フッター（<footer class=\"site-footer\">）がありません")
            continue
        blocks[rel] = m.group(0).replace("../assets/", "assets/")
        copy = re.search(r'<p class="copyright en">([^<]*)</p>', m.group(0))
        if not copy or copy.group(1) != copy.group(1).lower():
            problems.append(f"{rel}: フッターの文字が、小文字になっていません（{copy.group(1) if copy else 'なし'}）")
        if "お問い合わせ" not in m.group(0) or 'href="mailto:info@ponddesignlab.com"' not in m.group(0) or INSTAGRAM_URL not in m.group(0):
            problems.append(f"{rel}: フッターに、お問い合わせ（Instagram・メール info@ponddesignlab.com）がありません")
        logo = re.search(r'<img src="((?:\.\./)?assets/pond-logo\.webp)"[^>]*>', m.group(0))
        if not logo or not re.search(r'\bwidth="\d+"', logo.group(0)) or not re.search(r'\bheight="\d+"', logo.group(0)) or 'alt="Pond Design Laboratory' not in logo.group(0):
            problems.append(f"{rel}: フッターのロゴ（assets/pond-logo.webp）の指定（width・height・alt）が、そろっていません")
    if len(set(blocks.values())) > 1:
        problems.append("共通フッターの内容が、ページによって違います：" + "・".join(sorted(blocks)))
    if not os.path.isfile(os.path.join(ROOT, "assets", "pond-logo.webp")):
        problems.append("assets/pond-logo.webp がありません")
    if re.search(r"^\s*footer\s*\{", read("style.css") + read("rally/style.css"), flags=re.M):
        problems.append("style.css・rally/style.css に、旧い footer{…} の指定が、残っています（フッターのスタイルは brand.css の .site-footer だけにします）")
    if problems:
        bad("；".join(problems))
    else:
        ok(f"規約は {len(nums)} 項・版 {version.group(1)}（第8項は「参加者ID」と「氏名」・第2項はアンケートの質問と一致）、同意にチェックするまで「送信する」を押せず、共通フッター（お問い合わせ・ロゴ・小文字のコピーライト）は5ページで同じです")
    todo = len(re.findall(r'<mark class="todo">', policy)) + len(re.findall(r'<mark class="todo">', survey))
    if todo:
        warn(f"プライバシー規約に【要確認】が {todo} か所残っています。記入したら、「下書き」の注意書き（class=\"draft-banner\"）も消してください")


def check_email():
    """景品の発送先のメールアドレス：入力欄 → submit_survey → prize_shipping → 管理画面の表・CSV"""
    survey, js, sql = read("survey/index.html"), read("survey/app.js"), read("sql/schema.sql")
    admin_html, admin_js, policy = read("admin/index.html"), read("admin/app.js"), read("survey/privacy.html")
    problems = []
    shipping = re.search(r'<fieldset id="shipping".*?</fieldset>', survey, flags=re.S)
    ids = re.findall(r'<input id="(\w+)"', shipping.group(0)) if shipping else []
    if "phone" not in ids or "email" not in ids or ids.index("email") != ids.index("phone") + 1:
        problems.append(f"survey/index.html: 景品の発送先の入力欄に、電話番号の次のメールアドレス（id=\"email\"）がありません（{ids}）")
    email_tag = re.search(r'<input id="email"[^>]*>', survey)
    if not email_tag or " required" not in email_tag.group(0) or 'inputmode="email"' not in email_tag.group(0):
        problems.append("survey/index.html: メールアドレスの入力欄が、必須（required）・メール用キーボード（inputmode=\"email\"）になっていません")
    if "p_email" not in js or "invalid_email" not in js or "normalizeEmail" not in js:
        problems.append("survey/app.js: メールアドレスの検査・p_email の送信・invalid_email のメッセージが、そろっていません")
    fn = re.search(r"create or replace function public\.submit_survey\((.*?)\)\s*returns text", sql, flags=re.S)
    args = [a for a in re.split(r",\s*\n", fn.group(1)) if a.strip()] if fn else []
    # 引数は17個：13個目が p_email（そのうしろに、アンケートの新しい質問の4つ。check_schedule が確認する）
    if not fn or "p_email text default null" not in fn.group(1) or len(args) != 17 or not args[12].strip().startswith("p_email text default null"):
        problems.append(f"sql/schema.sql: submit_survey の引数が17個（13個目が p_email text default null）になっていません（{len(args)} 個）")
    grant = re.search(r"grant execute on function public\.submit_survey\(([^)]*)\)", sql)
    if not grant or len([a for a in grant.group(1).split(",") if a.strip()]) != 17:
        problems.append("sql/schema.sql: submit_survey の権限（grant）が、引数17個の版に付いていません")
    if "drop function if exists public.submit_survey(text, integer, text, text, boolean, text, text, text, text, boolean, text, text, text);" not in sql:
        problems.append("sql/schema.sql: 13引数の旧い submit_survey を削除する行がありません（残ると、呼び出しが曖昧になります）")
    if "invalid_email" not in sql or "add column if not exists email text" not in sql or "  email text\n" not in sql:
        problems.append("sql/schema.sql: email の列（新規作成と、旧版への追加）・invalid_email の検査が、そろっていません")
    if "drop function if exists public.submit_survey(text, integer, text, text, boolean, text, text, text, text, boolean, text, text);" not in sql:
        problems.append("sql/schema.sql: 12引数の旧い submit_survey を削除する行がありません（残ると、呼び出しが曖昧になります）")
    if "メールアドレス</th>" not in admin_html or admin_js.count("x.email") < 2 or '"メールアドレス"' not in admin_js:
        problems.append("admin: 景品発送先の表・CSVに、メールアドレスがありません")
    if "メールアドレス" not in policy:
        problems.append("survey/privacy.html: 規約に、メールアドレスを集めることが書かれていません")
    if problems:
        bad("；".join(problems))
    else:
        ok("メールアドレス：入力欄（電話番号の次・必須）→ submit_survey（17引数・検査・権限）→ prize_shipping.email → 管理画面の表・CSV・規約が、そろっています")


def check_bulk():
    """管理画面：チェックボックスで複数選んで、まとめて除外・リセット・アンケートの削除（SQLの関数と、画面の呼び出し）"""
    sql, adm, html, css = read("sql/schema.sql"), read("admin/app.js"), read("admin/index.html"), read("admin/style.css")
    problems = []
    # SQL：3つの関数は、管理者だけ（is_admin）・anonは実行できない・ログイン済みのみ。内部の関数は、誰も直接は呼べない
    for name, sig in (("admin_set_excluded_many", "text[], boolean, text"), ("admin_reset_progress_many", "text[], boolean"), ("admin_delete_surveys", "text[]")):
        body = re.search(rf"function public\.{name}\(.*?\n\$\$;", sql, flags=re.S)
        if not body or "public.is_admin()" not in body.group(0) or "public.admin_clean_ids(" not in body.group(0):
            problems.append(f"{name} が、管理者の確認（is_admin）と、IDの検査（admin_clean_ids）をしていません")
        if not re.search(rf"revoke all on function public\.{name}\({re.escape(sig)}\) from public, anon", sql) \
                or not re.search(rf"grant execute on function public\.{name}\({re.escape(sig)}\) to authenticated", sql):
            problems.append(f"{name} の実行権限（anon は不可・ログイン済みのみ）が、正しくありません")
    if not re.search(r"revoke all on function public\.admin_clean_ids\(text\[\]\) from public, anon, authenticated", sql):
        problems.append("admin_clean_ids（内部用）が、管理画面から直接呼べる状態です")
    clean = re.search(r"function public\.admin_clean_ids\(.*?\n\$\$;", sql, flags=re.S)
    if not clean or "> 1000" not in clean.group(0) or "not between 4 and 64" not in clean.group(0):
        problems.append("admin_clean_ids に、件数の上限（1000件）と、参加者IDの長さの検査がありません")
    # 画面：RPCの呼び出し・チェックボックス・バー・ダイアログ・上限
    for rpc in ("admin_set_excluded_many", "admin_reset_progress_many", "admin_delete_surveys"):
        if f'"{rpc}"' not in adm:
            problems.append(f"admin/app.js が、{rpc} を呼んでいません")
    for needed in ('id="participantAll"', 'id="surveyAll"', 'id="participantBulk"', 'id="surveyBulk"', 'id="surveyDeleteDialog"', 'id="bulkExclude"', 'id="bulkRelease"', 'id="bulkReset"', 'id="bulkDeleteSurvey"'):
        if needed not in html:
            problems.append(f"admin/index.html に {needed} がありません")
    if "BULK_LIMIT=1000" not in adm or "pruneSelection" not in adm:
        problems.append("admin/app.js に、1回の上限（BULK_LIMIT=1000）、または、見えなくなった行を選択から外す処理（pruneSelection）がありません")
    if not re.search(r"\.bulkbar\[hidden\]\{display:none\}", css):
        problems.append("admin/style.css: 一括操作のバーが hidden のときに、隠れない（.bulkbar[hidden]）")
    if problems:
        bad("；".join(problems))
    else:
        ok("管理画面の一括操作：SQLの3つの関数（管理者のみ・1000件まで・まとめて1回の処理）と、チェックボックス・バー・確認の画面が、そろっています")


def check_device_reset():
    """この端末の履歴の完全リセット（reset/）：サイトが localStorage に保存している履歴の名前が、すべて reset/app.js に載っているか"""
    app, html, rally, admin_html = read("reset/app.js"), read("reset/index.html"), read("rally/app.js"), read("admin/index.html")
    problems = []
    # サイトが保存している履歴の名前（"stamp_rally_…"）。JavaScriptのどこかに出てくるものを、すべて集める
    used = set()
    for rel in ("rally/app.js", "survey/app.js", "admin/app.js"):
        used |= set(re.findall(r"[\"']((?:stamp_rally)_[a-z_]+)[\"']", read(rel)))
    listed = set(re.findall(r'key: "([a-z_]+)"', app))
    missing = sorted(used - listed)
    if not used:
        problems.append("サイトが保存している履歴の名前を、見つけられませんでした（この確認の正規表現を見直してください）")
    if missing:
        problems.append(f"reset/app.js の LABELS に、サイトが保存している履歴 {missing} が載っていません（消えますが、名前なしの「その他の履歴」になります）")
    stale = sorted(listed - used)
    if stale:
        problems.append(f"reset/app.js の LABELS に、サイトが使っていない履歴 {stale} が載っています")
    if "localStorage.clear()" not in app or "sessionStorage.clear()" not in app:
        problems.append("reset/app.js が、localStorage・sessionStorage を、まるごと消していません")
    if 'name="robots" content="noindex"' not in html:
        problems.append("reset/index.html が、検索エンジンに載らない設定（noindex）になっていません")
    if 'href="../reset/"' not in admin_html:
        problems.append("admin/index.html のメニューに、reset/ へのリンクがありません")
    if not re.search(r"addEventListener\(\"storage\",event=>\{ if\(event\.key===null\) location\.reload\(\)", rally):
        problems.append("rally/app.js が、別のタブで履歴が消されたときに、開き直す処理（storage イベント）を持っていません")
    for rel in ("index.html", "rally/index.html", "survey/index.html", "survey/privacy.html"):
        if "reset/" in read(rel):
            problems.append(f"{rel} に、reset/ へのリンクがあります（参加者の画面には、載せない決まりです）")
    if problems:
        bad("；".join(problems))
    else:
        ok(f"履歴のリセット：サイトが保存している履歴 {len(used)} 種類が、すべて reset/app.js に載っていて、まるごと消す処理・別のタブの開き直し・管理画面のリンクが、そろっています")


def check_full_reset():
    """管理画面の「完全リセット」と、アンケート削除後の答え直し：SQL・スタンプラリー画面・アンケート画面・管理画面"""
    sql, rally, survey, adm, html = read("sql/schema.sql"), read("rally/app.js"), read("survey/app.js"), read("admin/app.js"), read("admin/index.html")
    problems = []
    if "add column if not exists last_full_reset_count integer not null default 0" not in sql:
        problems.append("sql/schema.sql: participant_resets に last_full_reset_count 列がありません")
    state = re.search(r"function public\.rally_reset_state\(.*?\n\$\$;", sql, flags=re.S)
    if not state or "security definer" not in state.group(0) or "survey_submitted" not in state.group(0) or "full_reset_count" not in state.group(0):
        problems.append("sql/schema.sql: rally_reset_state が、リセットの回数・完全リセット・アンケートの有無を返していません（security definer）")
    if not re.search(r"revoke all on function public\.rally_reset_state\(text\) from public;", sql) or not re.search(r"grant execute on function public\.rally_reset_state\(text\) to anon, authenticated;", sql):
        problems.append("sql/schema.sql: rally_reset_state の実行権限（誰でも呼べる）が、そろっていません")
    full = re.search(r"function public\.admin_full_reset_many\(.*?\n\$\$;", sql, flags=re.S)
    if not full or "public.is_admin()" not in full.group(0) or "public.admin_clean_ids(" not in full.group(0) or "last_full_reset_count = reset_count" not in full.group(0) or "public.admin_reset_progress(" not in full.group(0):
        problems.append("sql/schema.sql: admin_full_reset_many が、管理者の確認・IDの検査・通常のリセット・完全リセットの印をそろえていません")
    if not re.search(r"revoke all on function public\.admin_full_reset_many\(text\[\], boolean\) from public, anon", sql) or not re.search(r"grant execute on function public\.admin_full_reset_many\(text\[\], boolean\) to authenticated", sql):
        problems.append("sql/schema.sql: admin_full_reset_many の実行権限（anon は不可・ログイン済みのみ）が、正しくありません")
    # スタンプラリー画面：状態の確認・完全リセットの判定・端末の履歴の消去・書き戻しの防止・旧い関数への切り替え
    for needed in ('"rally_reset_state"', "function wipeDevice(", "state.full>localResetCount()", "async function applyServerReset(", "let wiping", '"rally_reset_count"'):
        if needed not in rally:
            problems.append(f"rally/app.js に {needed} がありません")
    if "if(wiping) return;" not in rally or not re.search(r"set\(k,v\)\{ if\(wiping\) return;", rally):
        problems.append("rally/app.js: 完全リセットで開き直している間に、記録を書き戻さない処理（wiping）がありません")
    if "localStorage.clear()" not in rally:
        problems.append("rally/app.js の wipeDevice が、localStorage をまるごと消していません")
    if "surveyStillSubmitted" not in survey or '"rally_reset_state"' not in survey or "survey_submitted===false" not in survey:
        problems.append("survey/app.js が、端末の「回答済み」の印を、サーバーに回答がないときに消す処理（surveyStillSubmitted）を持っていません")
    for needed in ('"admin_full_reset_many"', "data-fullreset", "resetFull"):
        if needed not in adm:
            problems.append(f"admin/app.js に {needed} がありません")
    for needed in ('id="bulkFullReset"', 'id="resetOk"'):
        if needed not in html:
            problems.append(f"admin/index.html に {needed} がありません")
    if "答え直せません" in adm:
        problems.append("admin/app.js: アンケート削除の確認に、「答え直せません」という古い説明が残っています（いまは、答え直せます）")
    if problems:
        bad("；".join(problems))
    else:
        ok("完全リセット・答え直し：SQL（列・rally_reset_state・admin_full_reset_many・権限）と、スタンプラリー画面・アンケート画面・管理画面が、そろっています")


def check_prize_info():
    """「？ 景品について」のポップアップ：スタンプラリー画面・アンケート画面のボタン、js/prize-info.js の中身、画像"""
    js, css = read("js/prize-info.js"), read("prize.css")
    rally, survey = read("rally/index.html"), read("survey/index.html")
    problems = []
    # 景品をゲットできる条件（スタンプの個数）が、rally/app.js の PRIZE_REQUIRED と同じ
    required = re.search(r"required:\s*(\d+)", js)
    prize_required = re.search(r"const\s+PRIZE_REQUIRED\s*=\s*(\d+)", read("rally/app.js"))
    if not required or not prize_required or required.group(1) != prize_required.group(1):
        problems.append(f"js/prize-info.js の required（{required.group(1) if required else 'なし'}）が、rally/app.js の PRIZE_REQUIRED（{prize_required.group(1) if prize_required else 'なし'}）と違います")
    # 先着の人数・おひとり様一つ限りの説明は、ポップアップに入れない（運営の判断で外した。書く場合は、運営に確認する）
    if re.search(r"先着|おひとり|prize-limit|prize-chips", js + css):
        problems.append("js/prize-info.js・prize.css: 先着の人数・おひとり様一つ限りの説明（数に限りがあります）が、残っています。ポップアップには入れない決まりです")
    # 画像：assets/prize/ にあり、width / height が、画像の大きさと同じ
    try:
        from PIL import Image
    except ImportError:
        Image = None
    for key, width, height in re.findall(r'(\w+):\s*\{\s*file:\s*"[^"]+",\s*width:\s*(\d+),\s*height:\s*(\d+)', js):
        fname = re.search(key + r':\s*\{\s*file:\s*"([^"]+)"', js).group(1)
        path = os.path.join(ROOT, "assets", "prize", fname)
        if not os.path.isfile(path):
            problems.append(f"assets/prize/{fname} がありません（python3 scripts/make_fish_assets.py で作ります）")
        elif Image:
            with Image.open(path) as im:
                if (str(im.width), str(im.height)) != (width, height):
                    problems.append(f"js/prize-info.js の {key} の width / height（{width}×{height}）が、画像 assets/prize/{fname} の大きさ {im.width}×{im.height} と違います")
    if "alt:" not in js:
        problems.append("js/prize-info.js: 画像の説明（alt）がありません")
    # ボタン：スタンプラリー画面は、進捗の枠（#progressBanner）の中。アンケート画面は、「景品を希望する」のチェックボックスの直後
    banner = re.search(r'<section id="progressBanner".*?</section>', rally, flags=re.S)
    if not banner or "data-prize-open" not in banner.group(0) or "景品について" not in banner.group(0):
        problems.append("rally/index.html: 進捗の枠（#progressBanner）の中に、「？ 景品について」のボタン（data-prize-open）がありません")
    after = re.search(r'id="prizeRequested"[^>]*>\s*景品を希望する</label>\s*(?:<!--.*?-->\s*)?<p class="prize-help"><button[^>]*data-prize-open[^>]*>.*?景品について</button>', survey, flags=re.S)
    if not after:
        problems.append("survey/index.html: 「景品を希望する」のチェックボックスの直後に、「？ 景品について」のボタン（data-prize-open）がありません")
    for rel, html in (("rally/index.html", rally), ("survey/index.html", survey)):
        if "prize.css" not in html or "js/prize-info.js" not in html:
            problems.append(f"{rel}: prize.css・js/prize-info.js を読み込んでいません")
    # アンケート画面では、prize.css を、アンケートのCSSより後に読み込む（dialog の指定に、負けないように）
    if survey.find("prize.css") < survey.find("style.css"):
        problems.append("survey/index.html: prize.css は、style.css より後に読み込んでください（アンケートの dialog の指定に負けます）")
    if not re.search(r"\.prize-dialog:not\(\[open\]\)\{display:none\}", css) or "prefers-reduced-motion" not in css:
        problems.append("prize.css: 閉じているとき見えない指定（.prize-dialog:not([open])）、または、「視差効果を減らす」への対応がありません")
    if "SiteNav" not in js:
        problems.append("js/prize-info.js: ポップアップを開く前に、メニューを閉じていません（window.SiteNav）")
    if problems:
        bad("；".join(problems))
    else:
        ok(f"「景品について」：スタンプラリー画面・アンケート画面のボタンと、ポップアップ（スタンプ {required.group(1)} 個・画像2枚・先着や一つ限りの説明なし）が、そろっています")


def check_complete_image():
    """コンプリートのときの、川の左上のバナー・日時と、完成画像の保存：画面（CSS）と、保存する画像（JavaScript）の、位置・大きさが同じか"""
    html, css, js = read("rally/index.html"), read("rally/style.css"), read("rally/app.js")
    problems = []
    for needed in ('id="riverBadge"', 'id="riverBadgeDate"', 'id="riverActions"', 'id="saveRiver"', 'id="saveDialog"', 'id="saveImage"', 'id="saveDo"'):
        if needed not in html:
            problems.append(f"rally/index.html に {needed} がありません")
    badge = re.search(r'<div id="riverBadge"[^>]*>.*?</div>', html, flags=re.S)
    if not badge or "banner-rally.webp" not in badge.group(0) or "COMPLETE!" not in badge.group(0) or "hidden" not in badge.group(0).split(">")[0]:
        problems.append("rally/index.html: 川の左上のバナー（#riverBadge）が、バナー画像・COMPLETE!・hidden（コンプリート前は隠す）を、そろえていません")
    # 画面（CSS）と、保存する画像（JavaScript）の、位置・大きさ
    layout = re.search(r"COMPLETE_LAYOUT\s*=\s*\{banner:\{x:(\d+),y:(\d+),w:(\d+)\},text:\{x:(\d+),labelSize:([\d.]+),dateSize:([\d.]+),gap:([\d.]+),lineHeight:([\d.]+)\}\}", js)
    scene = re.search(r'SCENE\s*=\s*\{[^}]*"width":\s*(\d+),\s*"height":\s*(\d+)', read("js/fish-data.js"))
    cssb = re.search(r"\.river-badge\{[^}]*left:([\d.]+)%;right:([\d.]+)%;top:([\d.]+)%;[^}]*gap:([\d.]+)%", css)
    cssw = re.search(r"\.river-badge-banner\{[^}]*width:([\d.]+)%", css)
    csst = re.search(r"\.river-badge-text\{[^}]*font-size:([\d.]+)cqw", css)
    csslab = re.search(r"\.river-badge-label\{font-size:([\d.]+)em\}", css)
    if not (layout and scene and cssb and cssw and csst and csslab):
        problems.append("COMPLETE_LAYOUT（rally/app.js）・.river-badge（rally/style.css）・川の背景の大きさ（js/fish-data.js）の、どれかが見つかりません")
    else:
        W, H = int(scene.group(1)), int(scene.group(2))
        bx, by, bw, tx, label, date, gap, lh = (float(layout.group(i)) for i in range(1, 9))
        left, right, top, cgap = (float(cssb.group(i)) for i in range(1, 5))
        inner = W * (1 - (left + right) / 100)
        pairs = [("バナーの左の位置", bx / W * 100, left, .15), ("バナーの上の位置", by / H * 100, top, .15),
                 ("バナーの幅（川の幅に対する割合を、バナーを置く枠の幅に対する割合に直した値）", bw / inner * 100, float(cssw.group(1)), .3),
                 ("日時の文字の左の位置（バナーの右・すき間）", (tx - bx - bw) / inner * 100, cgap, .3),
                 ("日時の文字の大きさ（川の幅に対する割合）", date / W * 100, float(csst.group(1)), .1),
                 ("COMPLETE! の文字の大きさ（日時に対する割合）", label / date, float(csslab.group(1)), .02)]
        for name, a, b, tol in pairs:
            if abs(a - b) > tol:
                problems.append(f"{name}が、画面（rally/style.css）と、保存する画像（rally/app.js の COMPLETE_LAYOUT）で、違います（{a:.2f} と {b:.2f}）")
    for needed in ("makeCompleteImage", "toBlob", "canvas", "navigator.share", "completeTime(", "dateLabel("):
        if needed not in js:
            problems.append(f"rally/app.js に {needed} がありません")
    if "document.fonts" not in js:
        problems.append("rally/app.js: 保存する画像の文字を描く前に、フォントの読み込みを待っていません（document.fonts）")
    if "container-type:inline-size" not in css:
        problems.append("rally/style.css: 川の文字の大きさを、川の幅に合わせる指定（container-type:inline-size）がありません")
    if problems:
        bad("；".join(problems))
    else:
        ok("コンプリート：川の左上のバナー・日時（画面）と、完成画像（保存する画像）の位置・大きさが、同じです。保存は、共有の画面かダウンロードで行います")


def check_menu_dialog():
    """ハンバーガーのメニューとポップアップの関係：メニューを開いたまま、ポップアップが開いても、操作できなくならない"""
    nav, rally = read("js/site-nav.js"), read("rally/app.js")
    problems = []
    if "DIALOG" not in re.search(r"SCRIPT\|STYLE\|LINK\|NOSCRIPT[^/]*", nav).group(0):
        problems.append("js/site-nav.js: メニューを開いたとき、ポップアップ（dialog）を、操作できない状態（inert）にしてしまいます（ポップアップも、操作できなくなります）")
    if "window.SiteNav" not in nav or "whenClosed" not in nav:
        problems.append("js/site-nav.js: メニューの状態を、ほかのプログラムが確かめる口（window.SiteNav.isOpen / whenClosed）がありません")
    if "MutationObserver" not in nav or 'dialog[open]' not in nav:
        problems.append("js/site-nav.js: メニューが開いている間に、ポップアップが開いたとき、メニューを閉じる処理（MutationObserver）がありません")
    if rally.count("await waitForQuiet()") < 3 or "window.SiteNav" not in rally or "async function waitForQuiet" not in rally:
        problems.append("rally/app.js: 自動で出すポップアップ（獲得の演出・ルール説明）と、完成画像の保存が、メニュー・ほかのポップアップが閉じるまで待っていません（await waitForQuiet()）")
    for rel in ("js/prize-info.js",):
        if "SiteNav" not in read(rel):
            problems.append(f"{rel}: ポップアップを開く前に、メニューを閉じていません")
    if not re.search(r"scroll-padding-top\s*:\s*calc\(var\(--header-h\)", read("brand.css")):
        problems.append("brand.css: 固定表示のヘッダーの下に、入力欄・チェックボックスが隠れないようにする指定（scroll-padding-top）がありません")
    if problems:
        bad("；".join(problems))
    else:
        ok("メニューとポップアップ：メニューを開いたまま、ポップアップが開いても、操作できなくならない仕組み（inert の対象外・自動で閉じる・待つ）と、固定ヘッダーの下に隠れない指定が、そろっています")


def check_no_personal_sync():
    """個人情報（発送先）を、スプレッドシートに同期しない：SQL・Apps Script・READMEに、同期する仕組みが、残っていないか"""
    sql, gas, readme = read("sql/schema.sql"), read("gas/sheets-sync.gs"), read("README.md")
    problems = []
    export = re.search(r"function public\.sheets_export\(.*?\n\$\$;", sql, flags=re.S)
    if not export or "prize_shipping" in export.group(0) or "recipient_name" in export.group(0):
        problems.append("sql/schema.sql: sheets_export が、発送先（prize_shipping）を、読み取っています（個人情報は、返してはいけません）")
    finger = re.search(r"function private\.sheets_fingerprint\(.*?\n\$\$;", sql, flags=re.S)
    if not finger or "prize_shipping" in finger.group(0):
        problems.append("sql/schema.sql: 同期の変更検知（sheets_fingerprint）が、発送先（prize_shipping）を、使っています")
    for word in ("recipient_name", "postal_code", "SHIPPING_COLUMNS", "syncShipping", "writeShipping_", "formatPhone_"):
        if word in gas:
            problems.append(f"gas/sheets-sync.gs に、個人情報を同期する仕組み（{word}）が、残っています")
    if "deletePersonalDataSheets" not in gas or "LEGACY_SHIPPING_SHEET" not in gas:
        problems.append("gas/sheets-sync.gs: 旧版の個人情報のシートを、削除する手段（deletePersonalDataSheets）がありません")
    if re.search(r"SYNC_SHIPPING`?\s*=\s*`?true", readme) and "以前のスクリプトは" not in readme:
        problems.append("README.md: 個人情報を同期する設定（SYNC_SHIPPING）を、すすめる記述が、残っています")
    if "同期しません" not in readme:
        problems.append("README.md: 「個人情報は、スプレッドシートに同期しません」の記述がありません")
    if problems:
        bad("；".join(problems))
    else:
        ok("個人情報（発送先）は、スプレッドシートに同期しません（sheets_export・変更検知・Apps Script に、個人情報の同期が、ありません。旧版のシートを削除する手段があります）")


def check_wording():
    """文言の統一：「お魚」の表記・「景品をゲットできる」・川のタイトル・ルール説明の仮の注記の削除"""
    problems = []
    pages = ["index.html", "rally/index.html", "survey/index.html", "survey/privacy.html", "reset/index.html", "admin/index.html", "js/prize-info.js", "js/rally-data.js"]
    scripts = ["rally/app.js", "survey/app.js", "admin/app.js", "reset/app.js"]
    for rel in pages + scripts:
        src = read(rel)
        # コメント（HTMLの <!-- --> と、JavaScriptの // ・ /* */）は、除いて、表示される文言だけを見る
        text = re.sub(r"<!--.*?-->", "", src, flags=re.S)
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        text = "\n".join(re.sub(r"(?<![:\"'])//.*$", "", line) for line in text.split("\n"))
        for m in re.finditer(r"(?<![お川])魚|さかな|サカナ", text):
            problems.append(f"{rel}: 「{text[max(0, m.start() - 6):m.end() + 6].strip()}」（お魚に統一）")
            break
        for old in ("景品を希望でき", "景品の希望もこちら", "みんなでつくる川", "みんなで作る川"):
            if old in text:
                problems.append(f"{rel}: 古い言い回し「{old}」が残っています")
    rally = read("rally/index.html")
    for needed in ("<h2>お魚を集めよう！</h2>", "<h2>お魚図鑑</h2>", "オリジナルマステプレゼントの申し込みもこちらから"):
        if needed not in rally:
            problems.append(f"rally/index.html に「{needed}」がありません")
    if "仮の説明" in rally or "rules-draft" in rally or "rules-draft" in read("rally/style.css"):
        problems.append("rally/index.html: ルール説明に、「仮の説明です」の注記が、残っています（消す指示です）")
    if "オリジナルマステをゲットできる条件を達成しました！" not in read("survey/app.js"):
        problems.append("survey/app.js: 「オリジナルマステをゲットできる条件を達成しました！」がありません")
    if problems:
        bad("；".join(problems[:8]))
    else:
        ok("文言：お魚の表記・「景品をゲットできる」・川のタイトル（お魚を集めよう！）・オリジナルマステプレゼントの申し込み、が統一され、ルール説明の仮の注記は、ありません")


def check_publish_settings():
    """公開の設定：掲示板の地図を出すか（初期は非公開）・マイマップのURL・開催開始日・開催終了日。SQL・参加者の画面・管理画面が、そろっているか"""
    sql, rally_js, rally_html = read("sql/schema.sql"), read("rally/app.js"), read("rally/index.html")
    admin_js, admin_html, data_js, readme = read("admin/app.js"), read("admin/index.html"), read("js/rally-data.js"), read("README.md")
    problems = []

    # --- SQL ---
    for col in ("places_public boolean not null default false", "mymap_embed_url text", "start_date date", "end_date date", "rally_ongoing boolean not null default false"):
        if f"add column if not exists {col}" not in sql:
            problems.append(f"sql/schema.sql: rally_settings に、列「{col}」がありません（地図は、初期は非公開 = false）")
    config = re.search(r"function public\.rally_config\(\).*?\n\$\$;", sql, flags=re.S)
    cfg = config.group(0) if config else ""
    for needle in ("'places_public'", "'start_date'", "'phase', public.rally_time_phase()", "'open_at', public.rally_open_at()", "'close_at', public.rally_close_at()", "'rally_ongoing', public.rally_time_phase() = 'open'", "case when coalesce(s.places_public, false) then s.mymap_embed_url end"):
        if needle not in cfg:
            problems.append(f"sql/schema.sql: rally_config に「{needle}」がありません（マイマップのURLは、地図を公開している間だけ返します）")
    for fn, sig in (("admin_rally_info", "()"), ("admin_set_rally_info", "(boolean, text, date, boolean, date, boolean)")):
        body = re.search(rf"function public\.{fn}\(.*?\n\$\$;", sql, flags=re.S)
        if not body or "public.is_admin()" not in body.group(0):
            problems.append(f"sql/schema.sql: {fn} に、管理者の確認（is_admin）がありません")
        if f"revoke all on function public.{fn}{sig} from public, anon;" not in sql or f"grant execute on function public.{fn}{sig} to authenticated;" not in sql:
            problems.append(f"sql/schema.sql: {fn} の権限（匿名は実行不可・ログイン済みだけ）の指定がありません")
    setter = re.search(r"function public\.admin_set_rally_info\(.*?\n\$\$;", sql, flags=re.S)
    if not setter or "rally_valid_mymap_url" not in setter.group(0) or "invalid start date" not in setter.group(0):
        problems.append("sql/schema.sql: admin_set_rally_info が、マイマップのURLの形・開催開始日の範囲を、検査していません")
    # 引数が6つになった（開催終了日・自動削除の確認）。引数が少ない旧い関数を残すと、同じ名前の関数が複数になり、呼び出しが曖昧になる
    for old_sig in ("(boolean, text, date)", "(boolean, text, date, boolean)", "(boolean, text, date, boolean, date)"):
        if f"drop function if exists public.admin_set_rally_info{old_sig};" not in sql:
            problems.append(f"sql/schema.sql: 旧い admin_set_rally_info{old_sig} を削除していません（残ると、呼び出しが曖昧になります）")
    if not setter or "p_end_date date default null" not in setter.group(0) or "coalesce(p_end_date, end_date)" not in setter.group(0) or "invalid period" not in setter.group(0) or "invalid end date" not in setter.group(0):
        problems.append("sql/schema.sql: admin_set_rally_info の p_end_date（省略したら、いまの設定のまま・範囲と、開始日との前後の検査）がありません")
    if not setter or "p_confirm_purge boolean default false" not in setter.group(0) or "purge would run" not in setter.group(0):
        problems.append("sql/schema.sql: admin_set_rally_info に、自動削除が、いますぐ動く日付にするときの確認（p_confirm_purge・purge would run）がありません")
    if not setter or "p_rally_ongoing boolean default null" not in setter.group(0):
        problems.append("sql/schema.sql: admin_set_rally_info の p_rally_ongoing（廃止。古い管理画面の呼び出しを受け付けるために、引数だけ残す）がありません")

    # --- マイマップのURLの形：SQL・参加者の画面・管理画面で、同じか ---
    pattern = re.search(r"p_url ~ '([^']+)'", sql)
    forms = {"sql/schema.sql": pattern.group(1) if pattern else None}
    for rel, src in (("rally/app.js", rally_js), ("admin/app.js", admin_js)):
        m = re.search(r"MYMAP_EMBED_OK=/(\^.+?\$)/;", src)
        forms[rel] = m.group(1).replace("\\/", "/") if m else None
    if None in forms.values():
        problems.append("マイマップのURLの形（MYMAP_EMBED_OK / rally_valid_mymap_url）が、" + "・".join(k for k, v in forms.items() if v is None) + " に見つかりません")
    elif len(set(forms.values())) != 1:
        problems.append("マイマップのURLの形（正規表現）が、SQL・参加者の画面・管理画面で、一致していません")

    # --- 参加者の画面 ---
    if not re.search(r'<section[^>]*id="placesCard"[^>]*\bhidden\b', rally_html):
        problems.append("rally/index.html: 「掲示板のある場所」（#placesCard）が、最初から隠されていません（公開するまでは、出してはいけません）")
    if not re.search(r'<h1[^>]*>.*?</h1>\s*(<!--.*?-->\s*)?<p id="startDate"[^>]*\bhidden\b[^>]*>.*?<time id="startDateValue"', rally_html, flags=re.S):
        problems.append("rally/index.html: 開催開始日（#startDate）が、バナー（h1）の下に、最初は隠した状態でありません")
    if "config.places_public===true" not in rally_js or "applyPublicInfo(config)" not in rally_js:
        problems.append("rally/app.js: 地図は、rally_config の places_public が true のときだけ表示する処理（applyPlaces / applyPublicInfo）がありません")
    if re.search(r"^\s*buildPlaces\(\);", rally_js, flags=re.M) or "RALLY_MAP_EMBED_URL" in rally_js or "RALLY_MAP_VIEW_URL" in rally_js:
        problems.append("rally/app.js: 公開の設定に関係なく、地図を作る処理（buildPlaces()・RALLY_MAP_*）が、残っています")
    if "startDateLabel" not in rally_js or "applyStartDate" not in rally_js:
        problems.append("rally/app.js: 開催開始日の表示（applyStartDate）がありません")
    # 「開催中！」「開催は終了しました」：最初は隠れていて、開催の状態（rally_config の phase）が 'open'・'closed' のときだけ出る（開催開始日の代わり）
    if not re.search(r'<p id="ongoing"[^>]*\bhidden\b[^>]*>.*?開催中！</p>', rally_html, flags=re.S):
        problems.append("rally/index.html: 「開催中！」（#ongoing）が、最初は隠した状態でありません")
    if not re.search(r'<p id="ended"[^>]*\bhidden\b[^>]*>開催は終了しました</p>', rally_html):
        problems.append("rally/index.html: 「開催は終了しました」（#ended）が、最初は隠した状態でありません")
    if 'config.phase==="open"' not in rally_js or 'config.phase==="closed"' not in rally_js or "function phaseOf(" not in rally_js or '$("ongoing").hidden=phase!=="open"' not in rally_js or '$("ended").hidden=phase!=="closed"' not in rally_js:
        problems.append("rally/app.js: 「開催中！」「開催は終了しました」は、rally_config の phase（open・closed）のときだけ表示する処理（phaseOf・applyStartDate）がありません")
    if re.search(r"^\s*window\.RALLY_MAP_(VIEW|EMBED)_URL\s*=", data_js, flags=re.M):
        problems.append("js/rally-data.js: マイマップのURLの欄（RALLY_MAP_*）が、残っています（管理画面の「公開の設定」で入力します）")
    if any("RALLY_MAP_" in line and "廃止" not in line for line in readme.splitlines()):
        problems.append("README.md: 廃止した設定（RALLY_MAP_*）が、「廃止した」と書かずに、残っています")

    # --- 管理画面 ---
    for needle in ('href="#publish"', 'id="publishSettings"', 'id="mymapInput"', 'id="startDateInput"', 'id="endDateInput"', 'name="placesPublic"', 'id="publishSave"', 'id="logoutBtnPublish"', "../js/rally-data.js"):
        if needle not in admin_html:
            problems.append(f"admin/index.html に「{needle}」がありません")
    if 'id="ongoingInput"' in admin_html or "infoHasOngoing" in admin_js:
        problems.append("admin: 「開催中！」の手動のチェックが、残っています（開催の期間に連動して、自動で表示する決まりです）")
    for needle in ('admin_rally_info', 'admin_set_rally_info', 'parseMymapInput', 'publish:"publishSettings"', '"logoutBtnPublish"', "infoDirty", "p_end_date", "infoHasEnd", "p_confirm_purge", "purge would run"):
        if needle not in admin_js:
            problems.append(f"admin/app.js に「{needle}」がありません")
    if problems:
        bad("；".join(problems[:8]))
    else:
        ok("公開の設定：地図（初期は非公開・公開のときだけ表示）・マイマップ・開催開始日・開催終了日・開催中！／開催は終了しました（期間に連動）が、SQL（列・関数・権限・URLの形）・スタンプラリー画面・管理画面で、そろっています。マイマップのURLの形も、3か所で同じです")


def sql_func(sql, name):
    """sql/schema.sql から、関数 public.<name>(…) の定義（create の行から、次の「$$;」まで）を取り出す。なければ空の文字列"""
    m = re.search(rf"create (?:or replace )?function public\.{name}\(.*?\n\$\$;", sql, flags=re.S)
    return m.group(0) if m else ""


def check_schedule():
    """開催の期間（開催前・開催中・終了）・30分だけの手動の切り替え・記録の自動削除（保存してから削除）：SQL・スタンプラリー画面・管理画面が、そろっているか"""
    sql, rally_js, rally_html = read("sql/schema.sql"), read("rally/app.js"), read("rally/index.html")
    admin_js, admin_html = read("admin/app.js"), read("admin/index.html")
    problems = []

    # --- SQL：関数・初期の期間・30分 ---
    for fn in ("rally_open_at", "rally_close_at", "rally_purge_at", "rally_time_phase", "rally_scan_phase", "rally_tick", "rally_purge_now", "rally_is_debug_board",
               "admin_rally_schedule", "admin_set_phase_override", "admin_delete_archive"):
        if not sql_func(sql, fn):
            problems.append(f"sql/schema.sql: 関数 {fn} がありません")
    if "date '2026-12-09'" not in sql_func(sql, "rally_open_at") or "date '2026-12-31'" not in sql_func(sql, "rally_close_at"):
        problems.append("sql/schema.sql: 開催期間の初期値（開催開始 2026-12-09・開催終了 2026-12-31）が、rally_open_at・rally_close_at にありません")
    if "+ 1)::timestamp at time zone 'Asia/Tokyo'" not in sql_func(sql, "rally_close_at") or "at time zone 'Asia/Tokyo'" not in sql_func(sql, "rally_open_at"):
        problems.append("sql/schema.sql: 開催終了は、開催終了日の翌日の 0:00（＝23:59:59 まで）・日本時間で計算する決まりです")
    if "interval '1 second'" not in sql_func(sql, "rally_purge_at"):
        problems.append("sql/schema.sql: 記録の自動削除は、開催開始の1秒前（23:59:59）にする決まりです")
    ovr = sql_func(sql, "admin_set_phase_override")
    if "interval '30 minutes'" not in ovr or "public.is_admin()" not in ovr or "phase_override_until" not in ovr:
        problems.append("sql/schema.sql: admin_set_phase_override は、管理者だけが、30分（interval '30 minutes'）の期限つきで切り替える決まりです")
    if "s.phase_override_until > now()" not in sql_func(sql, "rally_scan_phase"):
        problems.append("sql/schema.sql: rally_scan_phase は、手動の切り替えの期限（phase_override_until > now()）を過ぎたら、時刻どおりに戻す決まりです")
    for fn in ("rally_open_at(), public.rally_close_at(), public.rally_purge_at(), public.rally_time_phase(),\n  public.rally_scan_phase(), public.rally_purge_now(), public.rally_tick()",):
        if f"revoke all on function public.{fn} from public, anon, authenticated;" not in sql:
            problems.append("sql/schema.sql: 内部用の関数（rally_open_at・rally_tick など）が、匿名・ログイン済みから、実行できてしまいます（revoke がありません）")
    for fn in ("admin_rally_schedule()", "admin_set_phase_override(text)", "admin_delete_archive(uuid)"):
        if f"revoke all on function public.{fn} from public, anon;" not in sql or f"grant execute on function public.{fn} to authenticated;" not in sql:
            problems.append(f"sql/schema.sql: {fn} の権限（匿名は実行不可・ログイン済みだけ）の指定がありません")
    for fn in ("admin_rally_schedule", "admin_delete_archive"):
        if "public.is_admin()" not in sql_func(sql, fn):
            problems.append(f"sql/schema.sql: {fn} に、管理者の確認（is_admin）がありません")
    # --- SQL：スタンプの受け付け・自動削除を動かす入り口 ---
    scan = sql_func(sql, "record_scan")
    if "public.rally_tick()" not in scan or "public.rally_scan_phase()" not in scan or "'not_open'" not in scan or "'closed'" not in scan or "rally_is_debug_board" not in scan:
        problems.append("sql/schema.sql: record_scan が、開催の期間（rally_scan_phase・not_open・closed）・自動削除の確認（rally_tick）・デバッグ用の掲示板の除外を、そろえて行っていません")
    elif scan.index("rally_scan_phase()") > scan.index("from public.stamp_boards b where b.code"):
        problems.append("sql/schema.sql: record_scan は、QRコードが正しいかを確かめる前に、開催の期間を確かめる決まりです（期間の外では、いつでも同じ説明を出す）")
    for fn in ("rally_config", "rally_reset_state", "admin_stats", "admin_rally_schedule", "sheets_version", "sheets_export"):
        if "perform public.rally_tick();" not in sql_func(sql, fn):
            problems.append(f"sql/schema.sql: {fn} が、自動削除の時刻の確認（perform public.rally_tick();）をしていません")
    tick = sql_func(sql, "rally_tick")
    if "exception when others then" not in tick or "purge_error" not in tick or "interval '10 minutes'" not in tick:
        problems.append("sql/schema.sql: rally_tick は、自動削除が失敗しても呼び出し元を止めない（exception when others）・理由を残す（purge_error）・10分あけてやり直す決まりです")
    purge = sql_func(sql, "rally_purge_now")
    ins, dele = purge.find("insert into public.rally_archive"), purge.find("delete from public.scan_events")
    if ins < 0 or dele < 0 or ins > dele:
        problems.append("sql/schema.sql: rally_purge_now は、削除する前に、rally_archive に保存する決まりです（保存→削除の順）")
    for table in ("scan_events", "stamp_claims", "survey_responses", "prize_shipping", "excluded_participants"):
        if f"'{table}'" not in purge:
            problems.append(f"sql/schema.sql: rally_purge_now が、{table} を、保存していません")
    for needle in ("for update", "purged_at is not null", "participant_resets", "last_full_reset_count", "v_before"):
        if needle not in purge:
            problems.append(f"sql/schema.sql: rally_purge_now に「{needle}」がありません（二重実行の防止・端末が記録を消す印・開催開始より前だけを削除）")
    for needle in ("alter table public.rally_archive enable row level security;", 'create policy "rally_archive_admin_select" on public.rally_archive'):
        if needle not in sql:
            problems.append(f"sql/schema.sql: 保存した記録（rally_archive）が、管理者だけが読める設定（{needle}）になっていません")
    if re.search(r"grant\s+[^;]*rally_archive[^;]*to\s+[^;]*\banon\b", sql):
        problems.append("sql/schema.sql: rally_archive が、匿名に公開されています")

    # --- 開催の期間の初期値：SQL・スタンプラリー画面・管理画面で同じ ---
    if 'const DEFAULT_OPEN="2026-12-09T00:00:00+09:00", DEFAULT_CLOSE="2027-01-01T00:00:00+09:00";' not in rally_js:
        problems.append("rally/app.js: 開催期間の初期値（DEFAULT_OPEN・DEFAULT_CLOSE）が、SQLの初期値（2026-12-09 0:00・2027-01-01 0:00）と違います")
    if 'const DEFAULT_START="2026-12-09",DEFAULT_END="2026-12-31";' not in admin_js:
        problems.append("admin/app.js: 開催期間の初期値（DEFAULT_START・DEFAULT_END）が、SQLの初期値と違います")

    # --- スタンプラリー画面：期間の外のお知らせ ---
    for needle in ('result.status==="not_open"||result.status==="closed"', "showPhase(", "function phaseCopy(", 'previewKinds={before:"before",ended:"closed"}', "opens_at", "closes_at", "forced"):
        if needle not in rally_js:
            problems.append(f"rally/app.js に「{needle}」がありません（開催前・終了のお知らせ）")
    if 'status==="not_open"||result.status==="closed"){ removeLocalStamp(code)' not in rally_js:
        problems.append("rally/app.js: 未送信のスタンプを再送して、開催の期間の外だったときに、端末のスタンプを取り除く処理（resendPending）がありません")
    for needle in ('id="phaseDialog"', 'id="phaseTitle"', 'id="phaseLead"', 'id="phaseNote"', 'id="phasePreview"', 'id="phaseOk"', 'id="phaseX"', "開催まで待ってね"):
        if needle not in rally_html:
            problems.append(f"rally/index.html に「{needle}」がありません")
    copy = re.search(r"function phaseCopy\(.*?\n\}", rally_js, flags=re.S)
    for word in ("開催まで待ってね", "開催終了しました", "ありがとう", "COMING SOON", "THANK YOU"):
        if not copy or word not in copy.group(0):
            problems.append(f"rally/app.js の phaseCopy に「{word}」がありません")
    if "phaseDialog" not in re.search(r"const otherDialogs=.*", rally_js).group(0):
        problems.append("rally/app.js: otherDialogs に phaseDialog がありません（お知らせと、ほかのポップアップが、重なって開いてしまいます）")

    # --- 管理画面：開催の状態の画面 ---
    for needle in ('href="#schedule"', 'id="scheduleSettings"', 'id="phaseBefore"', 'id="phaseOpen"', 'id="phaseClosed"', 'id="phaseAuto"', 'id="overrideLeft"', 'id="backupNow"', 'id="archiveBody"', 'id="logoutBtnSchedule"',
                   'href="../rally/?preview=before"', 'href="../rally/?preview=ended"', 'id="purgeDialog"', "30分"):
        if needle not in admin_html:
            problems.append(f"admin/index.html に「{needle}」がありません")
    for needle in ('schedule:"scheduleSettings"', "admin_rally_schedule", "admin_set_phase_override", "admin_delete_archive", "makeZip", "crc32", "BACKUP_COLUMNS", "rally_archive", "serverNow"):
        if needle not in admin_js:
            problems.append(f"admin/app.js に「{needle}」がありません")
    if problems:
        bad("；".join(problems[:8]))
    else:
        ok("開催の期間：SQL（期間・30分の手動の切り替え・保存してから削除・失敗しても止まらない・権限）と、スタンプラリー画面（開催前・終了のお知らせ・プレビュー）・管理画面（切り替え・自動削除の状況・CSV保存）が、そろっています")


def check_debug_boards():
    """デバッグ用の掲示板（No.61〜70）：サーバーに登録せず、端末の中だけで扱う。コードそのものは公開しない（計算した値だけ）"""
    sql, rally_js, rally_html = read("sql/schema.sql"), read("rally/app.js"), read("rally/index.html")
    mk, dbg = read("scripts/make_boards.py"), read("js/debug-boards.js")
    problems = []
    first = re.search(r"DEBUG_FIRST, DEBUG_LAST = (\d+), (\d+)", mk)
    lo, hi = (int(first.group(1)), int(first.group(2))) if first else (0, 0)
    sql_range = re.search(r"select p_board_no between (\d+) and (\d+);", sql_func(sql, "rally_is_debug_board"))
    if not first or not sql_range or (lo, hi) != (int(sql_range.group(1)), int(sql_range.group(2))) or (lo, hi) != (61, 70):
        problems.append(f"デバッグ用の掲示板の範囲が、scripts/make_boards.py と sql/schema.sql で一致していません（61〜70 の決まりです）")
    entries = re.findall(r'"([0-9a-f]+)":\s*(\d+)', dbg)
    if len(entries) != 10 or [int(n) for _, n in entries] != list(range(61, 71)) or any(len(h) != 64 for h, _ in entries) or len({h for h, _ in entries}) != 10:
        problems.append("js/debug-boards.js: デバッグ用の掲示板 No.61〜70 の10個の値（64桁の16進数・重複なし）が、そろっていません")
    salt, it = re.search(r'salt:"([^"]+)"', dbg), re.search(r"iterations:(\d+)", dbg)
    if not salt or not it or f'DEBUG_SALT = "{salt.group(1)}"' not in mk or f"DEBUG_ITERATIONS = {it.group(1)}" not in mk:
        problems.append("js/debug-boards.js の salt・iterations が、scripts/make_boards.py と違います")
    if "PBKDF2" not in rally_js or "cfg.salt" not in rally_js or "cfg.iterations" not in rally_js or "RALLY_DEBUG_BOARDS" not in rally_js:
        problems.append("rally/app.js: デバッグ用のQRコードの見分け方（debugBoardNo：PBKDF2・salt・iterations）がありません")
    if "../js/debug-boards.js" not in rally_html or rally_html.index("debug-boards.js") > rally_html.index('src="app.js'):
        problems.append("rally/index.html: js/debug-boards.js を、app.js より前に読み込んでいません")
    # 本物のコードは、どのファイルにも入れない。デバッグ用のQRコードは、サーバーに問い合わせず、端末の中だけで扱う
    for needle in ('const debugKey = "stamp_rally_debug"', 'stamp_rally_debug_stamps', "const serverOn=()=>isSupabaseConfigured()&&!debugOn", "if(!serverOn()){", "function enterDebug(", "async function runDebug(", 'id="debugBar"', 'id="debugEnd"'):
        if needle not in rally_js and needle not in rally_html:
            problems.append(f"rally/app.js・index.html に「{needle}」がありません（デバッグモード）")
    for fn in ("syncReset", "restoreCompletion"):
        m = re.search(rf"async function {fn}\(.*?\n\{{?\n?\s*if\(!serverOn\(\)\) return", rally_js, flags=re.S)
        if not m:
            problems.append(f"rally/app.js: {fn} が、デバッグモードのとき（serverOn が false）、サーバーと通信しない作りになっていません")
    run = re.search(r"async function runDebug\(.*?\n\}\n", rally_js, flags=re.S)
    if not run or "callRpc" in run.group(0) or "recordServerScan" in run.group(0) or "fetch(" in run.group(0):
        problems.append("rally/app.js: runDebug（デバッグ用QRコードの動作）が、サーバーと通信しています（デバッグ用は、何も記録しない決まりです）")
    if 'safeGet("stamp_rally_debug")==="1"' not in read("survey/app.js") or "previewMode=true" not in read("survey/app.js"):
        problems.append("survey/app.js: デバッグモードのとき、アンケートは、送信しても記録しない画面（プレビューと同じ）になっていません")
    # 画像の作成・登録SQL：デバッグ用は、登録しない
    if "def is_debug(" not in mk or "not is_debug(n)" not in mk or "write_debug_js" not in mk:
        problems.append("scripts/make_boards.py: 登録のSQLから、デバッグ用の掲示板を外す処理（is_debug）・js/debug-boards.js の書き出しがありません")
    # 手元に qr/boards/boards.csv があるときは、js/debug-boards.js が、そのコードから作った値と一致するか・登録のSQLにデバッグ用が入っていないか
    csv_path = os.path.join(ROOT, "qr", "boards", "boards.csv")
    if os.path.isfile(csv_path) and salt and it and len(entries) == 10:
        import csv as _csv, hashlib as _hl
        with open(csv_path, encoding="utf-8", newline="") as f:
            codes = {int(r["board_no"]): r["code"].strip() for r in _csv.DictReader(f)}
        want = {n: _hl.pbkdf2_hmac("sha256", codes[n].encode(), salt.group(1).encode(), int(it.group(1)), 32).hex() for n in range(61, 71) if n in codes}
        got = {int(n): h for h, n in entries}
        if want != got:
            problems.append("js/debug-boards.js が、qr/boards/boards.csv の No.61〜70 のコードから作った値と、違います（python3 scripts/make_boards.py --seed-only で作り直してください）")
        seed_path = os.path.join(ROOT, "qr", "boards", "boards_seed.sql")
        if os.path.isfile(seed_path):
            seed = open(seed_path, encoding="utf-8").read()
            leaked = [n for n in range(61, 71) if n in codes and f"'{codes[n]}'" in seed]
            if leaked:
                problems.append(f"qr/boards/boards_seed.sql に、デバッグ用の掲示板 {leaked} が、入っています（登録しない決まりです。python3 scripts/make_boards.py --seed-only で作り直してください）")
    if problems:
        bad("；".join(problems[:8]))
    else:
        ok("デバッグ用の掲示板 No.61〜70：SQLでは登録せず・record_scan も受け付けず、画面は端末の中だけで扱います（サーバーとは通信しない・本物の記録と別の保存先）。QRコードの合言葉そのものは公開せず、計算した値（10個）だけを持っています")


def check_survey_questions():
    """アンケートの新しい質問（楽しかったか・はい／いいえの3問・きっかけ・ご意見）と、ルール①のポスターの見本の画像"""
    raw_html, js, sql = read("survey/index.html"), read("survey/app.js"), read("sql/schema.sql")
    html = re.sub(r"</?span[^>]*>", "", raw_html)   # 文節ごとの <span class="ph"> を除いた、文言（質問は、文節ごとに分けてある）
    admin_html, admin_js, gas, rally_html = read("admin/index.html"), read("admin/app.js"), read("gas/sheets-sync.gs"), read("rally/index.html")
    problems = []
    if "今回のスタンプラリーは楽しかったですか？" not in html or "満足度" in html or "自由記述" in html.replace("自由記述の質問", ""):
        problems.append("survey/index.html: 「今回のスタンプラリーは楽しかったですか？」への変更（「満足度」「自由記述」の表記は残さない）が、そろっていません")
    for name, q in (("visitedNewPlace", "普段行かない場所に足を運びましたか？"), ("checksBoards", "普段掲示板を見ることはありますか？"), ("sawOtherNotices", "このスタンプラリーをきっかけにすきまキッズラボ以外の掲示物も見ましたか？")):
        if q not in html or f'name="{name}" value="yes" required' not in html or f'name="{name}" value="no"' not in html:
            problems.append(f"survey/index.html: 「{q}」（はい／いいえ・必須）がありません")
    if 'id="motivationBlock"' not in html or "すきまキッズラボに参加していない方へ" not in html or "スタンプラリーをしようと思ったきっかけを教えてください" not in html or 'id="motivation"' not in html:
        problems.append("survey/index.html: 「すきまキッズラボに参加していない方へ」のきっかけの質問がありません")
    if "その他ご意見・ご感想があればご記入ください" not in html:
        problems.append("survey/index.html: 「その他ご意見・ご感想があればご記入ください」がありません")
    if 'not_attended' not in js or "syncMotivation" not in js or "motivationBlock.hidden" not in js:
        problems.append("survey/app.js: きっかけの質問を、ワークショップに「参加していない」と答えたときだけ出す処理（syncMotivation）がありません")
    for needle in ("p_visited_new_place", "p_checks_boards", "p_saw_other_notices", "p_motivation", "isMissingFunction", "invalid_motivation"):
        if needle not in js:
            problems.append(f"survey/app.js に「{needle}」がありません")
    fn = re.search(r"create or replace function public\.submit_survey\((.*?)\)\s*returns text", sql, flags=re.S)
    for needle in ("p_visited_new_place boolean default null", "p_checks_boards boolean default null", "p_saw_other_notices boolean default null", "p_motivation text default null"):
        if not fn or needle not in fn.group(1):
            problems.append(f"sql/schema.sql: submit_survey に「{needle}」がありません（省略できる引数にして、旧い画面からの回答も受け付ける）")
    for col in ("visited_new_place boolean", "checks_boards boolean", "saw_other_notices boolean", "motivation text"):
        if f"add column if not exists {col}" not in sql:
            problems.append(f"sql/schema.sql: survey_responses に、列「{col}」がありません")
    if "invalid_motivation" not in sql or "'survey_yesno'" not in sql or "'visited_new_place', case r.visited_new_place" not in sql or "楽しかった度（1〜5）" not in sql:
        problems.append("sql/schema.sql: きっかけの検査（invalid_motivation）・はい／いいえの集計（survey_yesno）・スプレッドシート用のデータ・日本語ビューに、新しい質問が、そろっていません")
    for needle in ("yesNoBody", "visited_new_place", "checks_boards", "saw_other_notices", "motivation", "楽しかった度"):
        if needle not in admin_js and needle not in admin_html:
            problems.append(f"admin に「{needle}」がありません（新しい質問の表示・CSV）")
    if "満足度" in admin_html or "満足度" in admin_js:
        problems.append("admin: 「満足度」の表記が残っています（「楽しかった度」にそろえる）")
    for needle in ("'visited_new_place'", "'checks_boards'", "'saw_other_notices'", "'motivation'", "survey_yesno", "楽しかった度"):
        if needle not in gas:
            problems.append(f"gas/sheets-sync.gs に「{needle}」がありません（スプレッドシートの列・集計）")
    if "満足度" in gas:
        problems.append("gas/sheets-sync.gs: 「満足度」の表記が残っています")
    # ルール①：ポスターの見本の画像
    step = re.search(r'<ol class="rules-steps".*?<li>(.*?)</li>', rally_html, flags=re.S)
    img = re.search(r'<img src="\.\./assets/rules-poster-sample\.webp"[^>]*>', step.group(1)) if step else None
    if not img or not re.search(r'\bwidth="\d+"', img.group(0)) or not re.search(r'\bheight="\d+"', img.group(0)) or 'alt="掲示板に貼り出されるポスターのイメージ' not in img.group(0) or "掲示板のQRコードを読み取る" not in step.group(1):
        problems.append("rally/index.html: ルール①（掲示板のQRコードを読み取る）に、ポスターの見本の画像（width・height・alt つき）がありません")
    if not os.path.isfile(os.path.join(ROOT, "assets", "rules-poster-sample.webp")):
        problems.append("assets/rules-poster-sample.webp がありません")
    # 画像そのものが吹き出しの枠線を持つので、角は丸めない（丸めると、枠線の角が見切れる）
    sample_css = re.search(r"\.rules-sample img\{([^}]*)\}", read("rally/style.css"))
    if not sample_css or "border-radius" in sample_css.group(1) or "overflow" in sample_css.group(1) or "object-fit" in sample_css.group(1):
        problems.append("rally/style.css: ルール①の見本の画像（.rules-sample img）に、角の丸め・はみ出しの切り取り（border-radius・overflow・object-fit）があります（画像の枠線が見切れます）")
    # 読点（、）は、最小限にする：開催前・終了のお知らせ（phaseCopy）・ルール説明（4つの手順）・メッセージの文は、読点を付けない
    app_js = read("rally/app.js")
    pc = re.search(r"function phaseCopy\(.*?\n\}\n", app_js, flags=re.S)
    if not pc or "、" in re.sub(r"//[^\n]*", "", pc.group(0)):
        problems.append("rally/app.js: 開催前・終了のお知らせ（phaseCopy）の文に、読点（、）があります（読点は付けない：「それまではスタンプをゲットできません。」）")
    steps_html = re.search(r'<ol class="rules-steps".*?</ol>', rally_html, flags=re.S)
    steps_text = re.sub(r'alt="[^"]*"', "", steps_html.group(0)) if steps_html else "、"
    if "、" in re.sub(r"<[^>]*>", "", steps_text):
        problems.append("rally/index.html: ルール説明の4つの手順に、読点（、）があります（読点は付けない）")
    if problems:
        bad("；".join(problems[:8]))
    else:
        ok("アンケート：楽しかったか（1〜5）・はい／いいえの3問・きっかけ（参加していない方だけ）・ご意見が、画面→SQL（引数・列・集計・ビュー）→管理画面→スプレッドシートまで、そろっています。ルール①には、ポスターの見本の画像があります（角は丸めない）。開催前・終了のお知らせとルールの手順に、読点はありません")


def check_plain_wrapping():
    """日本語の折り返し：ブラウザの標準の折り返しに任せる（文章の中に、折り返す位置を入れる仕組みを、置かない）"""
    problems = []
    for rel in ("js/phrase-break.js", "js/vendor/budoux-ja-model.js"):
        if os.path.exists(os.path.join(ROOT, rel)):
            problems.append(f"{rel} が残っています（文節の区切りを、文章に入れる仕組みは、やめました）")
    stripped_css = {}
    for rel in ("brand.css", "style.css", "prize.css", "rally/style.css", "survey/style.css", "reset/style.css", "admin/style.css"):
        stripped_css[rel] = re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S)
    for rel, css in stripped_css.items():
        m = re.search(r"text-wrap\s*:\s*(pretty|balance|stable)", css)
        if m:
            problems.append(f"{rel}: text-wrap:{m.group(1)} が使われています。日本語の文章には使わない決まりです（端末によって、文節の途中・かっこの直後で折り返す崩れが出うるため）")
        if re.search(r"word-break\s*:\s*keep-all", css):
            problems.append(f"{rel}: word-break:keep-all が使われています（日本語の文章が、折り返せなくなるため。使うのは auto-phrase まで）")
        if "[data-pb]" in css:
            problems.append(f"{rel}: [data-pb]（文節の区切りの仕組みの印）が残っています")
    for rel in PUBLIC_PAGES + ["admin/index.html"]:
        src = read(rel)
        if re.search(r"phrase-break|budoux", src, flags=re.I):
            problems.append(f"{rel}: 文節の区切りの仕組み（phrase-break・BudouX）の読み込みが残っています")
        if "<wbr" in src:
            problems.append(f"{rel}: <wbr>（折り返し位置の指定）が、書かれています")
    for rel in ("js/app.js", "rally/app.js", "survey/app.js", "js/prize-info.js", "js/site-nav.js", "js/reveal.js"):
        if os.path.exists(os.path.join(ROOT, rel)) and re.search(r"createElement\(.wbr.\)|data-pb", read(rel)):
            problems.append(f"{rel}: 文章に、折り返し位置を入れる処理が、書かれています")
    if problems:
        bad("；".join(problems[:6]))
    else:
        ok("日本語の折り返しは、ブラウザの標準に任せています（<wbr>・文節の区切りの仕組み・text-wrap・keep-all は、使っていません）。見出しの「かたまり」は、CSSだけの .ph（inline-block）です")


def check_centered_heads():
    """トップページ・アンケートのページの頭（バナー・見出し・見出しの下の線）：左右の中央。スタンプラリーの画面（rally/）と同じ"""
    brand, top, survey = read("brand.css"), read("style.css"), read("survey/style.css")
    problems = []
    if not re.search(r"\.hero-banner\{[^}]*margin:0 auto var\(--space-3\)", brand):
        problems.append("brand.css: バナー（.hero-banner）が、左右の中央（margin: 0 auto …）になっていません")
    if not re.search(r"\.hero\{[^}]*text-align:center", top) or not re.search(r"\.hero \.page-title:after\{[^}]*margin-left:auto;margin-right:auto", top):
        problems.append("style.css: トップページの頭（.hero）の文字・見出しの下の線が、中央になっていません（text-align:center・.hero .page-title:after の margin-left / margin-right:auto）")
    if not re.search(r"\.page-head\{[^}]*text-align:center", survey) or not re.search(r"\.page-head \.page-title:after\{[^}]*margin-left:auto;margin-right:auto", survey):
        problems.append("survey/style.css: アンケートの頭（.page-head）の文字・見出しの下の線が、中央になっていません")
    if "back-center" not in read("survey/index.html") or ".back-center{text-align:center}" not in survey:
        problems.append("survey/: 「スタンプラリーに戻る」（.back-center）が、中央になっていません")
    if problems:
        bad("；".join(problems))
    else:
        ok("トップページ・アンケート：バナー・見出し・見出しの下の線（と、アンケートの説明文・「スタンプラリーに戻る」）が、左右の中央にそろっています")


def check_sources_ignored():
    for folder in ("fish-stamp-images", "logo-banner-images", "about-images", "prize-images"):
        tracked = subprocess.run(["git", "ls-files", folder], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if tracked:
            warn(f"{folder}/ の元の画像が、すでにGitに登録されています（公開サイトが重くなります。git rm -r --cached {folder} で外してください）")
            continue
        if not os.path.isdir(os.path.join(ROOT, folder)):
            ok(f"{folder}/ は、このパソコンにありません（変換済みの画像 assets/ だけで、サイトは動きます）")
            continue
        ignored = subprocess.run(["git", "check-ignore", "-q", folder + "/x.png"], cwd=ROOT).returncode == 0
        (ok if ignored else warn)(f"{folder}/（元の画像）は、GitHubに送られない設定です" if ignored else f"{folder}/ が .gitignore に入っていません（元の画像が、そのまま公開されてしまいます）")


def tracked_or_public_files():
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f and os.path.isfile(os.path.join(ROOT, f))]


def check_board_secrets():
    ignored = subprocess.run(["git", "check-ignore", "-q", "qr/boards/boards.csv"], cwd=ROOT).returncode == 0
    (ok if ignored else bad)("qr/boards/ は、GitHubに送られない設定（.gitignore）です" if ignored else "qr/boards/ が .gitignore に入っていません（掲示板のコードが公開されてしまいます）")
    tracked = subprocess.run(["git", "ls-files", "qr/boards"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if tracked:
        bad(f"qr/boards/ のファイルが、すでにGitに登録されています：{tracked.splitlines()[:3]}（git rm --cached で外してください）")
    priv_ignored = subprocess.run(["git", "check-ignore", "-q", "private/x.xlsx"], cwd=ROOT).returncode == 0
    (ok if priv_ignored else bad)("private/（コード一覧のスプレッドシートの置き場）は、GitHubに送られない設定です" if priv_ignored else "private/ が .gitignore に入っていません（コード一覧が公開されてしまいます）")
    priv_tracked = subprocess.run(["git", "ls-files", "private"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if priv_tracked:
        bad(f"private/ のファイルが、すでにGitに登録されています：{priv_tracked.splitlines()[:3]}（git rm --cached で外してください）")
    csv_path = os.path.join(ROOT, "qr", "boards", "boards.csv")
    if not os.path.exists(csv_path):
        warn("qr/boards/boards.csv がありません（掲示板のQRコードを、まだ作っていません。scripts/make_boards.py を実行してください）")
        return
    with open(csv_path, encoding="utf-8") as f:
        codes = [line.split(",")[1] for line in f.read().splitlines()[1:] if line.count(",") >= 1]
    leaked = []
    for rel in tracked_or_public_files():
        if rel.startswith("qr/boards/") or rel.endswith((".png", ".jpg", ".pdf", ".ico", ".woff2")):
            continue
        try:
            text = read(rel)
        except (UnicodeDecodeError, OSError):
            continue
        leaked += [f"{rel}" for c in codes if c and c in text]
    (bad if leaked else ok)(f"掲示板のコードが、公開されるファイルに含まれています：{sorted(set(leaked))}" if leaked else f"掲示板のコード（{len(codes)} 個）は、公開されるファイルに含まれていません")


def check_hooks():
    path = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if path == ".githooks" and os.access(os.path.join(ROOT, ".githooks", "pre-commit"), os.X_OK):
        ok("コミットのたびに、CSS・JavaScriptの版（?v=…）が自動で更新される設定です（.githooks）")
    else:
        warn("コミット時の版の自動更新が、このパソコンでは無効です（git config core.hooksPath .githooks を1回実行してください）")


def check_legacy():
    words = re.compile(r"STAMP_KEYS|icon-river|icon-bridge|川の入口|みんなで川|memorableSpot|importMigration|IWAMOTOCHO")
    hits = []
    for rel in files(".html") + files(".js") + files(".css"):
        for i, line in enumerate(read(rel).splitlines(), 1):
            m = words.search(line)
            if m:
                hits.append(f"{rel}:{i}（{m.group(0)}）")
    (bad if hits else ok)(f"旧仕様の記述が残っています：{hits[:8]}" if hits else "旧仕様（6か所の名前付きスタンプ・川の図・引き継ぎ）の記述は残っていません")


def main():
    pages = {rel: parse(rel) for rel in files(".html")}

    print("1. HTMLの構造")
    for rel, p in pages.items():
        if p.dups:
            bad(f"{rel}: 同じIDが重複しています：{sorted(set(p.dups))}")
        for e in p.errors[:5]:
            bad(f"{rel}: {e}")
        if not p.dups and not p.errors:
            ok(f"{rel}: 構造に問題なし（ID {len(p.ids)} 個）")

    print("2. JavaScript が参照するIDが、HTMLにあるか")
    id_ref = [re.compile(r'(?<![\w.])document\.getElementById\(\s*["\']([\w-]+)["\']'), re.compile(r'(?<![\w.])\$\(\s*["\']([\w-]+)["\']\s*\)'), re.compile(r'querySelector\(\s*["\']#([\w-]+)')]
    for rel, p in pages.items():
        base = os.path.dirname(rel)
        scripts = [os.path.normpath(os.path.join(base, a.split("?")[0])) for a in p.assets if a.split("?")[0].endswith(".js") and not a.startswith("http")]
        missing = {}
        for js in scripts:
            src = read(js)
            for rx in id_ref:
                for m in rx.finditer(src):
                    if m.group(1) not in p.ids:
                        missing.setdefault(m.group(1), js)
        if missing:
            for i, js in missing.items():
                bad(f"{rel}: {js} が参照する id=\"{i}\" が、このページにありません")
        else:
            ok(f"{rel}: 参照するIDはすべてあります（{', '.join(os.path.basename(s) for s in scripts) or 'JSなし'}）")

    print("3. 読み込むファイル・リンク先が存在するか")
    allowed_external = ("https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/", INSTAGRAM_URL)
    for rel, p in pages.items():
        base, miss = os.path.dirname(rel), []
        for ref in p.assets + p.links:
            clean = ref.split("#")[0].split("?")[0]
            if not clean or ref.startswith(("mailto:", "tel:", "javascript:", "data:")):
                continue
            if clean.startswith(("http://", "https://", "//")):
                if ref.startswith("http") and not ref.startswith(allowed_external) and not ref.startswith("https://www.google.com/maps"):
                    warn(f"{rel}: 外部のURL {ref[:70]} を読み込んでいます（意図したものか確認してください）")
                continue
            target = os.path.normpath(os.path.join(ROOT, base, clean))
            if os.path.isdir(target):
                target = os.path.join(target, "index.html")
            if not os.path.isfile(target):
                miss.append(ref)
        for m in miss:
            bad(f"{rel}: {m} が見つかりません")
        if not miss:
            ok(f"{rel}: 参照先はすべて存在します")

    print("4. CSS変数")
    css_files = files(".css")
    defined_global = set(re.findall(r"(--[\w-]+)\s*:", read("brand.css")))
    for rel in css_files:
        src = read(rel)
        defined = defined_global | set(re.findall(r"(--[\w-]+)\s*:", src))
        undefined = sorted({v for v in re.findall(r"var\(\s*(--[\w-]+)", src) if v not in defined})
        if undefined:
            bad(f"{rel}: 定義されていないCSS変数を使っています：{undefined}")
        else:
            ok(f"{rel}: 使っているCSS変数はすべて定義済み")

    print("5. 色（ブランドカラー以外が使われていないか）")
    for rel in css_files:
        src = re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S)
        found = {h.lower() for h in re.findall(r"#[0-9a-fA-F]{3,8}\b", src)} | {"#" + h.lower() for h in re.findall(r"%23([0-9a-fA-F]{6})", src)}
        allowed = BRAND_COLORS | TINTS | (ADMIN_ERROR if rel.startswith("admin") else set())
        strange = sorted(found - allowed)
        rgbs = {tuple(int(x) for x in m.groups()) for m in re.finditer(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", src)}
        strange_rgb = sorted(rgbs - RGB_OK)
        names = set(re.findall(r"(?<![-\w#])(red|blue|green|orange|purple|yellow|pink|black|gray|grey)(?![-\w])", src))
        if strange or strange_rgb or names:
            bad(f"{rel}: ブランドカラー以外の色：{strange + [str(t) for t in strange_rgb] + sorted(names)}")
        else:
            ok(f"{rel}: 色はブランドカラー（と、その淡い色）だけ")
    for rel in css_files:
        if rel != "brand.css":
            hexes = re.findall(r"#[0-9a-fA-F]{3,8}\b", re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S))
            direct = [h for h in hexes if not (rel.startswith("admin") and h.lower() in ADMIN_ERROR)]
            if direct:
                warn(f"{rel}: 色を直接書いています {sorted(set(direct))}（brand.css の変数を使うほうが、あとで一括変更できます）")

    print("6. フォント")
    fonts = [f for f in subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n") if re.search(r"\.(woff2?|ttf|otf|ttc|eot)$", f, re.I)]
    if fonts:
        bad(f"フォントファイルがリポジトリに含まれています（有料フォントは含めない決まりです）：{fonts}")
    else:
        ok("フォントファイルは、リポジトリに含まれていません")
    for rel in css_files:
        if rel == "brand.css":
            continue
        decl = re.findall(r"font-family\s*:\s*([^;}]+)", re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S))
        direct = [d.strip() for d in decl if "var(--font" not in d and d.strip() != "inherit"]
        if direct:
            bad(f"{rel}: フォント指定が brand.css の変数を使っていません：{direct}")
    ok("各CSSのフォント指定は、brand.css の変数を使っています") if not any("フォント指定が" in f for f in failures) else None

    print("7. hidden属性")
    if re.search(r"\[hidden\]\s*\{\s*display\s*:\s*none\s*!important", read("brand.css")):
        ok("brand.css: hidden属性で隠した要素は、他のCSSに負けず、必ず隠れます")
    else:
        bad("brand.css に [hidden]{display:none!important} がありません（表示の切り替えが、CSSの読み込み状態に左右されます）")
    for rel in ("rally/index.html",):
        src = read(rel)
        if 'class="done-wrap" hidden' in src:
            ok(f"{rel}: 「COMPLETE」の表示は、最初は hidden です")
        else:
            bad(f"{rel}: 「COMPLETE」の表示が、最初から見える状態です")

    print("8. ファイルの版（?v=…）")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "stamp_assets.py"), "--check"], capture_output=True, text=True)
    (ok if r.returncode == 0 else bad)(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "版の確認に失敗しました")

    print("9. JavaScript・秘密鍵・接続設定")
    node = shutil.which("node") or os.path.expanduser("~/.codegpt/bin/node")
    for rel in files(".js") + ["gas/sheets-sync.gs"]:
        if rel.startswith("scripts"):
            continue
        if os.path.exists(node):
            tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".syntax_check.js")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(read(rel))
            res = subprocess.run([node, "--check", tmp], capture_output=True, text=True)
            os.remove(tmp)
            (ok if res.returncode == 0 else bad)(f"{rel}: 文法" + ("に問題なし" if res.returncode == 0 else f" エラー：{res.stderr.strip().splitlines()[-1][:100]}"))
    secret = [rel for rel in files(".js") + files(".html") + files(".css") + ["gas/sheets-sync.gs"] if re.search(r"sb_secret|eyJhbGci", read(rel)) or re.search(r"service_role\s*[=:]\s*[\"']", read(rel))]
    (bad if secret else ok)(f"秘密鍵らしき文字列：{secret}" if secret else "秘密鍵（service_role / secret key）は含まれていません")
    diff = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "js/config.js"], cwd=ROOT)
    (ok if diff.returncode == 0 else bad)("js/config.js は、変更されていません" if diff.returncode == 0 else "js/config.js が変更されています（Supabaseの接続設定は変更しない決まりです）")

    print("10. 共通ヘッダー（ロゴ・メニュー）")
    check_header()

    print("11. 景品をゲットできる条件（スタンプの個数）")
    check_required()

    print("12. 掲示板のQRコードの文字列が、公開されるファイルに含まれていないか")
    check_board_secrets()
    check_hooks()

    print("13. 旧仕様（6か所の名前付きスタンプ）の記述")
    check_legacy()

    print("14. 魚の図鑑（画像・名前・順番）")
    check_fish()

    print("15. 元の画像のフォルダ")
    check_sources_ignored()

    print("16. 参加者のスタンプのリセット")
    check_reset()

    print("17. バナー・獲得の演出・ルール説明")
    check_popups()

    print("18. トップページの紹介文・画像・スクロールで現れる動き")
    check_story()

    print("19. アンケート・プライバシー規約・フッター")
    check_policy()

    print("20. メールアドレス（アンケート → SQL → 管理画面）")
    check_email()

    print("21. 管理画面の一括操作（選んで、まとめて除外・リセット・アンケートの削除）")
    check_bulk()

    print("22. この端末の履歴の完全リセット（reset/）")
    check_device_reset()

    print("23. 管理画面の完全リセットと、アンケート削除後の答え直し")
    check_full_reset()

    print("24. 「？ 景品について」のポップアップ")
    check_prize_info()

    print("25. コンプリートのときの、川の左上のバナー・日時・完成画像の保存")
    check_complete_image()

    print("26. ハンバーガーのメニューとポップアップの関係")
    check_menu_dialog()

    print("27. 個人情報（発送先）を、スプレッドシートに同期しない")
    check_no_personal_sync()

    print("28. 文言の統一")
    check_wording()

    print("29. 公開の設定（掲示板の地図を出すか・マイマップ・開催開始日・開催終了日）")
    check_publish_settings()

    print("30. 日本語の折り返しは、ブラウザの標準に任せる（文節の区切りを入れる仕組み・text-wrap・keep-all は使わない）")
    check_plain_wrapping()

    print("31. トップページ・アンケートの、バナー・見出しの中央揃え")
    check_centered_heads()

    print("32. 開催の期間（開催前・開催中・終了）・30分の手動の切り替え・記録の自動削除")
    check_schedule()

    print("33. デバッグ用のQRコード（掲示板 No.61〜70）")
    check_debug_boards()

    print("34. アンケートの新しい質問・ルール①のポスターの見本")
    check_survey_questions()

    print()
    print(f"結果：{len(failures)} 件の問題、{len(warnings)} 件の注意")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
