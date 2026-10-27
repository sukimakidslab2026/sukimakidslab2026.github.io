const $=id=>document.getElementById(id);
// CDN版supabase-jsがグローバル変数 supabase を定義するため、別名で作成します。
const db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
const workshopLabels={attended:"参加した",not_attended:"参加していない",unsure:"わからない／覚えていない"};
const workshopName=v=>workshopLabels[v]||"";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmt=v=>v?new Date(v).toLocaleString("ja-JP"):"";
const fmtShort=v=>new Date(v).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const pct=v=>v===null||v===undefined?"—":`${(Number(v)*100).toFixed(1)}%`;
const SCAN_PAGE=200,REFRESH_MS=30000;
let participants=[],surveys=[],shipping=[],excludedIds=new Set();
let scanLimit=SCAN_PAGE,loading=false,lastLoaded=0,lastUpdated="",noticeTimer=null,scanTimer=null;

function setStatus(text,isError=false){
 $("status").textContent=text;$("status").classList.toggle("error",isError);
}
function renderStatus(){
 if(lastUpdated)setStatus(`最終更新：${lastUpdated}${$("autoRefresh").checked?"（30秒ごとに自動更新）":"（自動更新はオフ）"}`);
}
// 操作の結果を数秒だけ表示する（自動更新で消えないよう、状態表示とは別の場所に出す）
function notify(text,isError=false){
 const el=$("notice");el.textContent=text;el.hidden=false;el.classList.toggle("error",isError);
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{el.hidden=true},isError?12000:7000);
}
function showLogin(text="",isError=false){
 $("login").hidden=false;$("dashboard").hidden=true;
 $("loginMsg").textContent=text;$("loginMsg").classList.toggle("error",isError);
}
// ログインに失敗した原因を、利用者が見分けられるメッセージにする
function loginErrorMessage(error){
 const code=error?.code||"",message=String(error?.message||"");
 if(code==="invalid_credentials")return "メールアドレスまたはパスワードが正しくありません。";
 if(code==="email_not_confirmed")return "このメールアドレスは、まだ確認が済んでいません。Supabaseの Authentication > Users で、このユーザーの確認を済ませてください。";
 if(error?.status===0||/fetch|network|load failed/i.test(message))return "通信できませんでした。インターネット接続を確認して、もう一度お試しください。";
 return `ログインできませんでした：${message||"原因不明のエラー"}`;
}
function dbHint(error){
 const m=String(error?.message||error);
 return /admin_stats|v_admin_|prize_shipping|excluded_participants|admin_set_excluded|schema cache|does not exist/.test(m)
  ?`${m}（Supabaseで最新の sql/schema.sql を実行したか確認してください）`:m;
}

// PostgRESTは1回1000件までなので、全件を分割取得します。
async function fetchAll(build){
 const size=1000;let rows=[];
 for(let from=0;;from+=size){
  const {data,error}=await build().range(from,from+size-1);
  if(error)throw error;
  rows=rows.concat(data);
  if(data.length<size)return rows;
 }
}

async function enter(){
 const {data,error}=await db.rpc("is_admin");
 if(error){console.error(error);await db.auth.signOut();return showLogin("管理者権限を確認できませんでした。sql/schema.sql が実行済みか確認してください。",true);}
 if(!data){await db.auth.signOut();return showLogin("このアカウントは管理者として登録されていません。",true);}
 $("login").hidden=true;$("dashboard").hidden=false;
 loadDashboard();
}

// 除外した参加者を表示するか（オフのときは、表・一覧から隠す）
const visible=id=>$("showExcluded").checked||!excludedIds.has(id);
const badge=excluded=>excluded?` <span class="badge">除外</span>`:"";

async function loadDashboard(silent=false){
 if(loading)return;
 loading=true;$("refreshBtn").disabled=true;if(!silent)setStatus("読み込み中…");
 try{
  const [stats,parts,svs,ships]=await Promise.all([
   db.rpc("admin_stats"),
   fetchAll(()=>db.from("v_admin_participants").select("*").order("last_scan_at",{ascending:false}).order("participant_id")),
   fetchAll(()=>db.from("survey_responses").select("*").order("submitted_at",{ascending:false}).order("id")),
   fetchAll(()=>db.from("prize_shipping").select("*").order("created_at",{ascending:false}).order("participant_id"))
  ]);
  if(stats.error)throw stats.error;
  participants=parts;surveys=svs;shipping=ships;
  excludedIds=new Set(parts.filter(p=>p.is_excluded).map(p=>p.participant_id));
  renderStats(stats.data);renderParticipants();renderSurveys();renderShipping();
  await loadScans();
  lastLoaded=Date.now();lastUpdated=new Date().toLocaleString("ja-JP");renderStatus();
 }catch(error){
  console.error(error);setStatus(`読み込みに失敗しました：${dbHint(error)}`,true);
 }finally{
  loading=false;$("refreshBtn").disabled=false;
 }
}

function renderStats(st){
 const s=st.summary;
 $("cParticipants").textContent=s.participants;
 $("cCompleters").textContent=s.completers;
 $("cCompleteRate").textContent=`${s.required}個以上`+(s.participants?`・クリア率 ${pct(s.completers/s.participants)}`:"");
 $("cScans").textContent=s.total_scans;
 $("cRescans").textContent=`うち再スキャン ${s.rescans}`;
 $("cSurveys").textContent=s.surveys;
 $("cSurveyRate").textContent=s.completers?`回答率 ${pct(s.surveys/s.completers)}`:"";
 $("cPrize").textContent=s.prize_requests;
 $("cAvg").textContent=s.avg_satisfaction===null?"—":Number(s.avg_satisfaction).toFixed(2);
 $("cExcluded").textContent=s.excluded_participants;

 $("funnelBody").innerHTML=st.funnel.map(f=>`<tr><td>${f.stamps}個${f.stamps===s.required?` <span class="muted">（景品の条件）</span>`:""}</td><td>${f.exact}</td><td>${f.at_least}</td><td>${pct(f.ratio)}</td></tr>`).join("");
 const dec=v=>v===null||v===undefined?"—":Number(v).toFixed(2);
 const sumOf=key=>st.workshop.reduce((t,x)=>t+Number(x[key]||0),0);
 $("workshopBody").innerHTML=st.workshop.map(w=>`<tr><td>${esc(w.label)}</td><td>${w.responses}</td><td>${dec(w.avg_satisfaction)}</td><td>${w.prize_requests}</td></tr>`).join("")
  +`<tr class="total"><td>合計</td><td>${sumOf("responses")}</td><td>${dec(s.avg_satisfaction)}</td><td>${sumOf("prize_requests")}</td></tr>`;
 fillBoardFilter(st.spots);
 $("spotBody").innerHTML=st.spots.map(x=>`<tr><td>${esc(x.stamp_name)}</td><td>${x.total_scans}</td><td>${x.unique_participants}</td><td>${x.rescans}</td><td>${x.claimed_participants}</td><td>${pct(x.acquisition_rate)}</td></tr>`).join("");
 $("dailyBody").innerHTML=st.daily.map(d=>`<tr><td>${esc(d.date)}</td><td>${d.new_participants}</td><td>${d.scans}</td><td>${d.completers}</td><td>${d.surveys}</td></tr>`).join("")
  ||`<tr><td colspan="5" class="muted">まだデータがありません。</td></tr>`;
 $("satBody").innerHTML=st.satisfaction.map(x=>`<tr><td>${x.score}</td><td>${x.count}</td></tr>`).join("");
}

// 読み取り履歴の「掲示板」の絞り込みの選択肢を、登録されている掲示板から作る（更新しても、選んでいる値は保つ）
function fillBoardFilter(spots){
 const select=$("scanSpot"),current=select.value;
 const boards=spots.filter(x=>x.board_no!==null&&x.board_no!==undefined);
 select.innerHTML=`<option value="">すべて</option>`+boards.map(x=>`<option value="${x.board_no}">${esc(x.stamp_name)}</option>`).join("");
 select.value=boards.some(x=>String(x.board_no)===current)?current:"";
}

function renderParticipants(){
 const q=$("participantSearch").value.trim().toUpperCase(),status=$("participantStatus").value;
 const list=participants.filter(p=>visible(p.participant_id)
  &&(!q||p.participant_id.toUpperCase().includes(q))
  &&(status===""||(status==="done")===p.completed));
 $("participantCount").textContent=`${list.length}人`;
 $("participantBody").innerHTML=list.map(p=>`<tr class="${p.is_excluded?"excluded":""}">
  <td>${esc(p.participant_id)}${badge(p.is_excluded)}</td>
  <td>${p.completed?`<span class="done">コンプリート</span>`:"途中"}</td>
  <td>${p.stamps}個</td>
  <td><ol class="route">${(p.claims||[]).map(c=>`<li>${esc(c.stamp_name)} <span class="muted">${fmtShort(c.at)}</span></li>`).join("")}</ol></td>
  <td>${fmt(p.first_scan_at)}</td><td>${fmt(p.last_scan_at)}</td>
  <td>${p.total_scans}（${p.rescans}）</td><td>${esc(p.device)}</td>
  <td><button class="mini${p.is_excluded?" secondary":""}" data-exclude="${esc(p.participant_id)}" data-to="${p.is_excluded?"0":"1"}">${p.is_excluded?"除外を解除":"除外"}</button></td></tr>`).join("")
  ||`<tr><td colspan="9" class="muted">該当する参加者はいません。</td></tr>`;
}

// 日付の入力（YYYY-MM-DD）を、日本時間のその日の0時として扱う
const jstStart=(value,addDays=0)=>new Date(new Date(`${value}T00:00:00+09:00`).getTime()+addDays*86400000);

function scanQuery(){
 let q=db.from("v_admin_scans").select("*");
 const board=$("scanSpot").value,kind=$("scanKind").value,from=$("scanFrom").value,to=$("scanTo").value;
 const text=$("scanSearch").value.trim().replace(/[%_\\,()*]/g,"");
 if(board)q=q.eq("board_no",Number(board));
 if(kind==="first")q=q.eq("is_first_claim",true);
 if(kind==="again")q=q.eq("is_first_claim",false);
 if(from)q=q.gte("scanned_at",jstStart(from).toISOString());
 if(to)q=q.lt("scanned_at",jstStart(to,1).toISOString());
 if(text)q=q.ilike("participant_id",`%${text}%`);
 if(!$("showExcluded").checked)q=q.eq("is_excluded",false);
 return q.order("scanned_at",{ascending:false}).order("id",{ascending:false});
}
async function loadScans(){
 // 自動更新のたびに「さらに読み込む」が元に戻らないよう、いま表示している件数ぶんを取り直す
 const {data,error}=await scanQuery().range(0,scanLimit-1);
 if(error)throw error;
 $("scanBody").innerHTML=data.map(x=>`<tr class="${x.is_excluded?"excluded":""}"><td>${fmt(x.scanned_at)}</td><td>${esc(x.participant_id)}${badge(x.is_excluded)}</td><td>${esc(x.stamp_name)}</td><td>${esc(x.scan_type)}${x.is_resend?"（再送）":""}</td><td><span title="${esc(x.user_agent)}">${esc(x.device)}</span></td></tr>`).join("")
  ||`<tr><td colspan="5" class="muted">該当する読み取りはありません。</td></tr>`;
 $("scanCount").textContent=data.length?`${data.length}件${data.length>=scanLimit?"（続きあり）":""}`:"";
 $("moreScansBtn").hidden=data.length<scanLimit;
}
async function reloadScans(){
 try{await loadScans();}catch(error){console.error(error);setStatus(`読み込みに失敗しました：${dbHint(error)}`,true);}
}

function filteredSurveys(){
 const prize=$("surveyPrize").value,ws=$("surveyWorkshop").value,from=$("surveyFrom").value,to=$("surveyTo").value;
 const f=from?jstStart(from):null,t=to?jstStart(to,1):null;
 return surveys.filter(x=>visible(x.participant_id)
  &&(prize===""||(prize==="yes")===x.prize_requested)
  &&(ws===""||(ws==="none"?!x.workshop_participation:x.workshop_participation===ws))
  &&(!f||new Date(x.submitted_at)>=f)&&(!t||new Date(x.submitted_at)<t));
}
function renderSurveys(){
 const list=filteredSurveys(),shipIds=new Set(shipping.map(s=>s.participant_id));
 $("surveyCount").textContent=`${list.length}件`;
 $("surveyBody").innerHTML=list.map(x=>`<tr class="${excludedIds.has(x.participant_id)?"excluded":""}"><td>${fmt(x.submitted_at)}</td><td>${esc(x.participant_id)}${badge(excludedIds.has(x.participant_id))}</td><td>${x.satisfaction??""}</td>
  <td>${esc(x.comment)}</td><td>${esc(workshopName(x.workshop_participation))}</td><td>${x.prize_requested?"希望":"—"}</td>
  <td>${shipIds.has(x.participant_id)?"登録あり":"—"}</td></tr>`).join("")
  ||`<tr><td colspan="7" class="muted">該当する回答はありません。</td></tr>`;
}

// Excelで開いたときに先頭の0が消えないよう、ハイフン区切りにします（区切り位置は目安）。
function formatPhone(value){
 const d=String(value??"");
 if(!/^0\d{9,10}$/.test(d))return d;
 if(d.length===11)return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
 if(d.startsWith("0120"))return `${d.slice(0,4)}-${d.slice(4,7)}-${d.slice(7)}`;
 if(/^0[36]/.test(d))return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;
 return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
}

function renderShipping(){
 const list=shipping.filter(x=>visible(x.participant_id));
 $("shippingBody").innerHTML=list.map(x=>`<tr class="${excludedIds.has(x.participant_id)?"excluded":""}"><td>${fmt(x.created_at)}</td><td>${esc(x.participant_id)}${badge(excludedIds.has(x.participant_id))}</td>
  <td>${esc(x.recipient_name)}</td><td>${esc(x.postal_code)}</td><td>${esc(x.address)}</td><td>${esc(formatPhone(x.phone))}</td><td>${esc(x.privacy_version)}</td></tr>`).join("")
  ||`<tr><td colspan="7" class="muted">景品発送先の登録はありません。</td></tr>`;
}

function csvCell(value){
 let s=String(value??"");
 if(/^[=+\-@\t\r]/.test(s))s="'"+s; // 表計算ソフトで数式として実行されるのを防ぐ
 return `"${s.replaceAll('"','""')}"`;
}
function downloadCsv(filename,header,rows){
 const csv=[header,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n");
 const a=document.createElement("a");
 a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
 a.download=filename;a.click();URL.revokeObjectURL(a.href);
}
async function exportCsv(button,build){
 button.disabled=true;
 try{await build();}catch(error){console.error(error);notify(`CSVを作成できませんでした：${dbHint(error)}`,true);}
 finally{button.disabled=false;}
}
// CSVは画面の表示ではなく、その場で最新のデータと除外の状態を取り直して作る
const freshExclusions=async()=>new Set((await fetchAll(()=>db.from("excluded_participants").select("participant_id").order("participant_id"))).map(x=>x.participant_id));

$("csvShippingBtn").onclick=()=>exportCsv($("csvShippingBtn"),async()=>{
 const [ships,ex]=await Promise.all([fetchAll(()=>db.from("prize_shipping").select("*").order("created_at").order("participant_id")),freshExclusions()]);
 const rows=ships.filter(x=>!ex.has(x.participant_id));
 downloadCsv("stamp-rally-shipping.csv",["送信日時","参加者ID","氏名","郵便番号","住所","電話番号","同意した規約の版"],
  rows.map(x=>[fmt(x.created_at),x.participant_id,x.recipient_name,x.postal_code,x.address,formatPhone(x.phone),x.privacy_version]));
 notify(`景品発送CSVを出力しました（${rows.length}件${ships.length-rows.length?`。除外した${ships.length-rows.length}件は含みません`:""}）。`);
});
$("csvSurveyBtn").onclick=()=>exportCsv($("csvSurveyBtn"),async()=>{
 const [svs,ex]=await Promise.all([fetchAll(()=>db.from("survey_responses").select("*").order("submitted_at").order("id")),freshExclusions()]);
 const rows=svs.filter(x=>!ex.has(x.participant_id));
 downloadCsv("stamp-rally-survey.csv",["送信日時","参加者ID","満足度","自由記述","暗渠ワークショップ参加","景品希望"],
  rows.map(x=>[fmt(x.submitted_at),x.participant_id,x.satisfaction,x.comment,workshopName(x.workshop_participation),x.prize_requested?"希望":"希望しない"]));
 notify(`アンケートCSVを出力しました（${rows.length}件${svs.length-rows.length?`。除外した${svs.length-rows.length}件は含みません`:""}）。`);
});

// ---- テスト参加者の除外 ----
$("participantBody").onclick=async e=>{
 const b=e.target.closest("button[data-exclude]");if(!b)return;
 const id=b.dataset.exclude,flag=b.dataset.to==="1";
 if(flag&&!confirm(`参加者 ${id} を、集計・CSV・スプレッドシートから除外します。\n（データは削除されず、いつでも解除できます）`))return;
 b.disabled=true;
 const {error}=await db.rpc("admin_set_excluded",{p_participant_id:id,p_excluded:flag,p_reason:"管理画面から手動で設定"});
 if(error){b.disabled=false;console.error(error);return notify(`変更できませんでした：${dbHint(error)}`,true);}
 notify(flag?`${id} を除外しました。`:`${id} の除外を解除しました。`);
 await loadDashboard(true);
};
$("excludeBeforeBtn").onclick=async()=>{
 const value=$("excludeBefore").value;
 if(!value)return notify("日時を入力してください。",true);
 const before=new Date(value);
 const target=participants.filter(p=>!p.is_excluded&&new Date(p.first_scan_at)<before).length;
 if(!target)return notify("その日時より前に最初の読み取りがある参加者は、いません。");
 if(!confirm(`${before.toLocaleString("ja-JP")} より前に最初の読み取りがある ${target}人 を、集計・CSV・スプレッドシートから除外します。\n（データは削除されず、「除外をすべて解除」で元に戻せます）`))return;
 const {data,error}=await db.rpc("admin_exclude_before",{p_before:before.toISOString()});
 if(error){console.error(error);return notify(`除外できませんでした：${dbHint(error)}`,true);}
 notify(`${data}人を除外しました。`);
 await loadDashboard(true);
};
$("clearExcludedBtn").onclick=async()=>{
 if(!excludedIds.size)return notify("除外している参加者は、いません。");
 if(!confirm(`除外している ${excludedIds.size}人 を、すべて集計に戻します。よろしいですか？`))return;
 const {data,error}=await db.rpc("admin_clear_excluded");
 if(error){console.error(error);return notify(`解除できませんでした：${dbHint(error)}`,true);}
 notify(`${data}人の除外を解除しました。`);
 await loadDashboard(true);
};

// ---- ログイン・更新・絞り込み ----
$("loginForm").onsubmit=async e=>{
 e.preventDefault();
 $("loginBtn").disabled=true;showLogin("ログインしています…");
 const r=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 $("loginBtn").disabled=false;
 if(r.error){console.error(r.error);return showLogin(loginErrorMessage(r.error),true);}
 $("password").value="";
 await enter();
};
$("logoutBtn").onclick=async()=>{await db.auth.signOut();location.reload();};
$("refreshBtn").onclick=()=>loadDashboard();
$("autoRefresh").onchange=()=>{renderStatus();if($("autoRefresh").checked&&Date.now()-lastLoaded>REFRESH_MS)loadDashboard(true);};
$("showExcluded").onchange=()=>{renderParticipants();renderSurveys();renderShipping();scanLimit=SCAN_PAGE;reloadScans();};
$("participantSearch").oninput=renderParticipants;
$("participantStatus").onchange=renderParticipants;
["surveyPrize","surveyWorkshop","surveyFrom","surveyTo"].forEach(id=>{$(id).onchange=renderSurveys;});
["scanSpot","scanKind","scanFrom","scanTo"].forEach(id=>{$(id).onchange=()=>{scanLimit=SCAN_PAGE;reloadScans();};});
$("scanSearch").oninput=()=>{clearTimeout(scanTimer);scanTimer=setTimeout(()=>{scanLimit=SCAN_PAGE;reloadScans();},300);};
$("moreScansBtn").onclick=async()=>{
 $("moreScansBtn").disabled=true;scanLimit+=SCAN_PAGE;
 await reloadScans();
 $("moreScansBtn").disabled=false;
};

// 自動更新：画面が見えているときだけ、30秒ごとに取り直す
setInterval(()=>{
 if($("dashboard").hidden||!$("autoRefresh").checked||document.hidden)return;
 loadDashboard(true);
},REFRESH_MS);
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden&&!$("dashboard").hidden&&$("autoRefresh").checked&&Date.now()-lastLoaded>REFRESH_MS)loadDashboard(true);
});

(async()=>{const r=await db.auth.getSession();if(r.data.session)await enter();})();
