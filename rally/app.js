// ---- 設定 ----
// 景品を希望できる条件：掲示板のQRコードを、この個数以上読み取ること。
// sql/schema.sql の rally_required_stamps() と同じ数にしてください（scripts/check_site.py が一致を確認します）。
const PRIZE_REQUIRED=3;
// QRコード（掲示板）の合言葉の形式。実際に有効なコードかどうかは、サーバー（record_scan）が確かめます。
// （"constructor" のような言葉も、形式は満たしますが、登録されていないので、スタンプにはなりません）
const STAMP_FORMAT=/^[a-z0-9]{6,32}$/;
const isStamp=code=>typeof code==="string"&&STAMP_FORMAT.test(code);
const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);

// ---- 端末への保存 ----
// ブラウザが保存を許可していない場合（プライベートブラウズや、制限のあるアプリ内ブラウザなど）でも、
// 画面が止まらないようにします。その場合は、このページを開いている間だけ、メモリに保存します。
const participantKey = "stamp_rally_participant_id";
const timesKey = "stamp_rally_stamp_times";
const pendingKey = "stamp_rally_pending";
const stampsKey = "stamp_rally_stamps";
const surveyKey = "stamp_rally_survey_submitted";
const memoryStore = new Map();
let storageBlocked = false;
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ storageBlocked=true; return memoryStore.has(k)?memoryStore.get(k):null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ storageBlocked=true; memoryStore.set(k,String(v)); } },
  remove(k){ try{ localStorage.removeItem(k); }catch(e){ storageBlocked=true; memoryStore.delete(k); } }
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
document.getElementById("total").textContent = PRIZE_REQUIRED;

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

// fx: {code, kind:"new"|"again", complete} … 直前に読み取ったスタンプの演出
function render(stamps,fx={}){
  renderBanner(stamps,fx);
  renderStamps(stamps,fx);
}

// ---- 進捗バナー ----
// 残り個数＝必要なスタンプ数 − 取得済みのスタンプ数。文言は、取得状況に応じて切り替えます。
// 「景品を希望できる」は、希望の手続き（アンケート）に進める条件のことで、景品の受け取りを約束する表現にはしていません。
// message は、文節ごとに分けた配列（画面では、文節の区切りでだけ折り返す）
function bannerContent(got,total){
  const remain=Math.max(total-got,0);
  if(remain===0) return {state:"complete",message:["コンプリート！","景品を希望できる条件を","達成したよ！"]};
  if(got===0) return {state:"empty",message:["スタンプを集めて、","景品の希望に進もう！"]};
  if(remain===1) return {state:"almost",message:["あと1個！","景品の希望まで、","あと少し！"]};
  return {state:"progress",message:[`あと${remain}個で、`,"景品を希望できるよ！"]};
}
function renderBanner(stamps,fx){
  const total=PRIZE_REQUIRED, got=Math.min(stamps.length,total), remain=Math.max(total-got,0);
  const {state,message}=bannerContent(got,total);
  const banner=$("progressBanner"), countEl=$("count"), remainEl=$("remain"), bar=$("bannerBar");
  banner.dataset.state=state;
  // 「あと◯個」と「COMPLETE」の表示は、CSSではなく hidden 属性で切り替える
  document.querySelector(".remain-wrap").hidden=state==="complete";
  document.querySelector(".done-wrap").hidden=state!=="complete";
  countEl.textContent=got;
  remainEl.textContent=remain;
  $("total").textContent=total;
  $("bannerMessage").innerHTML=phrases(...message);
  const notice=String((window.RALLY_PRIZE||{}).notice||"").trim();
  $("bannerNote").textContent=notice; $("bannerNote").hidden=!notice;
  bar.setAttribute("aria-valuemax",total); bar.setAttribute("aria-valuenow",got);
  bar.setAttribute("aria-valuetext",remain?`${got}個取得、あと${remain}個`:`${total}個すべて取得`);
  // 条件を超えたあとに取ったスタンプでは、バーの演出をやり直さない
  const fresh=fx.kind==="new"&&stamps.length<=total;
  bar.innerHTML=Array.from({length:total},(_,i)=>`<span class="seg${i<got?" on":""}${fresh&&i===got-1?" is-new":""}"></span>`).join("");
  if(fresh){ replay(countEl,"bump"); replay(remainEl,"bump"); replay(banner,"is-new"); }
}

// ---- スタンプ枠 ----
// 取得した順に並べます。景品の条件の個数までは、空の枠も出し、条件を超えて取った分は、枠が増えます。
function renderStamps(stamps,fx){
  const slots=Math.max(PRIZE_REQUIRED,stamps.length);
  $("stamps").innerHTML=Array.from({length:slots},(_,i)=>{
    const code=stamps[i], got=code!==undefined, state=got&&fx.code===code?` is-${fx.kind}`:"";
    const at=got?stampTime(code):null;
    return `<div class="stamp${got?" got":""}${state}">
      <span class="stamp-no">${pad2(i+1)}</span>
      <span class="seal">${got?icon("check"):""}</span>
      <strong>${got?"獲得済み":"未獲得"}</strong>
      <small>${got&&at?formatTime(at):" "}</small>
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
// Googleマイマップの共有URL・埋め込みURLだけを受け付ける（それ以外のURLは無視する）
const OVERVIEW_URL_OK=/^https:\/\/(www\.google\.(com|co\.jp)\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/;
const EMBED_URL_OK=/^https:\/\/www\.google\.(com|co\.jp)\/maps\/d\/(u\/\d+\/)?embed\?/;

const mapFrame=(url,title)=>`<iframe src="${esc(url)}" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
const mapButtonLabel=(name,open)=>`${name}の地図を${open?"閉じる":"表示"}`;

function buildPlaces(){
  const places=(Array.isArray(window.RALLY_PLACES)?window.RALLY_PLACES:[]).filter(p=>p&&typeof p==="object");
  const preview=window.RALLY_PLACES_PREVIEW!==false;
  const showMap=preview&&window.RALLY_PLACES_PREVIEW_OPEN===true; // true：最初から地図を表示する（画面の近くまで来たときに読み込む）
  const embedUrl=String(window.RALLY_MAP_EMBED_URL||"").trim();
  const viewUrl=String(window.RALLY_MAP_VIEW_URL||"").trim();
  const hasEmbed=preview&&EMBED_URL_OK.test(embedUrl), hasView=OVERVIEW_URL_OK.test(viewUrl);
  const info=places.map((p,i)=>({name:String(p.name||"").trim()||`場所 ${i+1}`,desc:String(p.description||"").trim(),target:mapTarget(p)}));
  const anyInfo=info.some(x=>x.desc||x.target)||hasEmbed||hasView;

  // すべての掲示板をまとめた地図（Googleマイマップ）
  const embedBox=$("placesEmbed");
  embedBox.innerHTML=hasEmbed?mapFrame(embedUrl,"すべての掲示板の地図"):"";
  embedBox.hidden=!hasEmbed;

  $("placeList").innerHTML=(anyInfo?"":`<li class="place-lead small">掲示板の場所は、準備ができしだい、ここに表示されます。</li>`)+info.map(({name,desc,target},i)=>{
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
  demo:"デモモード：この端末にのみ保存しています"
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
  const seal=s.seal ? icon(s.seal) : "!";
  let error="";
  if(s.sync==="failed"){
    error = pending
      ? `<div class="sr-error"><strong>通信できませんでした</strong>
          <p>スタンプはこの端末に保存されています。電波の良い場所で「再送する」を押してください。押さなくても、次にこのページを開いたときに自動で再送します。${s.tone==="complete"?"<br>アンケートは、記録が完了すると表示されます。":""}</p>
          <button type="button" class="sr-retry">再送する</button></div>`
      : `<div class="sr-error"><strong>読み取りの記録を送信できませんでした</strong>
          <p>スタンプは獲得済みなので、このままで問題ありません。</p></div>`;
  }
  resultEl.dataset.tone=s.tone;
  resultEl.classList.toggle("settled",settled);
  resultEl.innerHTML=`
    <div class="sr-main">
      <span class="sr-seal" aria-hidden="true">${seal}</span>
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

// 読み取った結果の文言。again＝すでに取得済み、reachedNow＝この読み取りで景品の条件を満たした
function scanMessage({code,again,reachedNow,current}){
  const total=PRIZE_REQUIRED, n=current.length;
  if(again){
    const at=stampTime(code);
    return {tone:"again",seal:"check",kicker:"獲得済み",title:phrases("この掲示板は","すでに","獲得しています"),
      body:`${at?`${formatTime(at)} に獲得したスタンプです。`:""}スタンプの数は変わりません（${n}個）。`};
  }
  if(reachedNow){
    return {tone:"complete",seal:"check",kicker:`COMPLETE · ${total} / ${total}`,title:phrases("景品の条件を","達成しました！"),
      body:`${total}つのスタンプがそろいました。アンケートで、景品の希望を受け付けています。`};
  }
  if(n>total){
    return {tone:"new",seal:"check",kicker:`NEW STAMP · ${pad2(n)}`,title:phrases("スタンプを","獲得しました"),
      body:`景品を希望できる条件は、すでに達成しています（合計${n}個）。`};
  }
  return {tone:"new",seal:"check",kicker:`NEW STAMP · ${pad2(n)}`,title:phrases("スタンプを","獲得しました"),
    body:`あと ${total-n} 個で、景品を希望できます。`};
}
const invalidMessage=()=>({tone:"info",seal:null,kicker:"QRコード",title:phrases("このQRコードは","登録されていません"),
  body:"掲示板に貼ってある、スタンプラリーのQRコードを読み取ってください。"});

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

// 有効なQRコードか、初回取得か再スキャンかは、サーバー側（record_scan）で判定・記録されます。
// 戻り値：{status:"ok"|"invalid_stamp", claimed, claim_sequence, completed, stamps}
async function recordServerScan(code,resend=false){
  const rows=await callRpc("record_scan",{
    p_participant_id:participantId,
    p_stamp_code:code,
    // 通信失敗後の再送は管理画面で見分けられるよう印を付けます。
    p_user_agent:navigator.userAgent+(resend?" [resend]":"")
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

function showSurveyLink(){
  const link=document.getElementById("surveyLink");
  link.href=surveyUrl();
  link.hidden=false;
}

// 読み取りの結果を、画面（バナー・スタンプ枠・結果パネル）に反映する
function applyScan(code,again,before,current,patch){
  const reachedNow=!again&&before.length<PRIZE_REQUIRED&&current.length>=PRIZE_REQUIRED;
  render(current,{code,kind:again?"again":"new",complete:reachedNow});
  haptic(reachedNow ? [18,70,18,70,36] : again ? 8 : 24);
  showResult({...scanMessage({code,again,reachedNow,current}),...patch});
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

  if(!isSupabaseConfigured()){
    // デモモード：サーバーがないので、形式が合えばスタンプとして受け付ける
    const current=await saveLocalStamp(code);
    applyScan(code,again,before,current,{sync:"demo"});
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
    applyScan(code,again,before,current,{sync:"failed"});
    return {completed:false,failed:true};
  }

  if(result.status==="invalid_stamp"){
    showResult(invalidMessage());
    return {completed:false,failed:false};
  }
  const current=await saveLocalStamp(code);
  setPending(getPending().filter(c=>c!==code));
  if(result.completed) showSurveyLink();
  applyScan(code,again,before,current,{sync:"saved",surveyReady:result.completed});
  return {completed:result.completed,failed:false};
}

// 未送信のスタンプを再送する。戻り値：{completed: 条件達成を確認, dropped: 登録されていないQRとして取り除いた数}
async function resendPending(){
  let completed=false, dropped=0;
  for(const code of getPending()){
    const result=await recordServerScan(code,true);
    setPending(getPending().filter(c=>c!==code));
    if(result.status==="invalid_stamp"){ removeLocalStamp(code); dropped++; continue; }
    completed=completed||result.completed===true;
  }
  return {completed,dropped};
}

async function retryPending(){
  updateResult({sync:"saving"});
  try{
    const resent=await resendPending();
    if(resent.dropped) render(await getLocalStamps());
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
  if(!isSupabaseConfigured()) return;
  const hadPending=getPending().length>0;
  const quiet=!resultEl.hidden; // 直前の読み取り結果を表示中なら上書きしない
  try{
    const resent=await resendPending();
    if(resent.dropped) render(await getLocalStamps());
    if(hadPending && !quiet){
      showResult({tone:"info",seal:"check",kicker:"未送信のスタンプ",title:phrases("前回送信できなかった","スタンプを","記録しました"),sync:"saved",surveyReady:resent.completed});
    }
    if(resent.completed) return showSurveyLink();
    const current=await getLocalStamps();
    if(current.length<PRIZE_REQUIRED) return;
    if(await isServerCompleted()) return showSurveyLink();
    // 端末では条件の個数がそろっているのにサーバーに記録が足りない場合は、取得順に再送します。
    setPending(current);
    const again=await resendPending();
    if(again.dropped) render(await getLocalStamps());
    if(again.completed) showSurveyLink();
  } catch(error){
    console.error(error);
    if(getPending().length && !quiet){
      showResult({tone:"error",seal:null,kicker:"未送信のスタンプ",title:phrases("まだサーバーに","記録されていない","スタンプがあります"),sync:"failed"});
    }
  }
}

async function init(){
  buildPlaces();
  $("requiredCount").textContent=PRIZE_REQUIRED;
  const params=new URLSearchParams(location.search);
  // QRコードの作成ツールなどで、大文字や前後の空白が入っていても、同じスタンプとして扱う
  const code=(params.get("stamp")||"").trim().toLowerCase();
  const current=await getLocalStamps();
  render(current);
  if(storageBlocked) $("storageNote").hidden=false;
  let result={completed:false,failed:false};
  if(code){
    // 再読み込みで同じ読み取りが二重に記録されないよう、URLからstampを外します。
    params.delete("stamp");
    const query=params.toString();
    history.replaceState(null,"",location.pathname+(query?`?${query}`:"")+location.hash);
    result=await recordStamp(code);
    if(storageBlocked) $("storageNote").hidden=false;
  }
  // 通信に失敗した直後は「再送する」ボタンに任せます。
  if(!result.completed && !result.failed) await restoreCompletion();
}
init();
