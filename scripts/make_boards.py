#!/usr/bin/env python3
"""
掲示板のQRコードを作る（スタンプラリー用）。

  python3 scripts/make_boards.py                 掲示板70個ぶんのQRコードを作る（初回）
  python3 scripts/make_boards.py --count 80      80個にする（すでにあるコードは、そのまま。増やした分だけ新しく作る）

作るもの（掲示板のQRコードは、すべて、中央の白い枠の中に「No.01」のような番号が入ります）
  qr/boards/with_title/board_01_title.png ...  A3・縦・300dpi。上に「スタンプラリー」、QRコードの下に「No.01」の番号を入れたもの
                                               （印刷はそのまま「実際のサイズ」で）
  qr/boards/transparent/board_01.png ...       QRコードだけ。画像いっぱいの正方形で、背景は透明（透過PNG）。余白（クワイエットゾーン）はつけていません
                                               （ご自身のデザインに組み込むとき用。明るい背景に、周りに余白をとって置いてください）
  qr/boards/boards.csv              掲示板の番号とコード、QRコードのURLの一覧（元データ。なくさないでください）
  qr/boards/boards_seed.sql         Supabase に掲示板のコードを登録するSQL（SQL Editor で実行します）
  qr/qr_top.png, qr_top_title.png   トップページ（「すきまキッズラボ」とは？）を開くQRコード（番号なし）
  qr/qr_rally.png, qr_rally_title.png  スタンプラリーのページを開くQRコード（番号なし。スタンプはつきません）

大切な決まり
  - 掲示板のQRコードに入る「コード」は、推測されにくい文字列です。これを知っていれば、掲示板に行かなくても
    スタンプを取れてしまうため、qr/boards/ のフォルダは、GitHubに公開されないようにしてあります（.gitignore）。
    このフォルダは、パソコンの中（できれば別の場所にもバックアップ）に大切に保管してください。
  - 掲示板のコードは、サーバー（Supabase）に登録されたものだけが、スタンプになります。
    boards_seed.sql を実行する前のQRコードは、読み取っても「登録されていません」と表示されます。
  - 一度作ったコードは変わりません（boards.csv に保存されています）。ファイルを消してしまうと、別のコードになります。
  - 中央に番号を入れる分、誤り訂正を最も強いレベルH（約30%）にしています（QRコードに入っているURLは、同じです）。
    白い枠は、QRコード全体の約6%に収めてあり、作るたびに、枠の外の模様がデータと一致するかを確かめます。

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
DEFAULT_COUNT = 70
EC_PLAIN = "m"          # 番号を入れないQRコード（トップページ・スタンプラリーのページ用）の誤り訂正レベル（約15%）
EC_LABEL = "h"          # 中央に番号を入れる掲示板のQRコードは、最も強いH（約30%）にする
# 中央の番号：白い四角の大きさは、文字から決める（単位は、QRコードのマス目）
LABEL_TEXT_MODULES = 11.0   # 「No.00」の文字の幅
LABEL_PAD_X = 2.0           # 文字の左右の白い余白
LABEL_PAD_Y = 1.8           # 文字の上下の白い余白
LABEL_MAX_COVER = 0.07      # 白い四角が、QRコード全体に占める割合の上限（これを超えると、読み取りに支障が出るおそれがあるため、作らない）
TRANSPARENT_PX = 2400       # 透過PNG（QRコードだけ）の一辺の目安（ピクセル）。マス目の整数倍になるよう、少し小さくなります
DIR_TITLE = "with_title"
DIR_TRANSPARENT = "transparent"
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

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


def make_qr(url, ec):
    return segno.make(url, error=ec, micro=False)


def qr_png(url, width_ratio, ec=EC_PLAIN):
    """URLのQRコード（周囲の白い余白つき）を、きれいな整数倍の大きさのPNGにして返す。戻り値：(画像, 倍率, segnoのQR)"""
    qr = make_qr(url, ec)
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


def odd_ceil(x):
    n = int(-(-x // 1))
    return n if n % 2 else n + 1


def label_geometry(font_path, texts, modules):
    """中央に入れる白い四角（番号の台）の大きさを決める。すべての番号で同じ大きさにする。
    単位は、QRコードのマス目。中央にそろえるため、幅・高さは奇数。戻り値：{w, h, font（文字の大きさ）, cover（QRコードに占める割合）}"""
    ref = 200
    font = load_font(font_path, ref)
    widest = max(font.getlength(t) for t in texts)
    unit = LABEL_TEXT_MODULES / widest                      # 計測用の1pxが、マス目いくつぶんか
    text_h = max(font.getbbox(t, anchor="ls")[3] - font.getbbox(t, anchor="ls")[1] for t in texts) * unit
    geom = {
        "w": odd_ceil(LABEL_TEXT_MODULES + 2 * LABEL_PAD_X),
        "h": odd_ceil(text_h + 2 * LABEL_PAD_Y),
        "font": ref * unit,
    }
    geom["cover"] = geom["w"] * geom["h"] / (modules * modules)
    if geom["cover"] > LABEL_MAX_COVER:
        sys.exit(f"中央の白い枠が、QRコード全体の {geom['cover']:.1%} になり、上限（{LABEL_MAX_COVER:.0%}）を超えます。LABEL_TEXT_MODULES などの設定を見直してください。")
    return geom


def covered_modules(geom, modules):
    """中央の白い四角が覆うマス目（行, 列）の集合"""
    r0, c0 = (modules - geom["h"]) // 2, (modules - geom["w"]) // 2
    return {(r, c) for r in range(r0, r0 + geom["h"]) for c in range(c0, c0 + geom["w"])}


def draw_label(img, origin, scale, modules, text, geom, font_path):
    """QRコードの中央に、白い四角と、番号の文字（黒）を描く。origin は、QRコードの左上のマス目（0行0列）の位置（ピクセル）。
    四角は、マス目の境目にそろえる（マス目の途中までは覆わない）。"""
    rgba = img.mode == "RGBA"
    white, black = (WHITE + (255,)) if rgba else WHITE, (BLACK + (255,)) if rgba else BLACK
    r0, c0 = (modules - geom["h"]) // 2, (modules - geom["w"]) // 2
    x0, y0 = origin[0] + c0 * scale, origin[1] + r0 * scale
    x1, y1 = x0 + geom["w"] * scale, y0 + geom["h"] * scale
    draw = ImageDraw.Draw(img)
    draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=white)
    font = load_font(font_path, round(geom["font"] * scale))
    left, top, right, bottom = font.getbbox(text, anchor="ls")      # 文字の見た目の枠を、四角の中央にそろえる
    draw.text(((x0 + x1) / 2 - (left + right) / 2, (y0 + y1) / 2 - (top + bottom) / 2), text, font=font, fill=black, anchor="ls")


def compose(url, out_path, font_path, title=None, label=None, center=None):
    """A3の用紙に、QRコード（と、あれば上に題名・下に番号）を配置して保存する。
    center は、QRコードの中央に入れる番号と、四角の大きさ（(文字, geom)）。戻り値：配置の情報（検証用）"""
    ratio = 0.80 if title else 0.92
    qr_img, scale, qr = qr_png(url, ratio, EC_LABEL if center else EC_PLAIN)
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
    skip = set()
    if center:
        modules = qr.symbol_size(scale=1, border=0)[0]
        draw_label(page, (x + 4 * scale, y + 4 * scale), scale, modules, center[0], center[1], font_path)
        skip = covered_modules(center[1], modules)
    page.save(out_path, dpi=(300, 300), optimize=True)
    return {"x": x, "y": y, "border": 4, "scale": scale, "qr": qr, "path": out_path, "skip": skip, "transparent": False}


def compose_transparent(url, out_path, font_path, center):
    """QRコードだけの、画像いっぱいの正方形（余白なし）の透過PNGを保存する。明るいマス目は透明、暗いマス目は黒、
    中央の番号の台だけは、白で塗る。戻り値：配置の情報（検証用）"""
    qr = make_qr(url, EC_LABEL)
    modules = qr.symbol_size(scale=1, border=0)[0]
    scale = TRANSPARENT_PX // modules
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=scale, border=0, dark="#000000", light="#ffffff")
    # 明るいマス目を、透明にする（透明な部分の色は、暗いマス目と同じ黒にしておく：拡大・縮小したときに、縁が白っぽくならない）
    dark_mask = Image.open(buf).convert("L").point(lambda v: 255 if v < 128 else 0)
    img = Image.new("RGBA", dark_mask.size, BLACK + (0,))
    img.paste(BLACK + (255,), mask=dark_mask)
    draw_label(img, (0, 0), scale, modules, center[0], center[1], font_path)
    img.save(out_path, dpi=(300, 300), optimize=True)
    return {"x": 0, "y": 0, "border": 0, "scale": scale, "qr": qr, "path": out_path, "skip": covered_modules(center[1], modules), "transparent": True}


def verify(info):
    """保存した画像の模様が、QRコードのデータと、（中央の白い四角に覆われた所を除く）すべてのマス目で一致するかを調べる。
    透過PNGは、暗いマス目が不透明の黒、明るいマス目が透明であることを調べる。"""
    im = Image.open(info["path"]).convert("RGBA")
    scale, x0, y0, border = info["scale"], info["x"], info["y"], info["border"]
    for r, row in enumerate(info["qr"].matrix):
        for c, v in enumerate(row):
            if (r, c) in info["skip"]:
                continue
            red, green, blue, alpha = im.getpixel((x0 + (c + border) * scale + scale // 2, y0 + (r + border) * scale + scale // 2))
            if info["transparent"]:
                dark = alpha > 127 and (red + green + blue) / 3 < 128
                if dark != bool(v) or (not v and alpha != 0):
                    return False
            elif ((red + green + blue) / 3 < 128) != bool(v):
                return False
    return True


def main():
    ap = argparse.ArgumentParser(description="掲示板のQRコードを作る")
    ap.add_argument("--count", type=int, default=DEFAULT_COUNT, help=f"掲示板の数（初期値 {DEFAULT_COUNT}）")
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

    # 画像：中央に番号を入れた2種類（A3・題名つき／透過PNG・QRコードだけ）を、別々のフォルダに作る
    title_dir, transparent_dir = os.path.join(out_dir, DIR_TITLE), os.path.join(out_dir, DIR_TRANSPARENT)
    os.makedirs(title_dir, exist_ok=True)
    os.makedirs(transparent_dir, exist_ok=True)
    first_url = f"{base}/rally/?stamp={boards[numbers[0]]}"
    modules = make_qr(first_url, EC_LABEL).symbol_size(scale=1, border=0)[0]
    geom = label_geometry(font_path, [f"No.{n:02d}" for n in numbers], modules)
    problems = 0
    for n in numbers:
        url = f"{base}/rally/?stamp={boards[n]}"
        center = (f"No.{n:02d}", geom)
        made = (
            (f"{DIR_TITLE}/board_{n:02d}_title.png", compose(url, os.path.join(title_dir, f"board_{n:02d}_title.png"), font_path, "スタンプラリー", f"No.{n:02d}", center)),
            (f"{DIR_TRANSPARENT}/board_{n:02d}.png", compose_transparent(url, os.path.join(transparent_dir, f"board_{n:02d}.png"), font_path, center)),
        )
        for name, info in made:
            if not verify(info):
                problems += 1
                print(f"× {name}：QRコードの模様が、データと一致しません")
    if not args.no_public:
        for name, url, title in (("top", f"{base}/", "すきまキッズラボ"), ("rally", f"{base}/rally/", "スタンプラリー")):
            for suffix, t in (("", None), ("_title", title)):
                info = compose(url, os.path.join(ROOT, "qr", f"qr_{name}{suffix}.png"), font_path, t)
                if not verify(info):
                    problems += 1
                    print(f"× qr_{name}{suffix}.png：QRコードの模様が、データと一致しません")
    old_files = sorted(f for f in os.listdir(out_dir) if f.startswith("board_") and f.endswith(".png"))
    if old_files:
        print(f"※ qr/boards/ の直下に、旧い形式の画像が {len(old_files)} 枚残っています（中央に番号がない版）。印刷に使わないよう、別のフォルダ（例：qr/boards/old/）に移してください。")

    print(f"掲示板のQRコードを {len(numbers)} 個ぶん作りました（新しく作ったコード：{len(numbers) - kept} 個）。")
    print(f"  保存先：{os.path.relpath(out_dir, ROOT)}/   （GitHubには公開されません）")
    print(f"    {DIR_TITLE}/    A3・題名つき（{len(numbers)} 枚）　　{DIR_TRANSPARENT}/    透過PNG・QRコードだけ（{len(numbers)} 枚）")
    print(f"  QRコード：{modules}×{modules} マス（誤り訂正レベルH）。中央の番号の白い枠：{geom['w']}×{geom['h']} マス（全体の {geom['cover']:.1%}）")
    print(f"  使ったフォント：{font_path}")
    print("次の作業：")
    print("  1. Supabase の SQL Editor で、sql/schema.sql（まだなら）→ qr/boards/boards_seed.sql の順に実行する")
    print("  2. 印刷する前に、スマートフォンで読み取って、スタンプが取れることを確認する")
    if problems:
        print(f"※ {problems} 件の画像で、確認に失敗しました。もう一度実行してください。")
        return 1
    print("画像の確認：すべてのQRコードの模様が、（中央の白い枠を除いて）データと一致しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
