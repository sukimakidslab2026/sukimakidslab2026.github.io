/*
 * 魚の名前・画像の名前と大きさ。scripts/make_fish_assets.py が自動で作るファイルです（手で編集しないでください）。
 * 魚が増えていく順番は、ここではなく、管理画面の「スタンプ設定」で決めます（js/fish.js に、初期の順番があります）。
 */
window.RALLY_FISH_BASE = "../assets/fish/";
window.RALLY_FISH_SCENE = {"file": "scene.webp", "width": 1500, "height": 629};
window.RALLY_FISH = {
  koi: {"name": "コイ", "stamp": "stamp-koi.webp", "silhouette": "silhouette-koi.webp", "layer": "layer-koi.webp", "width": 312, "height": 480, "cx": 0.834, "cy": 0.343},
  dojo: {"name": "ドジョウ", "stamp": "stamp-dojo.webp", "silhouette": "silhouette-dojo.webp", "layer": "layer-dojo.webp", "width": 480, "height": 290, "cx": 0.602, "cy": 0.717},
  namazu: {"name": "ナマズ", "stamp": "stamp-namazu.webp", "silhouette": "silhouette-namazu.webp", "layer": "layer-namazu.webp", "width": 480, "height": 226, "cx": 0.229, "cy": 0.728},
  haze: {"name": "ハゼ", "stamp": "stamp-haze.webp", "silhouette": "silhouette-haze.webp", "layer": "layer-haze.webp", "width": 480, "height": 206, "cx": 0.852, "cy": 0.817},
  funa: {"name": "フナ", "stamp": "stamp-funa.webp", "silhouette": "silhouette-funa.webp", "layer": "layer-funa.webp", "width": 480, "height": 284, "cx": 0.47, "cy": 0.376},
  medaka: {"name": "メダカ", "stamp": "stamp-medaka.webp", "silhouette": "silhouette-medaka.webp", "layer": "layer-medaka.webp", "width": 480, "height": 242, "cx": 0.475, "cy": 0.441}
};
