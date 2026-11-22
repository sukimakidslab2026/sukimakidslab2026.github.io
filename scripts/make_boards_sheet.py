#!/usr/bin/env python3
"""
掲示板の「番号・コード・URL」の一覧を、スプレッドシート（.xlsx）にする。

  python3 scripts/make_boards_sheet.py

読むもの：qr/boards/boards.csv（scripts/make_boards.py が作る元データ）
作るもの：private/boards_sheet.xlsx
  Googleスプレッドシートで開けます（Googleドライブにアップロード → ファイルをダブルクリック → 「Googleスプレッドシートで開く」。
  または、スプレッドシートの「ファイル」→「インポート」→「アップロード」）。

大切な決まり
  - private/ は、GitHubに公開されないフォルダです（.gitignore）。掲示板のコードは、知っていればスタンプを取れてしまう
    秘密の文字列なので、この一覧は、公開しないでください。Googleドライブに置くときは、共有（リンクを知っている全員など）にしないでください。
  - 追加のライブラリは要りません（Python 3 だけで動きます）。
  - 「コード」は文字として入れます（「1e5」のような並びが、数値に変えられないようにするため）。
"""
import csv
import os
import sys
import zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "qr", "boards", "boards.csv")
OUT_DIR = os.path.join(ROOT, "private")
OUT = os.path.join(OUT_DIR, "boards_sheet.xlsx")
HEADERS = ["番号", "コード", "URL"]


def col(i):
    return "ABC"[i]


def sheet_xml(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
           '<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="80" customWidth="1"/></cols>',
           "<sheetData>"]
    for r, row in enumerate([HEADERS] + rows, start=1):
        cells = []
        for c, value in enumerate(row):
            ref = f"{col(c)}{r}"
            style = ' s="1"' if r == 1 else ""
            if c == 0 and r > 1:
                cells.append(f'<c r="{ref}"{style}><v>{int(value)}</v></c>')
            else:
                cells.append(f'<c r="{ref}"{style} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
        out.append(f'<row r="{r}">{"".join(cells)}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


FILES = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="掲示板" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EAD3"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
}


def main():
    if not os.path.exists(SOURCE):
        sys.exit("qr/boards/boards.csv がありません。先に scripts/make_boards.py を実行してください。")
    with open(SOURCE, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = [[r["board_no"].strip(), r["code"].strip(), r["url"].strip()] for r in reader if r.get("code")]
    if not rows:
        sys.exit("boards.csv に、掲示板が1つもありません。")
    os.makedirs(OUT_DIR, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in FILES.items():
            z.writestr(name, data)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml(rows))
    print(f"{len(rows)} 件を {os.path.relpath(OUT, ROOT)} に書き出しました（GitHubには送られません）")


if __name__ == "__main__":
    main()
