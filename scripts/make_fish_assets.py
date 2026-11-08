#!/usr/bin/env python3
"""
魚のスタンプ画像・ロゴ・バナーを、サイトで使う「軽い画像」に変換する。

  python3 scripts/make_fish_assets.py

入力（デザインの元の画像。大きいので、GitHubには送りません＝.gitignore で除外しています）
  fish-stamp-images/スタンプ背景.png                      川の背景
  fish-stamp-images/川魚onスタンプ背景/川魚-○○.png       背景の上に、魚を置いた状態の透明な画像（魚1種類ごと・背景と同じ大きさ）
  fish-stamp-images/スタンプ/○○.png                       図鑑に出す、色つきの魚（獲得したとき）
  fish-stamp-images/シルエット/シルエット_○○.png          図鑑に出す、シルエット（まだ獲得していないとき）
  logo-banner-images/logo.png, banner.png                  ロゴ（アイコン）とバナー

出力（サイトが読み込む画像。これはGitHubに送ります）
  assets/fish/scene.webp, layer-○○.webp, stamp-○○.webp, silhouette-○○.webp
  assets/logo.webp（ヘッダーのロゴ）, assets/banner.webp（ページ上部のバナー）
  assets/favicon-32.png, favicon-64.png, apple-touch-icon.png（ブラウザのタブ・ホーム画面のアイコン）
  js/fish-data.js（魚の名前・画像の名前と大きさ。自動で作られるので、手で編集しないでください）

画像の差し替えかた：元の画像のフォルダの中身を、同じ名前で入れ替えて、このスクリプトをもう一度実行します。
魚を増やしたり、名前を変えたりするときは、下の FISH を編集します（sql/schema.sql の rally_fish_keys() と、js/fish.js の初期の順番も合わせます）。

必要なもの：Python 3 と Pillow（pip3 install pillow）
"""
import glob
import json
import os
import sys
import unicodedata

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow が必要です。次を実行してから、もう一度お試しください：  pip3 install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_FISH = os.path.join(ROOT, "fish-stamp-images")
SRC_LOGO = os.path.join(ROOT, "logo-banner-images")
OUT = os.path.join(ROOT, "assets")
OUT_FISH = os.path.join(OUT, "fish")

# 魚の一覧（キー, 名前, 元の画像の名前）。キーは、サイト・データベースで魚を見分ける名前です（半角の英小文字）。
FISH = [
    ("koi", "コイ", "コイ"),
    ("dojo", "ドジョウ", "ドジョウ"),
    ("namazu", "ナマズ", "ナマズ"),
    ("haze", "ハゼ", "ハゼ"),
    ("funa", "フナ", "フナ"),
    ("medaka", "メダカ", "メダカ"),
]

SCENE_WIDTH = 1500          # 川の背景・魚の重ね画像の横幅（px）。スマートフォンで、3倍の高精細でも十分な大きさ
STAMP_LONG_SIDE = 480       # 図鑑の魚の、長いほうの辺（px）
LOGO_HEIGHT = 144           # ヘッダーのロゴの高さ（px）。表示は48pxなので、3倍
BANNER_WIDTH = 1000         # バナーの横幅（px）


def need(path):
    if not os.path.exists(path):
        sys.exit(f"画像が見つかりません：{os.path.relpath(path, ROOT)}")
    return path


def find_layer(name):
    """川魚onスタンプ背景/ の中から、魚の名前で終わるファイルを探す（「川魚_コイ.png」と「川魚-ドジョウ.png」のように、区切りが違っても見つける）。"""
    # Macのファイル名は、濁点が別の文字として保存されていることがあるので、文字の形をそろえてから比べる
    nfc = lambda text: unicodedata.normalize("NFC", text)
    found = [p for p in glob.glob(os.path.join(SRC_FISH, "川魚onスタンプ背景", "*.png")) if nfc(os.path.splitext(os.path.basename(p))[0]).endswith(nfc(name))]
    if len(found) != 1:
        sys.exit(f"「川魚onスタンプ背景」の中に、「{name}」の画像が、ちょうど1つ見つかりません（{len(found)} 個）。")
    return found[0]


def save_webp(img, path, quality=90):
    img.save(path, "WEBP", quality=quality, alpha_quality=100, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT_FISH, exist_ok=True)
    sizes = {}

    # 川の背景と、魚の重ね画像（同じ大きさ）
    scene_src = Image.open(need(os.path.join(SRC_FISH, "スタンプ背景.png"))).convert("RGBA")
    height = round(SCENE_WIDTH * scene_src.height / scene_src.width)
    scene = scene_src.resize((SCENE_WIDTH, height), Image.LANCZOS)
    sizes["scene.webp"] = save_webp(scene, os.path.join(OUT_FISH, "scene.webp"), 88)

    data = {}
    for key, name, src in FISH:
        # 重ね画像
        layer_src = Image.open(find_layer(src)).convert("RGBA")
        if layer_src.size != scene_src.size:
            sys.exit(f"「{src}」の重ね画像の大きさ {layer_src.size} が、背景 {scene_src.size} と違います。")
        x0, y0, x1, y1 = layer_src.getchannel("A").getbbox()
        layer = layer_src.resize((SCENE_WIDTH, height), Image.LANCZOS)
        sizes[f"layer-{key}.webp"] = save_webp(layer, os.path.join(OUT_FISH, f"layer-{key}.webp"), 88)

        # 図鑑の魚（色つき）。透明な余白を切り取って、長いほうの辺を STAMP_LONG_SIDE にそろえる
        stamp_src = Image.open(need(os.path.join(SRC_FISH, "スタンプ", f"{src}.png"))).convert("RGBA")
        box = stamp_src.getchannel("A").getbbox()
        stamp = stamp_src.crop(box)
        scale = STAMP_LONG_SIDE / max(stamp.size)
        size = (max(1, round(stamp.width * scale)), max(1, round(stamp.height * scale)))
        stamp = stamp.resize(size, Image.LANCZOS)
        sizes[f"stamp-{key}.webp"] = save_webp(stamp, os.path.join(OUT_FISH, f"stamp-{key}.webp"), 90)

        # シルエット：色つきの魚と、同じ大きさにそろえる（差し替えても、位置や大きさがずれないように）
        sil_src = Image.open(need(os.path.join(SRC_FISH, "シルエット", f"シルエット_{src}.png"))).convert("RGBA")
        sil_box = sil_src.getchannel("A").getbbox()
        sil = sil_src.crop(sil_box).resize(size, Image.LANCZOS)
        sizes[f"silhouette-{key}.webp"] = save_webp(sil, os.path.join(OUT_FISH, f"silhouette-{key}.webp"), 90)

        data[key] = {
            "name": name,
            "stamp": f"stamp-{key}.webp",
            "silhouette": f"silhouette-{key}.webp",
            "layer": f"layer-{key}.webp",
            "width": size[0],
            "height": size[1],
            # 重ね画像の中で、魚がいる範囲の中心（0〜1）。魚が現れるアニメーションの中心に使う
            "cx": round((x0 + x1) / 2 / layer_src.width, 3),
            "cy": round((y0 + y1) / 2 / layer_src.height, 3),
        }

    # ロゴ（透明な余白を切り取って、高さをそろえる）。ヘッダーに使う
    logo_src = Image.open(need(os.path.join(SRC_LOGO, "logo.png"))).convert("RGBA")
    logo = logo_src.crop(logo_src.getchannel("A").getbbox())
    logo_w = round(logo.width * LOGO_HEIGHT / logo.height)
    logo = logo.resize((logo_w, LOGO_HEIGHT), Image.LANCZOS)
    sizes["logo.webp"] = save_webp(logo, os.path.join(OUT, "logo.webp"), 92)

    # バナー（透明な余白を切り取って、横幅をそろえる）
    banner_src = Image.open(need(os.path.join(SRC_LOGO, "banner.png"))).convert("RGBA")
    banner = banner_src.crop(banner_src.getchannel("A").getbbox())
    banner_h = round(banner.height * BANNER_WIDTH / banner.width)
    banner = banner.resize((BANNER_WIDTH, banner_h), Image.LANCZOS)
    sizes["banner.webp"] = save_webp(banner, os.path.join(OUT, "banner.webp"), 92)

    # アイコン（ブラウザのタブ・スマートフォンのホーム画面）。ロゴは横長なので、正方形の中央に置く
    def square(side, fill, margin):
        canvas = Image.new("RGBA", (side, side), fill)
        inner = side - 2 * margin
        scale = min(inner / logo_src_crop.width, inner / logo_src_crop.height)
        w, h = max(1, round(logo_src_crop.width * scale)), max(1, round(logo_src_crop.height * scale))
        fitted = logo_src_crop.resize((w, h), Image.LANCZOS)
        canvas.alpha_composite(fitted, ((side - w) // 2, (side - h) // 2))
        return canvas
    logo_src_crop = logo_src.crop(logo_src.getchannel("A").getbbox())
    for name, side, fill, margin in (("favicon-32.png", 32, (0, 0, 0, 0), 1), ("favicon-64.png", 64, (0, 0, 0, 0), 2), ("apple-touch-icon.png", 180, (255, 255, 255, 255), 14)):
        img = square(side, fill, margin)
        path = os.path.join(OUT, name)
        (img.convert("RGB") if name.startswith("apple") else img).save(path, optimize=True)
        sizes[name] = os.path.getsize(path)

    # 魚のデータ（JavaScript用）
    js = (
        "/*\n"
        " * 魚の名前・画像の名前と大きさ。scripts/make_fish_assets.py が自動で作るファイルです（手で編集しないでください）。\n"
        " * 魚が増えていく順番は、ここではなく、管理画面の「スタンプ設定」で決めます（js/fish.js に、初期の順番があります）。\n"
        " */\n"
        'window.RALLY_FISH_BASE = "../assets/fish/";\n'
        f'window.RALLY_FISH_SCENE = {json.dumps({"file": "scene.webp", "width": SCENE_WIDTH, "height": height}, ensure_ascii=False)};\n'
        "window.RALLY_FISH = {\n"
        + ",\n".join(f"  {key}: {json.dumps(data[key], ensure_ascii=False)}" for key, _, _ in FISH)
        + "\n};\n"
    )
    with open(os.path.join(ROOT, "js", "fish-data.js"), "w", encoding="utf-8") as f:
        f.write(js)

    total = sum(sizes.values())
    print(f"画像を変換しました（{len(sizes)} 枚、合計 {total // 1024} KB）。")
    for name, size in sorted(sizes.items()):
        print(f"  {name:28s} {size // 1024:4d} KB")
    print("  js/fish-data.js を作りました。")
    print("次の作業： python3 scripts/stamp_assets.py → python3 scripts/check_site.py")


if __name__ == "__main__":
    main()
