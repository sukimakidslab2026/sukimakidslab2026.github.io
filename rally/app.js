// ---- 設定 ----
// 景品をゲットできる条件：掲示板のQRコードを、この個数以上読み取ること。
// sql/schema.sql の rally_required_stamps() と同じ数にしてください（scripts/check_site.py が一致を確認します）。
const PRIZE_REQUIRED=3;
// お魚の図鑑。お魚の名前・画像は js/fish-data.js、共通の部品は js/fish.js にあります。
// 川が完成するスタンプの個数は、お魚の種類の数（いまは6種類）です。
const Fish=window.RallyFish, FISH=Fish.fish;
const RIVER_TOTAL=Fish.keys.length;
// QRコード（掲示板）の合言葉の形式。実際に有効なコードかどうかは、サーバー（record_scan）が確かめます。
// （"constructor" のような言葉も、形式は満たしますが、登録されていないので、スタンプにはなりません）
const STAMP_FORMAT=/^[a-z0-9]{6,32}$/;
const isStamp=code=>typeof code==="string"&&STAMP_FORMAT.test(code);
const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);

// ---- 端末への保存 ----
// ブラウザが保存を許可していない場合（プライベートブラウズや、制限のあるアプリ内ブラウザなど）でも、
// 画面が止まらないようにします。その場合は、このページを開いている間だけ、メモリに保存します。
const participantKey = "stamp_rally_participant_id";
// デバッグモード：チーム専用のデバッグ用QRコード（掲示板 No.61〜70）を読み取ると、この端末は、「デバッグを終わる」を押すまで、デバッグモードになる。
// このあいだ、スタンプ・アンケートは、サーバーには送らず、この端末の中だけで扱う（記録は、何も残らない）。本物の記録と混ざらないよう、別の保存先（…_debug_…）を使う。
const debugKey = "stamp_rally_debug";
const debugOn = (()=>{ try{ return localStorage.getItem(debugKey)==="1"; }catch(e){ return false; } })();
const timesKey = debugOn ? "stamp_rally_debug_stamp_times" : "stamp_rally_stamp_times";
const pendingKey = debugOn ? "stamp_rally_debug_pending" : "stamp_rally_pending";
const stampsKey = debugOn ? "stamp_rally_debug_stamps" : "stamp_rally_stamps";
const surveyKey = debugOn ? "stamp_rally_debug_survey_submitted" : "stamp_rally_survey_submitted";
const fishOrderKey = "stamp_rally_fish_order";   // 最後に読み込んだ、お魚が増えていく順番（通信できなくても、同じ順番で表示するため）
const resetKey = "stamp_rally_reset_count";      // 管理者によるスタンプのリセットを、この端末が最後に確かめた回数
const rulesKey = "stamp_rally_hide_rules";       // ルール説明の「次回からは表示しない」にチェックを入れたか（"1" のとき、ページを開いても、ルール説明を自動では出さない）
const memoryStore = new Map();
let storageBlocked = false;
let wiping = false;   // 完全リセットで、端末の履歴を消して、開き直している最中（このあいだは、何も保存しない：消した記録を、書き戻さないように）
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ storageBlocked=true; return memoryStore.has(k)?memoryStore.get(k):null; } },
  set(k,v){ if(wiping) return; try{ localStorage.setItem(k,v); }catch(e){ storageBlocked=true; memoryStore.set(k,String(v)); } },
  remove(k){ if(wiping) return; try{ localStorage.removeItem(k); }catch(e){ storageBlocked=true; memoryStore.delete(k); } }
};
// 保存されたスタンプの一覧を読む。壊れた値や、形式に合わない値は取り除く
function readStampList(key){
  try{
    const value=JSON.parse(store.get(key)||"[]");
    return Array.isArray(value)?[...new Set(value.filter(isStamp))]:[];
  }catch(e){ return []; }
}

const participantId = getOrCreateParticipantId();
document.getElementById("participantId").textContent = participantId;
document.getElementById("total").textContent = RIVER_TOTAL;

// お魚が増えていく順番（図鑑の順番）。スタンプを取った掲示板には関係なく、スタンプを1個取るごとに、この順番で次のお魚が現れます。
// 管理画面の「スタンプ設定」で決めた順番を、サーバーから読み込みます（読み込めないときは、前回の順番、なければ初期の順番）。
let fishOrder=(()=>{
  try{ return Fish.normalizeOrder(JSON.parse(store.get(fishOrderKey)||"null")); }catch(e){ return null; }
})()||Fish.defaultOrder();

function getOrCreateParticipantId(){
  let id = store.get(participantKey);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase()
                           : Math.random().toString(36).slice(2,12).toUpperCase();
    store.set(participantKey,id);
  }
  return id;
}

// width/height も指定しておく（スタイルシートが読み込めなくても、アイコンが巨大にならないように）
const icon=code=>`<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-${code}"></use></svg>`;
const pad2=n=>String(n).padStart(2,"0");
const formatTime=iso=>new Date(iso).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const surveyUrl=()=>`../survey/?participant_id=${encodeURIComponent(participantId)}`;
// 日本語の見出しを文節の区切りでだけ折り返します（「獲得しま／した」のような改行を防ぐ）。
const phrases=(...parts)=>parts.map(p=>`<span class="ph">${p}</span>`).join("");
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

function haptic(pattern){
  // Chromeは、画面を一度も触っていないページからのバイブレーションを拒否し、コンソールにエラーを出す。
  // QRコードから開いた直後はその状態なので、触れたあとだけ呼ぶ（iPhoneのSafariは、バイブレーション自体に未対応）
  if(navigator.userActivation&&!navigator.userActivation.hasBeenActive) return;
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(error){ /* 未対応の端末では何もしない */ }
}

function replay(el,className){
  el.classList.remove(className); void el.offsetWidth; el.classList.add(className);
}

// fx: {code, kind:"new"|"again"} … 直前に読み取ったスタンプの演出
function render(stamps,fx={}){
  renderBanner(stamps,fx);
  renderRiver(stamps,fx);
  renderStamps(stamps,fx);
}

// ---- 進捗バナー ----
// ゲージは、川が完成するまでの個数（6）。その途中の3個目に、景品の条件の目盛りがあります。
// 「景品をゲットできる条件」は、申し込みの手続き（アンケート）に進める条件のことです（数に限りがあります）。
// message は、文節ごとに分けた配列（画面では、文節の区切りでだけ折り返す）
function bannerContent(got){
  const toPrize=Math.max(PRIZE_REQUIRED-got,0), toRiver=Math.max(RIVER_TOTAL-got,0);
  if(got>=RIVER_TOTAL) return {state:"complete",doneLabel:"COMPLETE",message:["川が完成しました！","ありがとう！"]};
  if(got>=PRIZE_REQUIRED) return {state:"achieved",doneLabel:"ACHIEVED",message:["景品をゲットできる","条件を達成したよ！",`あと${toRiver}個で`,"川が完成するよ！"]};
  if(got===0) return {state:"empty",message:["スタンプを集めて","景品をゲットしよう！"]};
  if(toPrize===1) return {state:"almost",message:["あと1個！","景品まで","あと少し！"]};
  return {state:"progress",message:[`あと${toPrize}個で`,"景品をゲットできるよ！"]};
}
function renderBanner(stamps,fx){
  const total=RIVER_TOTAL, got=Math.min(stamps.length,total), toPrize=Math.max(PRIZE_REQUIRED-got,0), achieved=got>=PRIZE_REQUIRED;
  const {state,message,doneLabel}=bannerContent(got);
  const banner=$("progressBanner"), countEl=$("count"), remainEl=$("remain"), bar=$("bannerBar");
  banner.dataset.state=state;
  // 「景品まで、あと◯個」と「達成」の表示は、CSSではなく hidden 属性で切り替える
  document.querySelector(".remain-wrap").hidden=achieved;
  document.querySelector(".done-wrap").hidden=!achieved;
  if(doneLabel) $("doneLabel").textContent=doneLabel;
  countEl.textContent=got;
  remainEl.textContent=toPrize;
  $("total").textContent=total;
  $("bannerMessage").innerHTML=phrases(...message);
  const notice=String((window.RALLY_PRIZE||{}).notice||"").trim();
  $("bannerNote").textContent=notice; $("bannerNote").hidden=!notice;
  bar.setAttribute("aria-valuemax",total); bar.setAttribute("aria-valuenow",got);
  bar.setAttribute("aria-valuetext",`${got}個取得。`+(achieved?"景品をゲットできる条件を達成しています。":`景品まで、あと${toPrize}個。`)+(got>=total?"川が完成しました。":`川の完成まで、あと${total-got}個。`));
  // ゲージの目盛り（景品の条件・川の完成）の位置と文言
  const gauge=banner.querySelector(".gauge");
  gauge.style.setProperty("--segs",total); gauge.style.setProperty("--prize-col",PRIZE_REQUIRED);
  $("markPrize").textContent=`${PRIZE_REQUIRED}個で景品`; $("markGoal").textContent=`${total}個で川が完成`;
  $("markPrize").classList.toggle("on",achieved); $("markGoal").classList.toggle("on",got>=total);
  // 川が完成したあとに取ったスタンプでは、ゲージの演出をやり直さない
  const fresh=fx.kind==="new"&&stamps.length<=total;
  bar.innerHTML=Array.from({length:total},(_,i)=>`<span class="seg${i<got?" on":""}${fresh&&i===got-1?" is-new":""}"></span>`).join("");
  if(fresh){ replay(countEl,"bump"); replay(remainEl,"bump"); replay(banner,"is-new"); }
}

// ---- 川：背景の上に、スタンプの数だけ、順番どおりにお魚を重ねる ----
function renderRiver(stamps,fx){
  const got=Math.min(stamps.length,RIVER_TOTAL), keys=fishOrder.slice(0,got);
  const box=$("riverFish"), shown=[...box.children].map(el=>el.dataset.key);
  const appendOnly=shown.length<=keys.length&&shown.every((k,i)=>k===keys[i]);
  const newKey=fx.kind==="new"&&stamps.length<=RIVER_TOTAL?keys[keys.length-1]:null;
  if(appendOnly){
    // すでに出ているお魚には触らず、増えたお魚だけを足す（出ているお魚が、描き直されて、ちらつかないように）
    keys.slice(shown.length).forEach(k=>box.insertAdjacentHTML("beforeend",Fish.layerHtml(k,k===newKey)));
  } else {
    box.innerHTML=keys.map(k=>Fish.layerHtml(k,false)).join("");   // 順番が変わったときなどは、全部を並べ直す
  }
  const river=$("river"), complete=got>=RIVER_TOTAL, at=complete?completeTime(stamps):null;
  river.classList.toggle("is-complete",complete);
  river.setAttribute("aria-label",got?`川の絵。${got}種類のお魚が泳いでいます（${keys.map(k=>FISH[k].name).join("、")}）。`+(complete?`コンプリートしました。${at?`コンプリート日時は、${dateLabel(at)}です。`:""}`:""):"川の絵。まだお魚はいません。");
  $("riverCount").textContent=`${got} / ${RIVER_TOTAL}`;
  // コンプリートの日時は、「2026年11月20日 12:40）」を、1かたまりにする（「12:40）」だけが、次の行に離れないように）
  $("riverMessage").innerHTML=complete?phrases("川が完成しました！",...(at?["（コンプリート日時：",`${dateLabel(at)}）`]:[])):got?`あと ${RIVER_TOTAL-got} 個で川が完成します。`:"スタンプを集めるとお魚が泳ぎはじめるよ。";
  // コンプリート（お魚が全部そろった）ときだけ、川の左上に、バナーと日時を出し、「完成画像を保存」を出す
  $("riverBadge").hidden=!complete; $("riverActions").hidden=!complete;
  $("riverBadgeDate").textContent=at?dateLabel(at):"";
  if(complete&&fx.kind==="new"&&stamps.length===RIVER_TOTAL) replay($("riverBadge"),"is-new");
}

// ---- コンプリートの日時・完成画像の保存 ----
// 日時は、6個目のスタンプを取った時刻（端末に保存している獲得時刻）。時刻が残っていないスタンプ（古い記録）のときは、出さない。
const dateLabel=iso=>{
  const d=new Date(iso), two=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const completeTime=stamps=>stamps.length>=RIVER_TOTAL?stampTime(stamps[RIVER_TOTAL-1]):null;
// 保存する画像の、バナー・日時の位置と大きさ（川の背景の画像 1500×629 に対する px）。rally/style.css の .river-badge と、同じ位置・大きさにする
const COMPLETE_LAYOUT={banner:{x:36,y:24,w:405},text:{x:471,labelSize:29.5,dateSize:36,gap:3.6,lineHeight:1.25}};
const COMPLETE_BANNER="../assets/banner-rally.webp";
const loadImg=src=>new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error(`画像を読み込めません：${src}`)); img.src=src; });

// 完成した川の画像（PNG）を、この端末の中で作る：背景＋お魚＋バナー＋日時。サーバーには、何も送らない
async function makeCompleteImage(){
  const {width:W,height:H}=Fish.scene;
  const stamps=await getLocalStamps();
  const keys=fishOrder.slice(0,Math.min(stamps.length,RIVER_TOTAL));
  const at=completeTime(stamps);
  const [scene,banner,...layers]=await Promise.all([loadImg(Fish.url(Fish.scene.file)),loadImg(COMPLETE_BANNER),...keys.map(k=>loadImg(Fish.url(FISH[k].layer)))]);
  try{ await Promise.race([Promise.all([document.fonts.load('700 30px "Josefin Sans"'),document.fonts.ready]),sleep(1500)]); } catch(error){ /* フォントが読めなくても、代わりのフォントで作る */ }
  const canvas=document.createElement("canvas"); canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,W,H);       // 背景の角の透明な部分は、白にする（共有先で黒く見えないように）
  ctx.drawImage(scene,0,0,W,H);
  layers.forEach(img=>ctx.drawImage(img,0,0,W,H));
  const L=COMPLETE_LAYOUT, bw=L.banner.w, bh=bw*banner.naturalHeight/banner.naturalWidth;
  ctx.drawImage(banner,L.banner.x,L.banner.y,bw,bh);
  const t=L.text, color=getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()||"#30557e";
  const ja=getComputedStyle(document.body).fontFamily||"sans-serif";
  ctx.fillStyle=color; ctx.textAlign="left"; ctx.textBaseline="middle";
  const centerY=L.banner.y+bh/2;
  const blockH=at?(t.labelSize+t.dateSize)*t.lineHeight+t.gap:t.labelSize*t.lineHeight, top=centerY-blockH/2;
  ctx.font=`700 ${t.labelSize}px "Josefin Sans", ${ja}`;
  try{ ctx.letterSpacing=`${(t.labelSize*.14).toFixed(1)}px`; } catch(error){ /* 未対応のブラウザでは、文字の間隔なし */ }
  ctx.fillText("COMPLETE!",t.x,top+t.labelSize*t.lineHeight/2);
  if(at){
    try{ ctx.letterSpacing="0px"; } catch(error){ /* 同上 */ }
    ctx.font=`700 ${t.dateSize}px ${ja}`;
    ctx.fillText(dateLabel(at),t.x,top+t.labelSize*t.lineHeight+t.gap+t.dateSize*t.lineHeight/2);
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("画像を作れませんでした")),"image/png"));
}

// ---- お魚図鑑：まだ獲得していないお魚はシルエット、獲得したお魚は色つきの絵 ----
// カードの番号は、スタンプを取る順番（お魚が増えていく順番）です。
function renderStamps(stamps,fx){
  const got=Math.min(stamps.length,RIVER_TOTAL);
  $("bookCount").textContent=`${got} / ${RIVER_TOTAL}`;
  $("stamps").innerHTML=fishOrder.map((key,i)=>{
    const f=FISH[key], has=i<got, code=stamps[i], state=has&&fx.code===code?` is-${fx.kind}`:"";
    const at=has?stampTime(code):null;
    const label=`${pad2(i+1)} ${has?`${f.name}（獲得済み）`:"未獲得"}`;
    return `<div class="stamp${has?" got":""}${state}" role="group" aria-label="${esc(label)}">
      <span class="stamp-no">${pad2(i+1)}</span>
      <span class="stamp-fish"><img src="${esc(Fish.url(has?f.stamp:f.silhouette))}" width="${f.width}" height="${f.height}" alt="" draggable="false"></span>
      <strong>${has?esc(f.name):"？"}</strong>
      <small>${has?(at?formatTime(at):"獲得済み"):"未獲得"}</small>
    </div>`;
  }).join("");
}

// ---- 掲示板のある場所（js/rally-data.js の登録内容） ----
// 住所・座標・検索語のどれもない場所には、地図のリンクを出しません（場所を推測しません）。
const MAPS="https://www.google.com/maps";
function mapTarget(place){
  const hasNum=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
  if(hasNum(place.lat)&&hasNum(place.lng)){
    const lat=Number(place.lat), lng=Number(place.lng);
    if(Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)) return {query:`${lat},${lng}`};
  }
  const text=String(place.mapQuery||place.address||"").trim();
  return text?{query:text}:null;
}
const mapUrls=t=>({
  view:`${MAPS}/search/?api=1&query=${encodeURIComponent(t.query)}`,
  route:`${MAPS}/dir/?api=1&destination=${encodeURIComponent(t.query)}&travelmode=walking`,
  embed:`${MAPS}?q=${encodeURIComponent(t.query)}&z=17&output=embed&hl=ja`
});
// Googleマイマップ：管理画面の「公開の設定」で入力したURL（rally_config が返す）だけを、埋め込む。
// 次の形でなければ、無視する（sql/schema.sql の rally_valid_mymap_url と、同じ形にする）。
const MYMAP_EMBED_OK=/^https:\/\/www\.google\.com\/maps\/d\/embed\?mid=[A-Za-z0-9_-]{8,100}(&ll=-?[0-9]{1,3}(\.[0-9]{1,12})?,-?[0-9]{1,3}(\.[0-9]{1,12})?)?(&z=[0-9]{1,2})?$/;
const mymapViewUrl=embed=>embed.replace("/maps/d/embed?","/maps/d/viewer?");   // 「すべての掲示板の地図を開く」のボタン用（同じ地図を、Googleマイマップで開く）

const mapFrame=(url,title)=>`<iframe src="${esc(url)}" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
const mapButtonLabel=(name,open)=>`${name}の地図を${open?"閉じる":"表示"}`;

function buildPlaces(mymapUrl){
  const places=(Array.isArray(window.RALLY_PLACES)?window.RALLY_PLACES:[]).filter(p=>p&&typeof p==="object");
  const preview=window.RALLY_PLACES_PREVIEW!==false;
  const showMap=preview&&window.RALLY_PLACES_PREVIEW_OPEN===true; // true：最初から地図を表示する（画面の近くまで来たときに読み込む）
  const embedUrl=typeof mymapUrl==="string"&&MYMAP_EMBED_OK.test(mymapUrl)?mymapUrl:"";   // 管理画面で入力したマイマップ（なければ、何も表示しない）
  const viewUrl=embedUrl?mymapViewUrl(embedUrl):"";
  const hasEmbed=!!embedUrl, hasView=!!viewUrl;
  const info=places.map((p,i)=>({name:String(p.name||"").trim()||`場所 ${i+1}`,desc:String(p.description||"").trim(),target:mapTarget(p)}));
  const anyInfo=info.some(x=>x.desc||x.target)||hasEmbed||hasView;

  // すべての掲示板をまとめた地図（Googleマイマップ）
  const embedBox=$("placesEmbed");
  embedBox.innerHTML=hasEmbed?mapFrame(embedUrl,"すべての掲示板の地図（Googleマイマップ）"):"";
  embedBox.hidden=!hasEmbed;

  $("placeList").innerHTML=(anyInfo?"":`<li class="place-lead small">掲示板の場所は準備ができしだいここに表示されます。</li>`)+info.map(({name,desc,target},i)=>{
    const label=esc(name), urls=target&&mapUrls(target);
    let body="";
    if(desc) body+=`<p class="place-desc">${esc(desc)}</p>`;
    if(target){
      body+=`<div class="place-actions">
        <a class="btn" href="${esc(urls.view)}" target="_blank" rel="noopener noreferrer" aria-label="${label}：Googleマップで場所を見る"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-pin"></use></svg>Googleマップで場所を見る</a>
        <a class="btn sub" href="${esc(urls.route)}" target="_blank" rel="noopener noreferrer" aria-label="${label}：ここへの行き方（Googleマップ）"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-route"></use></svg>ここへの行き方</a>
        ${preview?`<button type="button" class="btn sub" data-map-toggle aria-expanded="${showMap}" aria-label="${esc(mapButtonLabel(name,showMap))}">${showMap?"地図を閉じる":"地図を表示"}</button>`:""}
      </div><div class="place-map"${showMap?"":" hidden"}>${showMap?mapFrame(urls.embed,`${name}の地図`):""}</div>`;
    } else if(anyInfo){
      body+=`<p class="place-desc pending">${desc?"地図は準備中です。":"場所は準備中です。"}</p>`;
    }
    return `<li class="place" data-name="${esc(name)}"${target?` data-embed="${esc(urls.embed)}"`:""}>
      <div class="place-head"><span class="place-seal">${icon("pin")}</span><span class="place-name">${label}</span></div>${body}</li>`;
  }).join("");

  const overviewBox=$("placesOverview");
  if(hasView){
    overviewBox.innerHTML=`<a class="btn sub" href="${esc(viewUrl)}" target="_blank" rel="noopener noreferrer"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-pin"></use></svg>すべての掲示板の地図を開く</a>`;
    overviewBox.hidden=false;
  } else overviewBox.hidden=true;
}
// 掲示板の地図（「掲示板のある場所」）：管理画面の「公開の設定」で「公開する」にしている間だけ表示する。
// 公開していないとき（設定がないとき・読み込めないときも）は、何も作らない（Googleにも接続しない）。
let placesKey="";
function applyPlaces(config){
  const open=!!config&&config.places_public===true;
  const url=open&&typeof config.mymap_embed_url==="string"?config.mymap_embed_url:"";
  const key=open?`1|${url}`:"0";
  if(key===placesKey) return;   // 変わっていないときは、作り直さない（地図の位置が、もとに戻らないように）
  placesKey=key;
  if(!open){
    $("placesEmbed").innerHTML=""; $("placeList").innerHTML=""; $("placesOverview").innerHTML="";
    $("placesCard").hidden=true;
    return;
  }
  buildPlaces(url);
  $("placesCard").hidden=false;
}

// 開催開始日（管理画面の「公開の設定」）：バナーの下に出す。入力がないとき（形が正しくないときも）は、何も出さない
const WEEKDAYS=["日","月","火","水","木","金","土"];
function startDateLabel(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
  if(!m) return null;
  const y=+m[1], mo=+m[2], d=+m[3], date=new Date(y,mo-1,d);
  if(date.getFullYear()!==y||date.getMonth()!==mo-1||date.getDate()!==d) return null;   // 2月31日のような、ない日付は出さない
  return `${y}年${mo}月${d}日（${WEEKDAYS[date.getDay()]}）`;
}
// 開催の状態（rally_config の phase）：'before'（開催前）／'open'（開催中）／'closed'（終了）。期間は、管理画面の「公開の設定」の、開催開始日・開催終了日で決まる。
// 期間の設定がない古いSQLのときは、rally_ongoing だけで判断する（true なら開催中。そうでなければ、開催前）。設定が読めなかったとき（config が null）は、どれも出さない
function phaseOf(config){
  if(!config) return null;
  if(config.phase==="before"||config.phase==="open"||config.phase==="closed") return config.phase;
  return config.rally_ongoing===true?"open":"before";
}
// バナーの下：開催前は「開催開始日」（入力があるときだけ）・開催中は「開催中！」・開催終了のあとは「開催は終了しました」
function applyStartDate(config){
  const phase=phaseOf(config);
  const label=startDateLabel(config&&config.start_date), box=$("startDate");
  $("ongoing").hidden=phase!=="open";
  $("ended").hidden=phase!=="closed";
  if(phase!=="before"||!label){ box.hidden=true; return; }
  const time=$("startDateValue");
  time.textContent=label; time.setAttribute("datetime",config.start_date);
  box.hidden=false;
}
function applyPublicInfo(config){ applyStartDate(config); applyPlaces(config); }

// 地図の表示／非表示：ボタンを押したときに、Googleマップを読み込む（または取り除く）
$("placeList").addEventListener("click",e=>{
  const button=e.target.closest("[data-map-toggle]"); if(!button) return;
  const item=button.closest(".place"), box=item.querySelector(".place-map"), name=item.dataset.name;
  const open=box.hidden;
  box.innerHTML=open?mapFrame(item.dataset.embed,`${name}の地図`):"";
  box.hidden=!open;
  button.textContent=open?"地図を閉じる":"地図を表示";
  button.setAttribute("aria-label",mapButtonLabel(name,open));
  button.setAttribute("aria-expanded",String(open));
});

// ---- 読み取り結果パネル ----
const resultEl=document.getElementById("scanResult");
let resultState=null;
const SYNC_TEXT={
  saving:"サーバーに記録しています…",
  saved:"サーバーに記録しました",
  failed:"サーバーに記録できませんでした",
  demo:"デモモード：この端末にのみ保存しています",
  debug:"デバッグ中：この端末にのみ保存しています（サーバーには記録しません）"
};

// state: {tone:"new"|"again"|"complete"|"info"|"error", seal:"check"|null, kicker, title, body, sync, surveyReady}
function showResult(state){
  resultState=state;
  drawResult(false);
}
function updateResult(patch){
  if(!resultState) return;
  Object.assign(resultState,patch);
  drawResult(true);
}
function drawResult(settled){
  const s=resultState, pending=getPending().length>0;
  const fishSeal=s.fish&&FISH[s.fish]
    ? `<span class="sr-seal has-fish" aria-hidden="true"><img src="${esc(Fish.url(FISH[s.fish].stamp))}" alt="" draggable="false"></span>`
    : `<span class="sr-seal" aria-hidden="true">${s.seal ? icon(s.seal) : "!"}</span>`;
  let error="";
  if(s.sync==="failed"){
    error = pending
      ? `<div class="sr-error"><strong>通信できませんでした</strong>
          <p>スタンプはこの端末に保存されています。電波の良い場所で「再送する」を押してください。押さなくても次にこのページを開いたときに自動で再送します。${s.tone==="complete"?"<br>アンケートは記録が完了すると表示されます。":""}</p>
          <button type="button" class="sr-retry">再送する</button></div>`
      : `<div class="sr-error"><strong>読み取りの記録を送信できませんでした</strong>
          <p>スタンプは獲得済みなのでこのままで問題ありません。</p></div>`;
  }
  resultEl.dataset.tone=s.tone;
  resultEl.classList.toggle("settled",settled);
  resultEl.innerHTML=`
    <div class="sr-main">
      ${fishSeal}
      <div>
        <p class="sr-kicker">${s.kicker}</p>
        <p class="sr-title">${s.title}</p>
        ${s.body?`<p class="sr-body">${s.body}</p>`:""}
      </div>
    </div>
    <button type="button" class="sr-close" aria-label="閉じる">×</button>
    ${s.sync?`<p class="sr-sync" data-state="${s.sync}">${SYNC_TEXT[s.sync]}</p>`:""}
    ${error}
    ${s.surveyReady?`<a class="sr-cta" href="${surveyUrl()}">アンケートに進む</a>`:""}`;
  resultEl.hidden=false;
  resultEl.querySelector(".sr-close").onclick=()=>{ resultEl.hidden=true; };
  const retry=resultEl.querySelector(".sr-retry");
  if(retry) retry.onclick=retryPending;
}

// ---- ポップアップ：スタンプを獲得した瞬間の演出（後光つき）と、ルール説明 ----
// どちらも <dialog> です。<dialog> に未対応の古いブラウザでは、ポップアップは出さず、ほかの表示だけで進みます。
const getDialog=$("getDialog"), rulesDialog=$("rulesDialog"), saveDialog=$("saveDialog"), phaseDialog=$("phaseDialog");
const supportsDialog=dlg=>!!dlg&&typeof dlg.showModal==="function";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// ハンバーガーのメニュー（js/site-nav.js）が開いている間は、自動で出すポップアップを待たせる（メニューを閉じたら、出す）。
// 開いたまま出すと、ポップアップが、メニューの暗い背景に隠れて、どこも操作できなくなってしまう。
const menuClosed=()=>window.SiteNav&&window.SiteNav.isOpen()?window.SiteNav.whenClosed():Promise.resolve();
// 自動で出すポップアップ（獲得の演出・ルール説明）と、「完成画像」は、メニューだけでなく、ほかのポップアップ（景品について・ルール説明など）が開いている間も、閉じるまで待つ
// （ポップアップが、2つ重なって開かないように）。待っている間に、また何かが開いたときのため、閉じたあと、もう一度、確かめる。
const otherDialogs=()=>[getDialog,rulesDialog,saveDialog,phaseDialog,window.PrizeInfo&&window.PrizeInfo.element()].filter(d=>d&&d.open);
async function waitForQuiet(){
  for(;;){
    await menuClosed();
    const open=otherDialogs();
    if(!open.length) return;
    await new Promise(resolve=>open[0].addEventListener("close",resolve,{once:true}));
  }
}
function openDialog(dlg){
  try{ dlg.showModal(); document.documentElement.classList.add("modal-open"); return true; }
  catch(error){ console.error(error); return false; }
}
// 閉じたら（Escキー・×・OKのどれでも）、ページのスクロールを元に戻す
[getDialog,rulesDialog,saveDialog,phaseDialog].forEach(dlg=>dlg.addEventListener("close",()=>document.documentElement.classList.remove("modal-open")));

// 獲得の演出が終わるまで待つための記録。演出を出したら、その Promise（閉じたら true になる）に入れ替える
let celebration=Promise.resolve(false);

// スタンプのまわりに飛び散る星と丸。角度をずらして並べるので、毎回、同じ形になる。dx・dy は、スタンプの直径に対する距離
function burstHtml(count){
  const colors=["var(--color-mustard)","var(--color-white)","var(--color-accent)"], sizes=[9,13,17];
  return Array.from({length:count},(_,i)=>{
    const angle=i*137.508*Math.PI/180, far=.85+((i*.382)%1)*.95;
    const dx=(Math.cos(angle)*far).toFixed(2), dy=(Math.sin(angle)*far).toFixed(2);
    const turn=(i%2?1:-1)*(120+(i*37)%200), delay=(.5+(i%5)*.03).toFixed(2);
    return `<i class="${i%2?"":"star"}" style="--dx:${dx};--dy:${dy};--s:${sizes[i%3]+(i%2?0:4)}px;--c:${colors[i%3]};--d:${delay}s;--r:${turn}deg"></i>`;
  }).join("");
}

// message：scanMessage の結果（新しいスタンプのもの）、n：何個目か。画面を閉じたら true になる Promise を返す（出せなかったときは false）
async function celebrate(message,n){
  const dlg=getDialog, f=FISH[message.fish];
  if(!supportsDialog(dlg)||dlg.open||!f) return false;
  const big=n===PRIZE_REQUIRED||n===RIVER_TOTAL;   // 景品の条件の達成（3個目）・川の完成（6個目）は、飾りを増やす
  dlg.querySelector(".get-stage").dataset.tone=big?"complete":"new";
  $("getBadge").textContent=n===RIVER_TOTAL?"COMPLETE!":n===PRIZE_REQUIRED?"ACHIEVED!":"GET!";
  const img=$("getFish");
  img.src=Fish.url(f.stamp); img.width=f.width; img.height=f.height;
  $("getKicker").textContent=message.kicker;
  $("getTitle").innerHTML=big?message.title:phrases(`「${f.name}」を`,"ゲット！");
  $("getBody").textContent=message.body;
  $("getPips").innerHTML=Array.from({length:RIVER_TOTAL},(_,i)=>`<i class="${i<n?"on":""}${i===n-1?" is-new":""}"></i>`).join("");
  $("getBurst").innerHTML=burstHtml(big?46:26);
  dlg.classList.remove("is-leaving");
  await waitForQuiet();   // メニュー・ほかのポップアップが開いている間は、閉じるまで待つ
  if(dlg.open||!openDialog(dlg)) return false;
  return new Promise(resolve=>{
    const openedAt=Date.now();
    let leaving=false;
    // 画面のどこをタップしても閉じる。ただし、QRコードを読み取った直後の指の動きや、連打で、演出が途中で消えてしまわないよう、
    // 演出の見せ場（後光・札・文字のカード・ゲージ）が出そろう、最初の1.4秒は無視する
    const dismiss=()=>{
      if(leaving||Date.now()-openedAt<1400) return;
      leaving=true;
      dlg.classList.add("is-leaving");
      setTimeout(()=>{ if(dlg.open) dlg.close(); },220);
    };
    dlg.onclick=dismiss;
    $("getOk").onclick=event=>{ event.stopPropagation(); dismiss(); };
    dlg.addEventListener("close",()=>{ dlg.classList.remove("is-leaving"); resolve(true); },{once:true});
  });
}

// 演出の画面が閉じたあとに、ページの中の動き（数字・ゲージ・川のお魚・図鑑のカード）を、もういちど見せる
// （はじめの動きは、演出の画面の裏で終わってしまい、見えないため）
function replayFx(){
  const q=selector=>document.querySelector(selector);
  replay($("progressBanner"),"is-new"); replay($("count"),"bump"); replay($("remain"),"bump");
  [q("#bannerBar .seg.is-new"),q("#riverFish img.is-new"),q("#stamps .stamp.is-new"),q("#riverBadge.is-new")].forEach(el=>{ if(el) replay(el,"is-new"); });
}

// ---- 開催の期間の外（開催前・開催終了のあと）のお知らせ ----
// スタンプのQRコードを、開催の期間の外で読み取ったとき（サーバー（record_scan）が 'not_open'・'closed' を返したとき）に出すポップアップ。
// スタンプは、もらえない（サーバーには、何も記録されない）。ページは、そのまま見られる。管理画面の「開催の状態」から、確認用の表示（?preview=before ・ ?preview=ended）も開ける。
// 日時は、端末の時間帯に関係なく、日本時間で出す。
const JST_PARTS=typeof Intl!=="undefined"&&Intl.DateTimeFormat?new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",hourCycle:"h23"}):null;
function jstParts(value){
  const d=new Date(value);
  if(!value||Number.isNaN(d.getTime())||!JST_PARTS) return null;
  const p={}; JST_PARTS.formatToParts(d).forEach(x=>{ p[x.type]=x.value; });
  return {y:+p.year,mo:+p.month,d:+p.day,h:+p.hour%24,mi:+p.minute};   // 午前0時を「24時」と出す環境があるので、24 で割った余りにする
}
const jstDate=p=>`${p.y}年${p.mo}月${p.d}日（${WEEKDAYS[new Date(Date.UTC(p.y,p.mo-1,p.d)).getUTCDay()]}）`;
const jstTime=p=>`${p.h}:${pad2(p.mi)}`;
// 設定が読み込めなかったとき（確認用の表示など）に使う、初期の期間（sql/schema.sql の rally_open_at・rally_close_at の初期値と同じ）
const DEFAULT_OPEN="2026-12-09T00:00:00+09:00", DEFAULT_CLOSE="2027-01-01T00:00:00+09:00";
// kind："before"（開催前）／"closed"（終了）。forced：管理画面の手動の切り替え（30分だけ）によるもので、時刻どおりの開催前・終了ではない
// lead（太い見出しの文）・notes（説明の文。1つが1行分）は、文節ごとに分けた配列（画面では、文節の区切りでだけ折り返す。「ありがとうございま／した」のような改行を防ぐ）
function phaseCopy(kind,{forced=false,opensAt=null,closesAt=null}={}){
  if(forced) return {kicker:"PLEASE WAIT",title:"ただいまお休み中です",lead:["いまは","スタンプを受け付けていません。"],notes:[["しばらくしてから","もういちど","掲示板のQRコードを読み取ってね。"]]};
  if(kind==="before"){
    const opens=jstParts(opensAt);
    return {kicker:"COMING SOON",title:"開催まで待ってね",
      lead:opens?["スタンプラリーは",`${jstDate(opens)}${jstTime(opens)}から`,"はじまるよ。"]:["スタンプラリーは","まだはじまっていないよ。"],
      notes:[["それまでは","スタンプをゲットできません。","はじまったら","もういちど","掲示板のQRコードを読み取ってね！"],["このページでは","ルールや","お魚図鑑を見られます。"]]};
  }
  // 開催終了日の 23:59:59 まで開催なので、終了の日は、終了の日時の1秒前
  const ends=closesAt?jstParts(new Date(new Date(closesAt).getTime()-1000)):null;
  return {kicker:"THANK YOU",title:"開催終了しました",lead:["たくさんのご参加","ありがとうございました！"],
    notes:[ends?["スタンプラリーは",`${jstDate(ends)}で`,"終了しました。"]:["スタンプラリーは","終了しました。"],["これまでに集めたお魚は","このページで見られます。"]]};
}
// 閉じたら（×・とじる・外側のタップ・Esc のどれでも）解決する Promise を返す。出せなかったときも、すぐに解決する。
// 戻り値は、いつも false（お魚の演出ではないので、閉じたあとの「ページの中の動き」の見せ直しは、いらない）
async function showPhase(kind,opts={}){
  const c=phaseCopy(kind,opts), chunks=parts=>phrases(...parts.map(esc));
  if(!supportsDialog(phaseDialog)){   // <dialog> に未対応の古いブラウザ：結果の欄に出す
    showResult({tone:"info",seal:null,kicker:c.kicker,title:esc(c.title),body:esc([c.lead.join(""),...c.notes.map(n=>n.join(""))].join(" "))});
    return false;
  }
  $("phaseKicker").textContent=c.kicker; $("phaseTitle").textContent=c.title;
  $("phaseLead").innerHTML=chunks(c.lead);
  $("phaseNote").innerHTML=c.notes.map(chunks).join("<br>");
  $("phasePreview").hidden=!opts.preview;
  await waitForQuiet();   // メニュー・ほかのポップアップが開いている間は、閉じるまで待つ
  if(phaseDialog.open||!openDialog(phaseDialog)) return false;
  phaseDialog.querySelector(".rules-body").scrollTop=0;
  await new Promise(resolve=>phaseDialog.addEventListener("close",resolve,{once:true}));
  return false;
}
$("phaseOk").onclick=$("phaseX").onclick=()=>{ if(phaseDialog.open) phaseDialog.close(); };
phaseDialog.addEventListener("click",event=>{ if(event.target===phaseDialog) phaseDialog.close(); });
// 管理画面の「開催の状態」からの確認用の表示（?preview=before ・ ?preview=ended）：設定の日時を使って、同じ画面を出す。スタンプは、もらえない
const previewKinds={before:"before",ended:"closed"};
const phaseDates=()=>({opensAt:lastConfig&&lastConfig.open_at||DEFAULT_OPEN,closesAt:lastConfig&&lastConfig.close_at||DEFAULT_CLOSE});

// ルール説明。「次回からは表示しない」は、端末に保存する（参加者IDと同じしくみ）。保存できない端末では、チェック欄を出さない
const rulesHidden=()=>store.get(rulesKey)==="1";
async function showRules(){
  const dlg=rulesDialog;
  if(!supportsDialog(dlg)||dlg.open) return;
  await waitForQuiet();   // メニュー・ほかのポップアップが開いている間は、閉じるまで待つ
  if(dlg.open) return;
  $("rulesHide").checked=rulesHidden();
  $("rulesHideRow").hidden=storageBlocked;
  dlg.querySelector(".rules-body").scrollTop=0;
  if(!openDialog(dlg)) return;
  await new Promise(resolve=>dlg.addEventListener("close",resolve,{once:true}));
}
$("rulesHide").addEventListener("change",event=>{
  if(event.target.checked) store.set(rulesKey,"1"); else store.remove(rulesKey);
});
$("rulesClose").onclick=$("rulesOk").onclick=()=>{ if(rulesDialog.open) rulesDialog.close(); };
// ポップアップの外（暗い部分）をタップしても閉じる
rulesDialog.addEventListener("click",event=>{ if(event.target===rulesDialog) rulesDialog.close(); });
$("rulesOpen").onclick=()=>showRules();

// 完成画像の保存：「完成画像を保存」を押すと、画像を作って、ポップアップに見せる。「保存する」で、保存する
// （スマートフォンは、共有の画面を開く＝「画像を保存」などを選べる。それ以外は、ダウンロード。画像を長押しして、保存することもできる）
let saveBlob=null, saveUrl="";
function releaseSaveImage(){
  if(saveUrl) URL.revokeObjectURL(saveUrl);
  saveUrl=""; saveBlob=null;
  $("saveImage").removeAttribute("src");
}
async function downloadOrShare(){
  if(!saveBlob) return;
  const name="sukima-kids-lab-complete.png";
  const file=typeof File==="function"?new File([saveBlob],name,{type:"image/png"}):null;
  const touch=!!(window.matchMedia&&matchMedia("(pointer:coarse)").matches);
  if(file&&touch&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],title:"すきまキッズラボ スタンプラリー"}); return; }
    catch(error){ if(error&&error.name==="AbortError") return; console.error(error); }   // 共有できなかったときは、ダウンロードにする
  }
  const link=document.createElement("a");
  link.href=saveUrl; link.download=name;
  document.body.append(link); link.click(); link.remove();
}
async function openSave(){
  const dlg=saveDialog;
  if(dlg.open) return;
  $("saveBusy").hidden=false; $("saveImage").hidden=true; $("saveError").hidden=true; $("saveDo").disabled=true;
  const modal=supportsDialog(dlg);
  if(modal){ await waitForQuiet(); if(dlg.open||!openDialog(dlg)) return; }
  try{
    const blob=await makeCompleteImage();
    releaseSaveImage();
    saveBlob=blob; saveUrl=URL.createObjectURL(blob);
    const img=$("saveImage");
    img.width=Fish.scene.width; img.height=Fish.scene.height;
    img.alt="完成した川の画像（すきまキッズラボ スタンプラリー）";
    img.src=saveUrl; img.hidden=false;
    $("saveBusy").hidden=true; $("saveDo").disabled=false;
    if(!modal) await downloadOrShare();   // ポップアップに未対応の古いブラウザでは、見せずに、そのまま保存する
  } catch(error){
    console.error(error);
    $("saveBusy").hidden=true; $("saveError").hidden=false;
  }
}
$("saveRiver").onclick=openSave;
$("saveDo").onclick=downloadOrShare;
$("saveClose").onclick=$("saveX").onclick=()=>{ if(saveDialog.open) saveDialog.close(); };
saveDialog.addEventListener("click",event=>{ if(event.target===saveDialog) saveDialog.close(); });
saveDialog.addEventListener("close",releaseSaveImage);

// 読み取った結果の文言。again＝すでに取得済み。新しいスタンプでは、そのスタンプで現れたお魚（fish）の名前と絵を出す
function scanMessage({code,again,current}){
  const total=RIVER_TOTAL, n=current.length;
  if(again){
    const at=stampTime(code);
    return {tone:"again",seal:"check",kicker:"獲得済み",title:phrases("この掲示板は","すでに","獲得しています"),
      body:`${at?`${formatTime(at)} に獲得したスタンプです。`:""}スタンプの数は変わりません（${n}個）。`};
  }
  if(n>total){   // 川が完成したあとに取ったスタンプ（記録はされるが、お魚は増えない）
    return {tone:"new",seal:"check",kicker:`NEW STAMP · ${pad2(n)}`,title:phrases("スタンプを","記録しました"),body:`川はすでに完成しています（合計${n}個）。`};
  }
  const key=fishOrder[n-1], name=FISH[key].name, kicker=`NEW STAMP · ${pad2(n)}`;
  if(n===total) return {tone:"complete",fish:key,kicker:`COMPLETE · ${n} / ${total}`,title:phrases("川が","完成しました！"),body:`「${name}」が加わって${total}種類のお魚がそろいました。`};
  if(n===PRIZE_REQUIRED) return {tone:"complete",fish:key,kicker:`ACHIEVED · ${n} / ${total}`,title:phrases("景品をゲットできる","条件を達成しました！"),
    body:`「${name}」が仲間になりました。アンケートでオリジナルマステプレゼントの申し込みを受け付けています。あと ${total-n} 個で川が完成します。`};
  if(n>PRIZE_REQUIRED) return {tone:"new",fish:key,kicker,title:phrases(`「${name}」を`,"獲得しました"),body:`景品をゲットできる条件は達成済みです。あと ${total-n} 個で川が完成します。`};
  return {tone:"new",fish:key,kicker,title:phrases(`「${name}」を`,"獲得しました"),body:`あと ${PRIZE_REQUIRED-n} 個で景品をゲットできます。`};
}
const invalidMessage=()=>({tone:"info",seal:null,kicker:"QRコード",title:phrases("このQRコードは","登録されていません"),
  body:"掲示板に貼ってあるスタンプラリーのQRコードを読み取ってください。"});

// ---- 端末内の保存 ----
async function getLocalStamps(){
  return readStampList(stampsKey);
}

function getStampTimes(){
  try{
    const value=JSON.parse(store.get(timesKey)||"{}");
    return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  }catch(error){ return {}; }
}
// 保存された獲得時刻（日時として読めないものは、無いものとして扱う）
const stampTime=code=>{
  const t=getStampTimes();
  return hasOwn(t,code)&&typeof t[code]==="string"&&!Number.isNaN(Date.parse(t[code]))?t[code]:null;
};

async function saveLocalStamp(code){
  const current=await getLocalStamps();
  if(!current.includes(code)){
    current.push(code);
    store.set(stampsKey,JSON.stringify(current));
    store.set(timesKey,JSON.stringify({...getStampTimes(),[code]:new Date().toISOString()}));
  }
  return current;
}

// サーバーが「登録されていないQRコード」と判断したスタンプを、端末の記録から取り除く
function removeLocalStamp(code){
  const list=readStampList(stampsKey).filter(c=>c!==code);
  store.set(stampsKey,JSON.stringify(list));
  const times={...getStampTimes()}; delete times[code];
  store.set(timesKey,JSON.stringify(times));
  return list;
}

// ---- Supabase ----
function isSupabaseConfigured(){
  const url=window.SUPABASE_URL, key=window.SUPABASE_ANON_KEY;
  return url && !url.startsWith("YOUR_") && key && !key.startsWith("YOUR_");
}
// スタンプ・リセット・アンケートについて、サーバーと通信するか（デバッグモードの間は、しない。設定（rally_config）を読み込むだけ）
const serverOn=()=>isSupabaseConfigured()&&!debugOn;

// 通信が止まったままにならないよう、一定時間で打ち切る（その場合は、端末に保存して、あとで再送する）
const RPC_TIMEOUT_MS=10000;
async function callRpc(name,body){
  const controller=typeof AbortController==="function"?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),RPC_TIMEOUT_MS):null;
  try{
    const response=await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/${name}`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":window.SUPABASE_ANON_KEY,
        "Authorization":`Bearer ${window.SUPABASE_ANON_KEY}`
      },
      body:JSON.stringify(body),
      signal:controller?controller.signal:undefined
    });
    if(!response.ok) throw new Error(await response.text());
    return await response.json();
  } finally{
    if(timer) clearTimeout(timer);
  }
}

// 管理画面で、この参加者のスタンプがリセットされた回数を、この端末が最後に確かめた値（確かめていなければ 0）。
// 参加者IDと一緒に保存する（端末のデータを消して、別のIDになったあとに、前のIDの回数が残らないように）
const localResetCount=()=>{
  try{ const saved=JSON.parse(store.get(resetKey)||"null"); return saved&&saved.id===participantId?Number(saved.count)||0:0; }
  catch(error){ return 0; }
};
const saveResetCount=count=>store.set(resetKey,JSON.stringify({id:participantId,count}));

// 管理画面の「完全リセット」：この端末に保存された、サイトの履歴を、すべて消して、はじめて開いたときの状態（新しい参加者）で開き直す。
// 「次回からは表示しない」の設定・参加者ID・スタンプ・アンケート回答済みの印など、すべてが消える（reset/ ページと同じ）。
// 開き直したあとに知らせを出すため、消したあとの sessionStorage に印を付ける（知らせを出したら、印を消す）。
// keepStamp：QRコードを読み取った直後だったときは、そのスタンプのURLで開き直して、新しい参加者の最初のスタンプとして記録する
const fullResetNoticeKey="full_reset_notice";
function wipeDevice(keepStamp=""){
  wiping=true;
  try{ localStorage.clear(); }catch(e){ /* 保存できない設定のブラウザでは、メモリ上の記録だけが、あった */ }
  try{ sessionStorage.clear(); sessionStorage.setItem(fullResetNoticeKey,"1"); }catch(e){ /* 知らせが出ないだけ */ }
  memoryStore.clear();
  location.replace(location.pathname+(keepStamp?`?stamp=${encodeURIComponent(keepStamp)}`:""));
}

// サーバー側の、この参加者の状態：{count: リセットされた回数, full: 最後の完全リセットの時点の回数, surveyDone: アンケートの回答がサーバーにあるか（旧い関数では null）}
// 新しい関数（rally_reset_state）がまだない（SQL未実行）、または、通信に失敗したときは、旧い関数（rally_reset_count）で、回数だけを確かめる。
async function fetchResetState(){
  try{
    const state=await callRpc("rally_reset_state",{p_participant_id:participantId});
    if(state&&typeof state==="object") return {count:Number(state.reset_count),full:Number(state.full_reset_count)||0,surveyDone:state.survey_submitted===true};
  } catch(error){
    console.error(error);
  }
  return {count:Number(await callRpc("rally_reset_count",{p_participant_id:participantId})),full:0,surveyDone:null};
}

// 有効なQRコードか、初回取得か再スキャンかは、サーバー側（record_scan）で判定・記録されます。
// 戻り値：{status:"ok"|"invalid_stamp"|"reset", claimed, claim_sequence, completed, stamps, reset_count}
// "reset"：管理者がスタンプをリセットしたのに、この端末の記録が古い（サーバーは何も記録しない）。applyReset で端末の記録を消す。
async function recordServerScan(code,resend=false){
  const rows=await callRpc("record_scan",{
    p_participant_id:participantId,
    p_stamp_code:code,
    // 通信失敗後の再送は管理画面で見分けられるよう印を付けます。
    p_user_agent:navigator.userAgent+(resend?" [resend]":""),
    // リセット前の記録を持った端末が、スタンプを送り直して、リセットを無効にしてしまわないように、確かめた回数を一緒に送る
    p_reset_count:localResetCount()
  });
  const row=Array.isArray(rows)?rows[0]:null;
  if(!row) throw new Error("record_scan: 結果が空です");
  return row;
}

async function isServerCompleted(){
  return (await callRpc("is_completed",{p_participant_id:participantId}))===true;
}

// サーバーへの記録に失敗したスタンプ（次回表示時に再送します）
function getPending(){
  return readStampList(pendingKey);
}
function setPending(list){
  if(list.length) store.set(pendingKey,JSON.stringify(list));
  else store.remove(pendingKey);
}

// 管理者がこの参加者のスタンプをリセットした。端末に残っている記録（スタンプ・未送信・アンケート送信済みの印）を消して、0個に戻す。
// quiet：知らせの表示を省く（QRコードを読み取った直後は、すぐに、新しい結果が出るため）。戻り値：端末にスタンプがあったか
function applyReset(serverCount,quiet=false){
  const had=readStampList(stampsKey).length>0||getPending().length>0;
  [stampsKey,timesKey,pendingKey,surveyKey].forEach(key=>store.remove(key));
  saveResetCount(serverCount);
  $("surveyLink").hidden=true;
  render([]);
  if(had&&!quiet) showResult({tone:"info",seal:null,kicker:"RESET",title:phrases("スタンプを","最初に戻しました"),
    body:"管理者がこの端末のスタンプの記録をリセットしました。掲示板のQRコードを読み取ってもういちど集めよう！"});
  return had;
}

// サーバーが「リセット済み」と返した（record_scan が reset を返した）とき：完全リセットなら、端末の履歴をすべて消して開き直す。通常のリセットなら、スタンプの記録だけを消す。
// 戻り値：完全リセットで、開き直す（このあとの処理は、続けない）か
async function applyServerReset(serverCount,quiet,keepStamp=""){
  let full=false;
  try{ full=(await fetchResetState()).full>localResetCount(); } catch(error){ console.error(error); }
  if(full){ wipeDevice(keepStamp); return true; }
  applyReset(serverCount,quiet);
  return false;
}

// 管理者によるリセットが、この端末の記録より新しくないかを、サーバーに確かめる。戻り値：リセットされていて、端末の記録を消したか
//  ・完全リセット（端末の記録より新しい完全リセットがある）：端末の履歴をすべて消して、開き直す
//  ・通常のリセット：スタンプの記録だけを消す（「次回からは表示しない」の設定などは、残る）
// あわせて、管理者がアンケートの回答を削除していたら（サーバーに回答がないのに、端末に「回答済み」の印がある）、印を消して、答え直せるようにする。
async function syncReset(quiet=false,keepStamp=""){
  if(!serverOn()) return false;
  try{
    const state=await fetchResetState();
    if(Number.isFinite(state.count)&&state.count>localResetCount()){
      if(state.full>localResetCount()){ wipeDevice(keepStamp); return true; }
      applyReset(state.count,quiet); return true;
    }
    if(state.surveyDone===false&&store.get(surveyKey)) store.remove(surveyKey);
  } catch(error){
    console.error(error);
  }
  return false;
}

// 別のタブで、この端末の履歴がすべて消された（reset/ ページ）ときは、このタブも開き直す
// （開いたままだと、消えたはずの古いスタンプや参加者IDを、書き戻してしまうため）。localStorage.clear() が呼ばれたとき、storage イベントの key は null になる。
window.addEventListener("storage",event=>{ if(event.key===null) location.reload(); });

function showSurveyLink(){
  const link=document.getElementById("surveyLink");
  link.href=surveyUrl();
  link.hidden=false;
}

// 読み取りの結果を、画面（バナー・川・図鑑・結果パネル）に反映する
function applyScan(code,again,before,current,patch){
  const prizeNow=!again&&before.length<PRIZE_REQUIRED&&current.length>=PRIZE_REQUIRED;
  const riverNow=!again&&before.length<RIVER_TOTAL&&current.length>=RIVER_TOTAL;
  render(current,{code,kind:again?"again":"new"});
  haptic(prizeNow||riverNow ? [18,70,18,70,36] : again ? 8 : 24);
  const message=scanMessage({code,again,current});
  showResult({...message,...patch});
  // 新しいお魚が増えたとき（川が完成したあとのスタンプでは、お魚は増えない）だけ、後光つきの演出の画面を出す
  if(!again&&message.fish) celebration=celebrate(message,current.length);
}

// 戻り値：{completed: サーバーで条件達成を確認, failed: 通信に失敗}
// 先にサーバーで「登録されたQRコードか」を確かめてから、スタンプとして表示します。
// 通信できなかったときだけ、端末に保存して表示し、あとで再送します。
async function recordStamp(code){
  if(!isStamp(code)){
    showResult(invalidMessage());
    return {completed:false,failed:false};
  }

  const before=await getLocalStamps();
  const again=before.includes(code);
  // 次に現れるお魚の画像を、サーバーの返事を待っている間に、先に読み込んでおく（お魚が現れるときに、画像が遅れて出ないように）
  const early=(!again&&before.length<RIVER_TOTAL)?configReady.then(()=>Fish.preload([fishOrder[before.length]],2500)):Promise.resolve();

  if(!serverOn()){
    // デモモード（サーバーがない）・デバッグモード（チーム用。サーバーには送らない）：形式が合えば、スタンプとして受け付けて、この端末の中だけに保存する
    const current=await saveLocalStamp(code);
    await early;
    const patch={sync:debugOn?"debug":"demo"};
    if(debugOn&&current.length>=PRIZE_REQUIRED){ patch.surveyReady=true; showSurveyLink(); }   // アンケートの画面も、動作確認できるように（送信しても、記録されない）
    applyScan(code,again,before,current,patch);
    return {completed:false,failed:false};
  }

  showResult({tone:"info",seal:null,kicker:"CHECKING",title:phrases("QRコードを","確認しています…"),sync:"saving"});
  let result;
  try{
    result=await recordServerScan(code);
  } catch(error){
    console.error(error);
    const current=await saveLocalStamp(code);
    if(!again && !getPending().includes(code)) setPending([...getPending(),code]);
    await configReady; await early;
    applyScan(code,again,before,current,{sync:"failed"});
    return {completed:false,failed:true};
  }

  if(result.status==="reset"){
    // 管理者がリセットしたあとなのに、この端末にはリセット前の記録が残っていた。消してから、このスタンプを最初の1個として記録し直す
    // （完全リセットだったときは、端末の履歴をすべて消して開き直す。このスタンプは、開き直したあと、新しい参加者の最初のスタンプとして記録される）
    if(await applyServerReset(result.reset_count,true,code)) return {completed:false,failed:false};
    return recordStamp(code);
  }
  if(result.status==="not_open"||result.status==="closed"){
    // 開催の期間の外（開催前・開催終了のあと）：何も記録されていない（スタンプは、もらえない）。お知らせを出す。ページは、そのまま見られる
    resultEl.hidden=true; resultState=null;   // 「QRコードを確認しています…」を消す
    celebration=showPhase(result.status==="not_open"?"before":"closed",{forced:result.forced===true,opensAt:result.opens_at,closesAt:result.closes_at});
    return {completed:false,failed:false};
  }
  if(result.status==="invalid_stamp"){
    showResult(invalidMessage());
    return {completed:false,failed:false};
  }
  const current=await saveLocalStamp(code);
  setPending(getPending().filter(c=>c!==code));
  if(result.completed) showSurveyLink();
  await configReady; await early;
  applyScan(code,again,before,current,{sync:"saved",surveyReady:result.completed});
  return {completed:result.completed,failed:false};
}

// 未送信のスタンプを再送する。戻り値：{completed: 条件達成を確認, dropped: 登録されていないQRなどとして取り除いた数, reset: リセットされていて、端末の記録を消した,
//   gated: 開催の期間の外（開催前・終了）だったときの、サーバーの返事（そのスタンプは、もらえていないので、端末の記録から取り除く）}
async function resendPending(){
  let completed=false, dropped=0, gated=null;
  for(const code of getPending()){
    const result=await recordServerScan(code,true);
    if(result.status==="reset"){ await applyServerReset(result.reset_count,false); return {completed:false,dropped,reset:true,gated};}
    setPending(getPending().filter(c=>c!==code));
    if(result.status==="not_open"||result.status==="closed"){ removeLocalStamp(code); dropped++; gated=result; continue; }
    if(result.status==="invalid_stamp"){ removeLocalStamp(code); dropped++; continue; }
    completed=completed||result.completed===true;
  }
  return {completed,dropped,reset:false,gated};
}
// 再送したスタンプが、開催の期間の外で、もらえなかったとき：お知らせを出す
const showGated=gated=>{ if(gated) celebration=showPhase(gated.status==="not_open"?"before":"closed",{forced:gated.forced===true,opensAt:gated.opens_at,closesAt:gated.closes_at}); };

async function retryPending(){
  updateResult({sync:"saving"});
  try{
    const resent=await resendPending();
    if(resent.reset) return;   // 端末の記録を消して、知らせを表示した
    if(resent.dropped) render(await getLocalStamps());
    showGated(resent.gated);
    const completed=resent.completed || await isServerCompleted();
    if(completed) showSurveyLink();
    updateResult({sync:"saved",surveyReady:completed});
  } catch(error){
    console.error(error);
    updateResult({sync:"failed"});
  }
}

// 再読み込み時など、QRを読まずに開いたときに未送信分の再送とアンケートへの導線を復元します。
async function restoreCompletion(){
  if(!serverOn()) return;
  const hadPending=getPending().length>0;
  const quiet=!resultEl.hidden; // 直前の読み取り結果を表示中なら上書きしない
  try{
    const resent=await resendPending();
    if(resent.reset) return;
    if(resent.dropped) render(await getLocalStamps());
    showGated(resent.gated);
    if(hadPending && !quiet && !resent.gated){
      showResult({tone:"info",seal:"check",kicker:"未送信のスタンプ",title:phrases("前回送信できなかった","スタンプを","記録しました"),sync:"saved",surveyReady:resent.completed});
    }
    if(resent.completed) return showSurveyLink();
    const current=await getLocalStamps();
    if(current.length<PRIZE_REQUIRED) return;
    if(await isServerCompleted()) return showSurveyLink();
    // 端末では条件の個数がそろっているのにサーバーに記録が足りない場合は、取得順に再送します。
    setPending(current);
    const again=await resendPending();
    if(again.reset) return;
    if(again.dropped) render(await getLocalStamps());
    if(again.completed) showSurveyLink();
  } catch(error){
    console.error(error);
    if(getPending().length && !quiet){
      showResult({tone:"error",seal:null,kicker:"未送信のスタンプ",title:phrases("まだサーバーに","記録されていない","スタンプがあります"),sync:"failed"});
    }
  }
}

// 管理画面で決めた設定を、サーバーから読み込む（お魚が増えていく順番・地図を出すか・マイマップ・開催開始日）。
// お魚の順番は、読み込めなくても、前回の順番（なければ初期の順番）で、そのまま使えます。
// 地図は、読み込めなかったときは、出しません（公開してよいと分かるまで、隠しておく）。
let configReady=Promise.resolve();
let lastConfigAt=0;
let lastConfig=null;   // 最後に読み込めた設定（開催前・終了のお知らせに出す日付に使う）
async function loadConfig(){
  if(!isSupabaseConfigured()) return;
  lastConfigAt=Date.now();
  try{
    const config=await callRpc("rally_config",{});
    lastConfig=config&&typeof config==="object"?config:null;
    try{ applyPublicInfo(config); } catch(error){ console.error(error); }   // 地図・開催開始日の表示で、万一エラーが起きても、お魚の順番の更新は続ける
    const order=Fish.normalizeOrder(config&&config.fish_order);
    if(!order) return;
    store.set(fishOrderKey,JSON.stringify(order));
    if(order.join()!==fishOrder.join()){ fishOrder=order; render(await getLocalStamps()); }
  } catch(error){
    console.error(error);
  }
}

// ---- デバッグ用のQRコード（掲示板 No.61〜70。チーム専用）----
// 読み取ると、サーバーには何も記録せず、この端末の中だけで、スタンプの進み具合などを確かめられる（デバッグモード。「デバッグを終わる」を押すまで続く）。
//   No.61：スタンプを1個ふやす（お魚が現れる演出つき。6個まで）／No.62〜68：スタンプを 0・1・2・3・4・5・6 個にする（3個＝景品の条件・6個＝コンプリート）
//   No.69：「開催まで待ってね」の画面を出す／No.70：「開催終了しました」の画面を出す
// デバッグ用かどうかは、読み取った合言葉から、js/debug-boards.js と同じ方法（PBKDF2-HMAC-SHA256）で値を計算して、そこにあるかで調べる
// （掲示板のコードは、公開しない決まりなので、合言葉そのものは持たず、計算した値だけを持っている）。サーバーには、問い合わせない。
const DEBUG_ADD=61, DEBUG_ZERO=62, DEBUG_BEFORE=69, DEBUG_ENDED=70;
const DEBUG_STAMPS=Array.from({length:RIVER_TOTAL},(_,i)=>`debugstamp${i+1}`);   // デバッグ用の、にせのスタンプ（形式は、掲示板の合言葉と同じ）
const debugActionKey="debug_action";   // デバッグモードに入るために開き直したあとに行う動作（掲示板の番号）。sessionStorage に置く（タブを閉じれば消える）
async function debugBoardNo(code){
  const cfg=window.RALLY_DEBUG_BOARDS;
  if(!cfg||!cfg.hashes||!window.crypto||!crypto.subtle||typeof TextEncoder!=="function") return 0;
  try{
    const enc=new TextEncoder();
    const key=await crypto.subtle.importKey("raw",enc.encode(code),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:enc.encode(cfg.salt),iterations:cfg.iterations},key,256);
    const hex=[...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("");
    return hasOwn(cfg.hashes,hex)?Number(cfg.hashes[hex]):0;
  }catch(error){ console.error(error); return 0; }
}
// デバッグモードに入る。保存先を、本物の記録とは別のものに切り替えるため、モードを保存して、開き直す。戻り値：開き直しているか（保存できない端末では false）
function enterDebug(no){
  try{ localStorage.setItem(debugKey,"1"); sessionStorage.setItem(debugActionKey,String(no)); }
  catch(error){
    try{ localStorage.removeItem(debugKey); }catch(e){ /* 保存できない端末：もともと、印は付いていない */ }   // 片方だけ保存できたとき、デバッグモードの印だけが残らないように
    return false;
  }
  location.replace(location.pathname);
  return true;
}
function takeDebugAction(){
  try{ const value=sessionStorage.getItem(debugActionKey); sessionStorage.removeItem(debugActionKey); return Number(value)||0; }
  catch(error){ return 0; }
}
$("debugEnd").onclick=()=>{
  // デバッグ用のスタンプ・モードの印を消す（本物の記録は、もともと別の保存先なので、そのまま）
  try{ [stampsKey,timesKey,pendingKey,surveyKey,debugKey].forEach(key=>localStorage.removeItem(key)); }catch(error){ /* 消せないときは、開き直しても、デバッグモードのまま */ }
  location.replace(location.pathname);
};
// スタンプを n 個にする（デバッグ用のにせのスタンプ。取った時刻は、1分ずつ、ずらす）
function setDebugStamps(n){
  const codes=DEBUG_STAMPS.slice(0,n), now=Date.now();
  store.set(stampsKey,JSON.stringify(codes));
  store.set(timesKey,JSON.stringify(Object.fromEntries(codes.map((c,i)=>[c,new Date(now-(n-1-i)*60000).toISOString()]))));
  store.remove(pendingKey); store.remove(surveyKey);
  return codes;
}
const debugBody=n=>n===0?"最初の状態です。":n<PRIZE_REQUIRED?`景品の条件（${PRIZE_REQUIRED}個）まであと${PRIZE_REQUIRED-n}個の状態です。`
  :n<RIVER_TOTAL?(n===PRIZE_REQUIRED?"景品をゲットできる条件を達成した状態です。アンケートの画面も確かめられます（送信しても記録されません）。":`景品の条件は達成済みです。あと${RIVER_TOTAL-n}個で川が完成します。`)
  :"川が完成した（コンプリート）状態です。";
async function runDebug(no){
  const done={completed:false,failed:false};
  if(no===DEBUG_BEFORE||no===DEBUG_ENDED){
    await configReady;
    celebration=showPhase(no===DEBUG_BEFORE?"before":"closed",{preview:true,...phaseDates()});
    return done;
  }
  const before=await getLocalStamps();
  if(no===DEBUG_ADD){
    if(before.length>=RIVER_TOTAL){
      showResult({tone:"info",seal:null,kicker:"DEBUG",title:phrases("スタンプは",`${RIVER_TOTAL}個そろっています`),body:`これ以上はふえません。No.${DEBUG_ZERO} を読み取ると0個に戻せます。`,sync:"debug"});
      return done;
    }
    await configReady; await Fish.preload([fishOrder[before.length]],2500);   // 次に現れるお魚の画像を、先に読み込んでおく
    const code=DEBUG_STAMPS[before.length], current=await saveLocalStamp(code), patch={sync:"debug"};
    if(current.length>=PRIZE_REQUIRED){ patch.surveyReady=true; showSurveyLink(); }
    applyScan(code,false,before,current,patch);
    return done;
  }
  const n=no-DEBUG_ZERO;   // 62〜68 → 0〜6
  if(n>=0&&n<=RIVER_TOTAL){
    const codes=setDebugStamps(n);
    render(codes);
    if(n>=PRIZE_REQUIRED) showSurveyLink(); else $("surveyLink").hidden=true;
    showResult({tone:"info",seal:null,kicker:"DEBUG",title:phrases("スタンプを",`${n}個にしました`),body:debugBody(n),sync:"debug",surveyReady:n>=PRIZE_REQUIRED});
  }
  return done;
}

async function init(){
  $("requiredCount").textContent=PRIZE_REQUIRED;
  $("riverTotal").textContent=RIVER_TOTAL;
  const params=new URLSearchParams(location.search);
  // QRコードの作成ツールなどで、大文字や前後の空白が入っていても、同じスタンプとして扱う
  const code=(params.get("stamp")||"").trim().toLowerCase();
  // チーム専用のデバッグ用QRコード（掲示板 No.61〜70）か。まだデバッグモードでなければ、モードに入る（保存先を切り替えるため、開き直す）。
  // 本物の掲示板のQRコードを読み取るときは、この確認（合言葉の計算）が、ほんの少しだけ、かかる
  const debugNo=code&&isStamp(code)?await debugBoardNo(code):0;
  let skipCode=false;
  if(debugNo&&!debugOn){
    if(enterDebug(debugNo)) return;   // 開き直している最中
    skipCode=true;                    // この端末は、設定を保存できない：デバッグモードは使えない。デバッグ用のQRコードは、スタンプにしない
    showResult({tone:"info",seal:null,kicker:"DEBUG",title:phrases("この端末では","デバッグモードを","使えません"),body:"ブラウザが記録の保存を許可していません。"});
  }
  if(debugOn) $("debugBar").hidden=false;
  const debugAction=debugOn&&!debugNo?takeDebugAction():0;   // 開き直したあとに行う、デバッグの動作
  const previewKind=previewKinds[params.get("preview")||""]||"";   // 管理画面からの、開催前・終了のお知らせの確認用の表示
  // 順番の読み込みは、画面の表示と並行して始め、最大2.5秒だけ待つ（スタンプの結果を出す前に、最新の順番にそろえるため）
  configReady=Promise.race([loadConfig(),new Promise(resolve=>setTimeout(resolve,2500))]);
  // 管理者がスタンプをリセットしていないかの確認も、並行して始める（最大2.5秒だけ待つ。リセットされていたら、端末の記録を消す）
  const resetReady=Promise.race([syncReset(!!code,code),new Promise(resolve=>setTimeout(resolve,2500))]);
  const current=await getLocalStamps();
  render(current);
  if(storageBlocked) $("storageNote").hidden=false;
  await resetReady;   // スタンプの記録や、未送信分の再送は、リセットの確認のあとに行う（リセット前の記録を、送り直さないように）
  if(wiping) return;  // 完全リセットで、開き直している最中
  // 管理者の完全リセットで、この端末の履歴がすべて消えて、開き直したあと：知らせを出す（QRを読み取ったときは、その結果を出す）
  let fullResetNotice=false;
  try{ fullResetNotice=sessionStorage.getItem(fullResetNoticeKey)==="1"; sessionStorage.removeItem(fullResetNoticeKey); } catch(e){ /* なし */ }
  if(fullResetNotice&&!code) showResult({tone:"info",seal:null,kicker:"RESET",title:phrases("最初の状態に","戻しました"),
    body:"管理者がこの端末の記録をすべてリセットしました。新しい参加者としてはじめからやり直せます。掲示板のQRコードを読み取って集めよう！"});
  let result={completed:false,failed:false};
  if(code){
    // 再読み込みで同じ読み取りが二重に記録されないよう、URLからstampを外します。
    params.delete("stamp");
    const query=params.toString();
    history.replaceState(null,"",location.pathname+(query?`?${query}`:"")+location.hash);
    if(!skipCode) result=debugNo?await runDebug(debugNo):await recordStamp(code);
    if(wiping) return;  // 読み取り中に、完全リセットだと分かった：開き直している最中
    if(storageBlocked) $("storageNote").hidden=false;
  } else if(debugAction){
    result=await runDebug(debugAction);   // デバッグモードに入るために開き直した：読み取ったデバッグ用QRコードの動作を行う
  } else if(previewKind){
    await configReady;
    celebration=showPhase(previewKind,{preview:true,...phaseDates()});
  }
  // 獲得の演出の画面があれば、それが終わってから、ルール説明を出す（「次回からは表示しない」にした端末には、出さない）。
  // 画面の裏で、未送信分の再送などを、並行して進める。演出もルール説明も終わったら、ページの中の動きを見せる
  const popups=(async()=>{
    const celebrated=await celebration;
    if(!rulesHidden()){ await sleep(celebrated?400:700); await showRules(); }
    if(celebrated) replayFx();
  })();
  // 通信に失敗した直後は「再送する」ボタンに任せます。
  if(!result.completed && !result.failed) await restoreCompletion();
  await popups;
}
init();
// 開いたままにしていたページを、また見たとき（アプリの切り替えなどから戻ったとき）も、1分以上たっていれば、お魚の順番とリセットの有無を読み込み直す
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&Date.now()-lastConfigAt>60000){ loadConfig(); syncReset(); }
});
