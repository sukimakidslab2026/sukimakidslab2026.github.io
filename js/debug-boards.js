// チーム専用の、デバッグ用のQRコード（掲示板 No.61〜70）の見分け方。scripts/make_boards.py が作ります（手で書きかえないでください）。
// QRコードに入っている合言葉そのものは、ここには入れていません（掲示板のコードは、公開しない決まりのため）。
// 合言葉から、次の方法で計算した値だけを入れています：PBKDF2-HMAC-SHA256（塩・繰り返しの回数は、下の値）→ 16進数の文字列。
// 画面（rally/app.js の debugBoardNo）は、読み取った合言葉を同じ方法で計算して、ここにあるかを調べます。あれば、デバッグ用の掲示板（値は、掲示板の番号）。
// デバッグ用のQRコードは、サーバーに記録を残さず、景品にも関係しません（端末の中だけで、スタンプの進み具合を確かめるためのものです）。
window.RALLY_DEBUG_BOARDS={salt:"sukima-rally-debug-v1",iterations:100000,hashes:{
  "144366b46b99fe57354a853857214fbe21628a5c5403a75d836547e57b0a0379": 61,
  "2965c129ad7da3a34e857a9292486be1a1eafaff5f6bda04145041920a9e0c27": 62,
  "1285b16031fda5736d09497c0b2df0da8680d68a480d3efac796ce73cd93778f": 63,
  "ab3a64fc324db2b5cb9865b4edfdb3ed5054770ef4efe1a7afdef3bce706a834": 64,
  "1eb7cc520bb41b5b274a142bede4aa692342774abcdc49fd4a4e086d54d4ca25": 65,
  "30237068bbe6a1d54e8fdba9a56d4f71fbd8676c559d0765f039d6ccbba1f13f": 66,
  "18afe472beb816d02ca735b6f400e5f43fa3108ad935d470d4f50b9fbc681759": 67,
  "339870069df08c36bdf6af031e9db8e03abdcc87926172100ad1d0d3e8523190": 68,
  "0a6c4b0e46d0b9632b4b8116a3f0397372716e3c3f543fe0f3e86124c3007684": 69,
  "faae4be8f743387ecf8057e6bad6a9ce5f74be5862f4a5a6998e6e77b15f337a": 70
}};
