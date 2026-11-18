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
 11. 景品を希望できる条件（スタンプの個数）が、JavaScript・SQL・HTMLで同じか
 12. 掲示板のQRコードの文字列（合言葉）が、公開されるファイルに含まれていないか
 13. 旧仕様（6か所の名前付きスタンプ）の記述が残っていないか
 14. 魚の図鑑：画像・名前・順番が、JavaScript・SQL・画像の変換スクリプトで一致しているか
 15. 元の画像のフォルダ（fish-stamp-images など）が、GitHubに送られないようになっているか
 16. 参加者のスタンプのリセット：SQLの関数・権限と、参加者の画面・管理画面の呼び出しが、そろっているか
 17. スタンプラリー画面のバナー（中央）・獲得の演出（後光）・ルール説明のポップアップ（「次回からは表示しない」の保存）が、そろっているか
     （ルール説明が、仮の内容のままのときは、注意として表示します）
 18. トップページ（「すきまキッズラボとは？」）：紹介文・画像・スクロールで順番に現れる動き（js/reveal.js）が、そろっているか。
     公開ページの画像の width / height が、実際の画像の大きさと同じか
 19. アンケート・プライバシー規約・フッター：規約の項の番号と版が正しいか（【要確認】が残っていると注意として表示）、
     景品を希望するときに、規約への同意にチェックを入れるまで「送信する」を押せないか、フッターが小文字か
 20. メールアドレス：アンケートの入力欄・JavaScript・SQL（列・検査・関数の引数と権限）・管理画面の表とCSVが、そろっているか
 21. 管理画面の一括操作：参加者・アンケートのチェックボックス、一括の除外・リセット、アンケートの削除が、SQL（関数・管理者のみ・権限）と、画面で、そろっているか
 22. この端末の履歴の完全リセット（reset/）：サイトが端末に保存している履歴の名前が、すべて載っているか、消す処理・別のタブの開き直し・管理画面のリンクが、そろっているか
 23. 管理画面の「完全リセット」（参加者の端末のサイトの履歴も消す）と、アンケートを削除したあとの答え直し：SQL（列・関数・権限）・スタンプラリー画面・アンケート画面・管理画面が、そろっているか
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
        # ロゴのリンク先は、サイトのトップページ（このリポジトリの index.html）
        m = re.search(r'<a class="site-logo" href="([^"]+)"', block)
        target = os.path.normpath(os.path.join(ROOT, os.path.dirname(rel), m.group(1), "index.html")) if m else None
        if not target or target != os.path.join(ROOT, "index.html"):
            bad(f"{rel}: ロゴのリンク先が、トップページ（index.html）になっていません")
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
            ok(f"共通ヘッダーは、{len(blocks)} ページで同じ内容です（ロゴ → トップページ、メニュー → 「すきまキッズラボ」とは？・Instagram）")
    # メニューの順番：「すきまキッズラボ」とは？ の直後に Instagram
    for rel, (_, block, _) in blocks.items():
        if block.find("「すきまキッズラボ」とは？") == -1 or block.find("menu-instagram") < block.find("「すきまキッズラボ」とは？"):
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
    if 'class="rules-draft"' in html:
        warn("ルール説明（rally/index.html の rules-draft の段落）が、仮の内容のままです。正式な内容にしたら、この「仮の説明です」の一文（class=\"rules-draft\"）を消してください")


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
    # フッター：小文字
    for rel in ("index.html", "rally/index.html"):
        m = re.search(r'<footer class="en">([^<]*)</footer>', read(rel))
        if not m or m.group(1) != m.group(1).lower():
            problems.append(f"{rel}: フッターの文字が、小文字になっていません（{m.group(1) if m else 'なし'}）")
    if problems:
        bad("；".join(problems))
    else:
        ok(f"規約は {len(nums)} 項・版 {version.group(1)}、同意にチェックするまで「送信する」を押せず、フッターは小文字です")
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
    if not fn or "p_email text default null" not in fn.group(1) or len(args) != 13:
        problems.append(f"sql/schema.sql: submit_survey の引数が13個（最後が p_email text default null）になっていません（{len(args)} 個）")
    grant = re.search(r"grant execute on function public\.submit_survey\(([^)]*)\)", sql)
    if not grant or len([a for a in grant.group(1).split(",") if a.strip()]) != 13:
        problems.append("sql/schema.sql: submit_survey の権限（grant）が、引数13個の版に付いていません")
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
        ok("メールアドレス：入力欄（電話番号の次・必須）→ submit_survey（13引数・検査・権限）→ prize_shipping.email → 管理画面の表・CSV・規約が、そろっています")


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


def check_sources_ignored():
    for folder in ("fish-stamp-images", "logo-banner-images", "about-images"):
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

    print("11. 景品を希望できる条件（スタンプの個数）")
    check_required()

    print("12. 掲示板のQRコードの文字列が、公開されるファイルに含まれていないか")
    check_board_secrets()

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

    print()
    print(f"結果：{len(failures)} 件の問題、{len(warnings)} 件の注意")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
