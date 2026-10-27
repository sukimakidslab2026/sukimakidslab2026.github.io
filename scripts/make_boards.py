#!/usr/bin/env python3
"""
掲示板のQRコードを作る（スタンプラリー用）。

  python3 scripts/make_boards.py                 掲示板15個ぶんのQRコードを作る（初回）
  python3 scripts/make_boards.py --count 18      18個にする（すでにある15個のコードは、そのまま。増やした分だけ新しく作る）

作るもの（すべて A3・縦・300dpi の画像。印刷はそのまま「実際のサイズ」で）
  qr/boards/board_01.png ...        QRコードだけ（ご自身のデザインに組み込むとき用）
  qr/boards/board_01_title.png ...  上に「スタンプラリー」、QRコードの下に「No.01」の番号を入れたもの
  qr/boards/boards.csv              掲示板の番号とコード、QRコードのURLの一覧（元データ。なくさないでください）
  qr/boards/boards_seed.sql         Supabase に掲示板のコードを登録するSQL（SQL Editor で実行します）
  qr/qr_top.png, qr_top_title.png   トップページ（「すきまキッズラボ」とは？）を開くQRコード
  qr/qr_rally.png, qr_rally_title.png  スタンプラリーのページを開くQRコード（スタンプはつきません）

大切な決まり
  - 掲示板のQRコードに入る「コード」は、推測されにくい文字列です。これを知っていれば、掲示板に行かなくても
    スタンプを取れてしまうため、qr/boards/ のフォルダは、GitHubに公開されないようにしてあります（.gitignore）。
    このフォルダは、パソコンの中（できれば別の場所にもバックアップ）に大切に保管してください。
  - 掲示板のコードは、サーバー（Supabase）に登録されたものだけが、スタンプになります。
    boards_seed.sql を実行する前のQRコードは、読み取っても「登録されていません」と表示されます。
  - 一度作ったコードは変わりません（boards.csv に保存されています）。ファイルを消してしまうと、別のコードになります。

必要なもの：Python 3 と、次の2つのライブラリ（最初に1回だけ）
  pip3 install segno pillow
"""
import argparse
import csv
import io
import os
import secrets
import sys

try:
    import segno
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("segno と pillow が必要です。次を実行してから、もう一度お試しください：  pip3 install segno pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASE = "https://sukimakidslab2026.github.io"
W, H = 3508, 4961                      # A3 縦（297×420mm）・300dpi
COLOR = (0x30, 0x55, 0x7e)              # ブランドカラー（brand.css の --color-primary）
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # 読み間違えやすい文字（i l o 0 1）を除く
CODE_LENGTH = 8

# サイトの日本語フォント（筑紫A丸ゴシック）。有料フォントのため、フォントファイルはリポジトリに入れていません。
# Mac に入っているものを使います（見つからないときは、--font でフォントファイルを指定してください）。
FONT_GLOBS = [
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*/AssetData/TsukushiAMaruGothic.ttc",
    "/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]


def find_font(explicit=None):
    import glob
    if explicit:
        return explicit
    for pattern in FONT_GLOBS:
        found = sorted(glob.glob(pattern))
        if found:
            return found[0]
    return None


def load_font(path, size):
    """太字の面を選ぶ（.ttc は複数の面を含む）。"""
    best = None
    for index in range(8):
        try:
            font = ImageFont.truetype(path, size, index=index)
        except (OSError, ValueError):
            break
        style = (font.getname()[1] or "").lower()
        if "bold" in style or "w6" in style or "w7" in style:
            return font
        best = best or font
    return best or ImageFont.truetype(path, size)


def make_code(existing):
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if code not in existing:
            return code


def read_boards(path):
    boards = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                boards[int(row["board_no"])] = row["code"].strip()
    return boards


def qr_png(url, width_ratio):
    """URLのQRコード（周囲の白い余白つき）を、きれいな整数倍の大きさのPNGにして返す。戻り値：(画像, 倍率, モジュール数, segnoのQR)"""
    qr = segno.make(url, error="m", micro=False)
    modules = qr.symbol_size(scale=1, border=4)[0]
    scale = int(W * width_ratio // modules)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=scale, border=4, dark="#000000", light="#ffffff")
    return Image.open(buf).convert("RGB"), scale, qr


def fit_font(path, text, max_width, max_size):
    size = max_size
    while size > 80:
        font = load_font(path, size)
        if font.getlength(text) <= max_width:
            return font
        size -= 8
    return load_font(path, size)


def compose(url, out_path, font_path, title=None, label=None):
    """A3の用紙に、QRコード（と、あれば上に題名・下に番号）を配置して保存する。戻り値：配置の情報（検証用）"""
    ratio = 0.80 if title else 0.92
    qr_img, scale, qr = qr_png(url, ratio)
    page = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(page)
    x = (W - qr_img.width) // 2
    if title:
        y = 1500
        font = fit_font(font_path, title, W * 0.86, 600)
        draw.text((W // 2, 760), title, font=font, fill=COLOR, anchor="mm")
        if label:
            below = H - (y + qr_img.height)
            draw.text((W // 2, y + qr_img.height + below // 2), label, font=load_font(font_path, 210), fill=COLOR, anchor="mm")
    else:
        y = (H - qr_img.height) // 2
    page.paste(qr_img, (x, y))
    page.save(out_path, dpi=(300, 300), optimize=True)
    return {"x": x, "y": y, "scale": scale, "qr": qr, "path": out_path}


def verify(info):
    """保存した画像の白黒の模様が、QRコードのデータと、すべてのマス目で一致するかを調べる。"""
    im = Image.open(info["path"]).convert("L")
    scale, x0, y0 = info["scale"], info["x"], info["y"]
    for r, row in enumerate(info["qr"].matrix):
        for c, v in enumerate(row):
            px = im.getpixel((x0 + (c + 4) * scale + scale // 2, y0 + (r + 4) * scale + scale // 2))
            if (px < 128) != bool(v):
                return False
    return True


def main():
    ap = argparse.ArgumentParser(description="掲示板のQRコードを作る")
    ap.add_argument("--count", type=int, default=15, help="掲示板の数（初期値 15）")
    ap.add_argument("--base-url", default=DEFAULT_BASE, help=f"サイトのURL（初期値 {DEFAULT_BASE}）")
    ap.add_argument("--font", help="題名に使うフォントファイル（省略すると、Macの筑紫A丸ゴシックを探します）")
    ap.add_argument("--no-public", action="store_true", help="トップページ・スタンプラリーのQRコード（qr/ の直下）は作らない")
    args = ap.parse_args()
    if args.count < 1 or args.count > 99:
        sys.exit("--count は 1〜99 の数にしてください。")
    base = args.base_url.rstrip("/")

    font_path = find_font(args.font)
    if not font_path:
        sys.exit("題名に使うフォントが見つかりません。--font でフォントファイル（.ttc / .ttf / .otf）を指定してください。")

    out_dir = os.path.join(ROOT, "qr", "boards")
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, "boards.csv")
    boards = read_boards(csv_path)
    kept = len(boards)
    for n in range(1, args.count + 1):
        if n not in boards:
            boards[n] = make_code(set(boards.values()))
    if kept > args.count:
        print(f"※ すでに {kept} 個のコードがあるため、{kept} 個すべてを残します（減らしません）。")
    numbers = sorted(boards)

    # 一覧（元データ）
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["board_no", "code", "url"])
        for n in numbers:
            w.writerow([n, boards[n], f"{base}/rally/?stamp={boards[n]}"])

    # Supabase に登録するSQL
    values = ",\n".join(f"  ('{boards[n]}', {n})" for n in numbers)
    codes = ", ".join(f"'{boards[n]}'" for n in numbers)
    with open(os.path.join(out_dir, "boards_seed.sql"), "w", encoding="utf-8") as f:
        f.write(
            "-- 掲示板のQRコードの登録（このファイルは公開しないでください）。SupabaseのSQL Editorに貼り付けて Run します。\n"
            "-- 何度実行しても同じ結果になります（登録済みの番号・コードは、そのまま残ります）。\n"
            "insert into public.stamp_boards (code, board_no) values\n"
            f"{values}\n"
            "on conflict do nothing;\n\n"
            "-- 確認：「登録済み」と「期待する数」が同じなら、すべて登録されています。\n"
            f"select count(*) as 登録済み, {len(numbers)} as 期待する数 from public.stamp_boards where code in ({codes});\n"
        )

    # 画像
    problems = 0
    for n in numbers:
        url = f"{base}/rally/?stamp={boards[n]}"
        for suffix, title, label in (("", None, None), ("_title", "スタンプラリー", f"No.{n:02d}")):
            info = compose(url, os.path.join(out_dir, f"board_{n:02d}{suffix}.png"), font_path, title, label)
            if not verify(info):
                problems += 1
                print(f"× board_{n:02d}{suffix}.png：QRコードの模様が、データと一致しません")
    if not args.no_public:
        for name, url, title in (("top", f"{base}/", "すきまキッズラボ"), ("rally", f"{base}/rally/", "スタンプラリー")):
            for suffix, t in (("", None), ("_title", title)):
                info = compose(url, os.path.join(ROOT, "qr", f"qr_{name}{suffix}.png"), font_path, t)
                if not verify(info):
                    problems += 1
                    print(f"× qr_{name}{suffix}.png：QRコードの模様が、データと一致しません")

    print(f"掲示板のQRコードを {len(numbers)} 個ぶん作りました（新しく作ったコード：{len(numbers) - kept} 個）。")
    print(f"  保存先：{os.path.relpath(out_dir, ROOT)}/   （GitHubには公開されません）")
    print(f"  使ったフォント：{font_path}")
    print("次の作業：")
    print("  1. Supabase の SQL Editor で、sql/schema.sql（まだなら）→ qr/boards/boards_seed.sql の順に実行する")
    print("  2. 印刷する前に、スマートフォンで読み取って、スタンプが取れることを確認する")
    if problems:
        print(f"※ {problems} 件の画像で、確認に失敗しました。もう一度実行してください。")
        return 1
    print("画像の確認：すべてのQRコードの模様が、データと一致しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
