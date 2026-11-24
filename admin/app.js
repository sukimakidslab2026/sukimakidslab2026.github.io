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
// 画面は4つ：メニュー（ログイン後の最初の画面）／アンケート・集計（#survey）／スタンプ設定（#stamps）／公開の設定（#publish）。URLの # で切り替わる
const SECTIONS={menu:"adminMenu",survey:"dashboard",stamps:"stampSettings",publish:"publishSettings"};
let loggedIn=false,currentSection="";
const routeFromHash=()=>{const h=location.hash.replace(/^#/,"");return h==="survey"||h==="stamps"||h==="publish"?h:"menu";};
function showSection(name){
 currentSection=name;
 $("login").hidden=true;
 for(const [key,id] of Object.entries(SECTIONS))$(id).hidden=key!==name;
 if(name==="survey")loadDashboard();
 if(name==="stamps")loadStampSettings();
 if(name==="publish")loadPublishSettings();
 window.scrollTo(0,0);
}
function showLogin(text="",isError=false){
 loggedIn=false;currentSection="";
 $("login").hidden=false;Object.values(SECTIONS).forEach(id=>{$(id).hidden=true;});
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
 return /admin_stats|v_admin_|prize_shipping|excluded_participants|admin_set_excluded|rally_config|admin_set_fish_order|admin_rally_info|admin_set_rally_info|rally_settings|admin_reset_progress|admin_full_reset_many|admin_delete_surveys|participant_resets|schema cache|does not exist/.test(m)
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
 loggedIn=true;
 showSection(routeFromHash());
}

// 除外した参加者を表示するか（オフのときは、表・一覧から隠す）
const visible=id=>$("showExcluded").checked||!excludedIds.has(id);
const badge=excluded=>excluded?` <span class="badge">除外</span>`:"";

// ---- 表のチェックボックス：複数の参加者・回答を選んで、まとめて操作する ----
// 選べるのは、いま表に表示されている行だけ（絞り込みなどで見えなくなった行は、選択から外れる：見えていない行を、うっかり操作しない）。
// 自動更新で表を描き直しても、選択は保たれる。参加者の選択とアンケートの選択は、同時には持たない（画面の下のバーが重ならないように）。
const BULK_LIMIT=1000; // サーバー側（admin_clean_ids）の、1回の上限
const selectedParticipants=new Set(),selectedSurveys=new Set();
let visibleParticipantIds=[],visibleSurveyIds=[],bulkBusy=false;
const checkCell=(set,id,label)=>`<td class="sel"><label class="selcell"><input type="checkbox" data-select="${esc(id)}" aria-label="${esc(label)}"${set.has(id)?" checked":""}></label></td>`;
function pruneSelection(set,visibleIds){const keep=new Set(visibleIds);for(const id of [...set])if(!keep.has(id))set.delete(id);}
function syncSelectAll(box,set,visibleIds){ // 見出しのチェックボックス：すべて／一部／なし
 const n=visibleIds.filter(id=>set.has(id)).length;
 box.checked=visibleIds.length>0&&n===visibleIds.length;box.indeterminate=n>0&&n<visibleIds.length;box.disabled=!visibleIds.length;
}
const idSummary=ids=>ids.length<=5?ids.map(esc).join("、"):`${ids.slice(0,5).map(esc).join("、")} ほか${ids.length-5}人`;
function updateParticipantBar(){
 const ids=[...selectedParticipants],toExclude=ids.filter(id=>!excludedIds.has(id)).length,toRelease=ids.length-toExclude;
 $("participantBulk").hidden=!ids.length;
 $("participantSelected").textContent=ids.length;
 $("bulkExclude").textContent=`除外する（${toExclude}人）`;$("bulkExclude").disabled=bulkBusy||!toExclude;
 $("bulkRelease").textContent=`除外を解除（${toRelease}人）`;$("bulkRelease").disabled=bulkBusy||!toRelease;
 $("bulkReset").disabled=bulkBusy;$("bulkFullReset").disabled=bulkBusy;$("bulkClearParticipants").disabled=bulkBusy;
 syncSelectAll($("participantAll"),selectedParticipants,visibleParticipantIds);
}
function updateSurveyBar(){
 $("surveyBulk").hidden=!selectedSurveys.size;
 $("surveySelected").textContent=selectedSurveys.size;
 $("bulkDeleteSurvey").disabled=bulkBusy;$("bulkClearSurveys").disabled=bulkBusy;
 syncSelectAll($("surveyAll"),selectedSurveys,visibleSurveyIds);
}
function setBulkBusy(flag){bulkBusy=flag;updateParticipantBar();updateSurveyBar();}

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
 visibleParticipantIds=list.map(p=>p.participant_id);pruneSelection(selectedParticipants,visibleParticipantIds);
 $("participantBody").innerHTML=list.map(p=>`<tr class="${p.is_excluded?"excluded":""}">
  ${checkCell(selectedParticipants,p.participant_id,`参加者 ${p.participant_id} を選択`)}
  <td>${esc(p.participant_id)}${badge(p.is_excluded)}</td>
  <td>${p.completed?`<span class="done">コンプリート</span>`:"途中"}</td>
  <td>${p.stamps}個</td>
  <td><ol class="route">${(p.claims||[]).map(c=>`<li>${esc(c.stamp_name)} <span class="muted">${fmtShort(c.at)}</span></li>`).join("")}</ol></td>
  <td>${fmt(p.first_scan_at)}</td><td>${fmt(p.last_scan_at)}</td>
  <td>${p.total_scans}（${p.rescans}）</td><td>${esc(p.device)}</td>
  <td><span class="row-actions"><button class="mini${p.is_excluded?" secondary":""}" data-exclude="${esc(p.participant_id)}" data-to="${p.is_excluded?"0":"1"}">${p.is_excluded?"除外を解除":"除外"}</button>
  <button class="mini danger" data-reset="${esc(p.participant_id)}" aria-label="参加者 ${esc(p.participant_id)} のスタンプをリセット">リセット</button>
  <button class="mini danger" data-fullreset="${esc(p.participant_id)}" aria-label="参加者 ${esc(p.participant_id)} を完全リセット（端末の履歴も消す）">完全リセット</button></span></td></tr>`).join("")
  ||`<tr><td colspan="10" class="muted">該当する参加者はいません。</td></tr>`;
 updateParticipantBar();
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
 visibleSurveyIds=list.map(x=>x.participant_id);pruneSelection(selectedSurveys,visibleSurveyIds);
 $("surveyBody").innerHTML=list.map(x=>`<tr class="${excludedIds.has(x.participant_id)?"excluded":""}">${checkCell(selectedSurveys,x.participant_id,`参加者 ${x.participant_id} の回答を選択`)}<td>${fmt(x.submitted_at)}</td><td>${esc(x.participant_id)}${badge(excludedIds.has(x.participant_id))}</td><td>${x.satisfaction??""}</td>
  <td>${esc(x.comment)}</td><td>${esc(workshopName(x.workshop_participation))}</td><td>${x.prize_requested?"希望":"—"}</td>
  <td>${shipIds.has(x.participant_id)?"登録あり":"—"}</td></tr>`).join("")
  ||`<tr><td colspan="8" class="muted">該当する回答はありません。</td></tr>`;
 updateSurveyBar();
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
  <td>${esc(x.recipient_name)}</td><td>${esc(x.postal_code)}</td><td>${esc(x.address)}</td><td>${esc(formatPhone(x.phone))}</td><td>${esc(x.email)}</td><td>${esc(x.privacy_version)}</td></tr>`).join("")
  ||`<tr><td colspan="8" class="muted">景品発送先の登録はありません。</td></tr>`;
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
 downloadCsv("stamp-rally-shipping.csv",["送信日時","参加者ID","氏名","郵便番号","住所","電話番号","メールアドレス","同意した規約の版"],
  rows.map(x=>[fmt(x.created_at),x.participant_id,x.recipient_name,x.postal_code,x.address,formatPhone(x.phone),x.email,x.privacy_version]));
 notify(`景品発送CSVを出力しました（${rows.length}件${ships.length-rows.length?`。除外した${ships.length-rows.length}件は含みません`:""}）。`);
});
$("csvSurveyBtn").onclick=()=>exportCsv($("csvSurveyBtn"),async()=>{
 const [svs,ex]=await Promise.all([fetchAll(()=>db.from("survey_responses").select("*").order("submitted_at").order("id")),freshExclusions()]);
 const rows=svs.filter(x=>!ex.has(x.participant_id));
 downloadCsv("stamp-rally-survey.csv",["送信日時","参加者ID","満足度","自由記述","暗渠ワークショップ参加","景品希望"],
  rows.map(x=>[fmt(x.submitted_at),x.participant_id,x.satisfaction,x.comment,workshopName(x.workshop_participation),x.prize_requested?"希望":"希望しない"]));
 notify(`アンケートCSVを出力しました（${rows.length}件${svs.length-rows.length?`。除外した${svs.length-rows.length}件は含みません`:""}）。`);
});

// ---- 参加者のスタンプのリセット ----
// その参加者の「取得したスタンプ」と「読み取り履歴」を削除して、0個に戻す。参加者の端末は、次に開いたとき（または次にQRを読み取ったとき）に、0個に戻る。
// アンケートの回答（景品の発送先を含む）は、残す。回答済みの参加者では、確認の画面で、回答も削除するかを選べる。
const resetDialog=$("resetDialog");
let resetTargets=[],resetFull=false;
// full：完全リセット（通常のリセットに加えて、参加者の端末のサイトの履歴を、すべて消させる。アンケートの回答も、既定で削除する）
function openReset(ids,full=false){
 const rows=ids.map(id=>participants.find(x=>x.participant_id===id));
 const stamps=rows.reduce((n,p)=>n+(p?p.stamps:0),0),scans=rows.reduce((n,p)=>n+(p?p.total_scans:0),0);
 const withSurvey=ids.filter(id=>surveys.some(s=>s.participant_id===id)).length,many=ids.length>1;
 resetTargets=ids;resetFull=full;
 const who=many?`選択した <strong>${ids.length}人</strong>`:`参加者 <strong>${esc(ids[0])}</strong>`;
 const surveyLine=full
  ?(withSurvey?(many?`アンケートに回答済みの参加者が ${withSurvey}人 います。`:"この参加者は、アンケートに回答済みです。")+"回答と景品の発送先は、<strong>削除します</strong>（下の項目のチェックを外すと、残します）。"
   :(many?"アンケートに回答済みの参加者は、いません。":"この参加者は、アンケートに回答していません。"))
  :(withSurvey?(many?`アンケートに回答済みの参加者が ${withSurvey}人 います。回答と景品の発送先は、残します（下の項目を選ぶと、削除します）。`:"アンケートの回答と景品の発送先は、残します（下の項目を選ぶと、削除します）。")
   :(many?"アンケートに回答済みの参加者は、いません。":"この参加者は、アンケートに回答していません。"));
 $("resetTitle").textContent=full?"完全リセットしますか？":"スタンプをリセットしますか？";
 $("resetOk").textContent=full?"完全リセットする":"リセットする";
 $("resetBody").innerHTML=`<p>${who} ${full?"を、<strong>完全リセット</strong>します。":"のスタンプを、0個に戻します。"}</p><ul>
  ${many?`<li>対象：${idSummary(ids)}</li>`:""}
  <li>取得済みのスタンプ ${stamps}個と、読み取り履歴 ${scans}件を削除します（<strong>元に戻せません</strong>）。</li>
  ${full
   ?`<li>${many?"これらの参加者の端末は":"この参加者の端末は"}、次にページを開いたとき（または次にQRコードを読み取ったとき）に、<strong>サイトの履歴がすべて消えて</strong>、はじめて開いたときの状態になります（参加者IDも新しくなり、「次回からは表示しない」の設定も消えます。管理者がログインしている端末では、ログアウトされます）。</li>
  <li>除外の設定は、古い参加者IDに残ります（端末は新しい参加者IDになるので、新しいIDは、除外されません）。</li>`
   :`<li>${many?"これらの参加者の端末は":"この参加者の端末は"}、次にページを開いたとき（または次にQRコードを読み取ったとき）に、0個に戻ります。</li>
  <li>除外の設定は、そのまま残ります。</li>`}
  <li>${surveyLine}</li></ul>`;
 $("resetSurveyRow").hidden=!withSurvey;$("resetSurvey").checked=full;   // 完全リセットは、アンケートも削除するのが、最初の状態
 resetDialog.returnValue="";
 if(typeof resetDialog.showModal==="function")resetDialog.showModal();
 else if(confirm(`${many?`選択した ${ids.length}人`:`参加者 ${ids[0]}`} を${full?"完全リセットします（端末の履歴もすべて消します）":"のスタンプを0個に戻します"}。元に戻せません。よろしいですか？`)){resetDialog.returnValue="ok";doReset();}
}
async function doReset(){
 const ids=resetTargets,full=resetFull;
 // 完全リセットは、アンケートも削除するのが基本（確認の画面に、回答済みの人がいないときも、削除する指定で送る：直前に回答した人を、取りこぼさないため）
 const withSurvey=full?($("resetSurveyRow").hidden||$("resetSurvey").checked):(!$("resetSurveyRow").hidden&&$("resetSurvey").checked);
 if(!ids.length)return;
 if(full||ids.length>1){
  if(ids.length>BULK_LIMIT)return notify(`一度に処理できるのは、${BULK_LIMIT}人までです（いま ${ids.length}人）。`,true);
  setBulkBusy(true);
  const {data,error}=await db.rpc(full?"admin_full_reset_many":"admin_reset_progress_many",{p_participant_ids:ids,p_delete_survey:withSurvey});
  setBulkBusy(false);
  if(error){console.error(error);return notify(`${full?"完全リセット":"リセット"}できませんでした：${dbHint(error)}`,true);}
  selectedParticipants.clear();
  notify(full
   ?`${data.participants}人を完全リセットしました（スタンプ${data.stamps}個・読み取り履歴${data.scans}件${withSurvey?`・アンケート${data.surveys}件`:""}を削除）。各端末は、次に開いたとき、はじめての状態に戻ります。`
   :`${data.participants}人のスタンプをリセットしました（スタンプ${data.stamps}個・読み取り履歴${data.scans}件${withSurvey?`・アンケート${data.surveys}件`:""}を削除）。`);
 }else{
  const id=ids[0];
  const {data,error}=await db.rpc("admin_reset_progress",{p_participant_id:id,p_delete_survey:withSurvey});
  if(error){console.error(error);return notify(`リセットできませんでした：${dbHint(error)}`,true);}
  notify(`${id} のスタンプをリセットしました（スタンプ${data.stamps}個・読み取り履歴${data.scans}件${withSurvey?`・アンケート${data.surveys}件`:""}を削除）。`);
 }
 await loadDashboard(true);
}
resetDialog.addEventListener("close",()=>{if(resetDialog.returnValue==="ok")doReset();});

// ---- テスト参加者の除外 ----
$("participantBody").onclick=async e=>{
 const r=e.target.closest("button[data-reset]");if(r)return openReset([r.dataset.reset]);
 const f=e.target.closest("button[data-fullreset]");if(f)return openReset([f.dataset.fullreset],true);
 const b=e.target.closest("button[data-exclude]");if(!b)return;
 const id=b.dataset.exclude,flag=b.dataset.to==="1";
 if(flag&&!confirm(`参加者 ${id} を、集計・CSV・スプレッドシートから除外します。\n（データは削除されず、いつでも解除できます）`))return;
 b.disabled=true;
 const {error}=await db.rpc("admin_set_excluded",{p_participant_id:id,p_excluded:flag,p_reason:"管理画面から手動で設定"});
 if(error){b.disabled=false;console.error(error);return notify(`変更できませんでした：${dbHint(error)}`,true);}
 notify(flag?`${id} を除外しました。`:`${id} の除外を解除しました。`);
 await loadDashboard(true);
};

// ---- 選んだ参加者・回答を、まとめて操作する ----
$("participantBody").addEventListener("change",e=>{
 const c=e.target.closest("input[data-select]");if(!c)return;
 if(c.checked)selectedParticipants.add(c.dataset.select);else selectedParticipants.delete(c.dataset.select);
 if(selectedSurveys.size){selectedSurveys.clear();renderSurveys();}
 updateParticipantBar();
});
$("surveyBody").addEventListener("change",e=>{
 const c=e.target.closest("input[data-select]");if(!c)return;
 if(c.checked)selectedSurveys.add(c.dataset.select);else selectedSurveys.delete(c.dataset.select);
 if(selectedParticipants.size){selectedParticipants.clear();renderParticipants();}
 updateSurveyBar();
});
$("participantAll").onchange=e=>{
 for(const id of visibleParticipantIds){if(e.target.checked)selectedParticipants.add(id);else selectedParticipants.delete(id);}
 if(e.target.checked)selectedSurveys.clear();
 renderParticipants();renderSurveys();
};
$("surveyAll").onchange=e=>{
 for(const id of visibleSurveyIds){if(e.target.checked)selectedSurveys.add(id);else selectedSurveys.delete(id);}
 if(e.target.checked)selectedParticipants.clear();
 renderParticipants();renderSurveys();
};
$("bulkClearParticipants").onclick=()=>{selectedParticipants.clear();renderParticipants();};
$("bulkClearSurveys").onclick=()=>{selectedSurveys.clear();renderSurveys();};
async function bulkExclude(flag){
 // すでにその状態の人（除外済みの人を、もう一度除外、など）は、対象に含めない
 const ids=[...selectedParticipants].filter(id=>excludedIds.has(id)!==flag);
 if(!ids.length||bulkBusy)return;
 if(ids.length>BULK_LIMIT)return notify(`一度に処理できるのは、${BULK_LIMIT}人までです（いま ${ids.length}人）。`,true);
 if(flag&&!confirm(`選択した ${ids.length}人 を、集計・CSV・スプレッドシートから除外します。\n（データは削除されず、いつでも解除できます）`))return;
 setBulkBusy(true);
 const {data,error}=await db.rpc("admin_set_excluded_many",{p_participant_ids:ids,p_excluded:flag,p_reason:"管理画面から一括で設定"});
 setBulkBusy(false);
 if(error){console.error(error);return notify(`${flag?"除外":"除外の解除"}できませんでした：${dbHint(error)}`,true);}
 selectedParticipants.clear();
 notify(flag?`${data}人を除外しました。`:`${data}人の除外を解除しました。`);
 await loadDashboard(true);
}
$("bulkExclude").onclick=()=>bulkExclude(true);
$("bulkRelease").onclick=()=>bulkExclude(false);
const bulkResetClick=full=>()=>{
 const ids=[...selectedParticipants];
 if(!ids.length||bulkBusy)return;
 if(ids.length>BULK_LIMIT)return notify(`一度に処理できるのは、${BULK_LIMIT}人までです（いま ${ids.length}人）。`,true);
 openReset(ids,full);
};
$("bulkReset").onclick=bulkResetClick(false);
$("bulkFullReset").onclick=bulkResetClick(true);

// ---- アンケートの回答の削除 ----
// 回答（満足度・自由記述など）と、景品の発送先（個人情報）を、参加者ごとに削除する。参加者のスタンプ・読み取り履歴・除外は、残る。
// サーバーの記録だけを消すので、回答済みの端末の「回答済み」の印は、残る（その端末では、アンケートに答え直せない）。
const surveyDeleteDialog=$("surveyDeleteDialog");
let surveyDeleteTargets=[];
function openSurveyDelete(ids){
 const shipN=ids.filter(id=>shipping.some(x=>x.participant_id===id)).length;
 surveyDeleteTargets=ids;
 $("surveyDeleteBody").innerHTML=`<p>選択した <strong>${ids.length}件</strong> のアンケートの回答を削除します。</p><ul>
  <li>対象：${idSummary(ids)}</li>
  <li>満足度・自由記述・ワークショップの回答と、景品の発送先（氏名・住所・電話番号・メールアドレス）${shipN}件を削除します（<strong>元に戻せません</strong>。必要なら、先にCSVを保存してください）。</li>
  <li>参加者のスタンプ・読み取り履歴・除外の設定は、そのまま残ります。</li>
  <li><strong>参加者は、もう一度、アンケートに答えられるようになります</strong>（スタンプは、そのまま。参加者が次にアンケート画面、または、スタンプラリーの画面を開いたときに、端末の「回答済み」の印が消えます）。</li>
  <li>スプレッドシートにも、次の同期で反映されます。</li></ul>`;
 surveyDeleteDialog.returnValue="";
 if(typeof surveyDeleteDialog.showModal==="function")surveyDeleteDialog.showModal();
 else if(confirm(`選択した ${ids.length}件 のアンケートの回答（景品の発送先を含む）を削除します。元に戻せません。よろしいですか？`)){surveyDeleteDialog.returnValue="ok";doDeleteSurveys();}
}
async function doDeleteSurveys(){
 const ids=surveyDeleteTargets;
 if(!ids.length||bulkBusy)return;
 if(ids.length>BULK_LIMIT)return notify(`一度に処理できるのは、${BULK_LIMIT}件までです（いま ${ids.length}件）。`,true);
 setBulkBusy(true);
 const {data,error}=await db.rpc("admin_delete_surveys",{p_participant_ids:ids});
 setBulkBusy(false);
 if(error){console.error(error);return notify(`削除できませんでした：${dbHint(error)}`,true);}
 selectedSurveys.clear();
 notify(`アンケートの回答${data.surveys}件を削除しました（景品の発送先${data.shipping}件を含む）。`);
 await loadDashboard(true);
}
$("bulkDeleteSurvey").onclick=()=>{
 const ids=[...selectedSurveys];
 if(!ids.length||bulkBusy)return;
 if(ids.length>BULK_LIMIT)return notify(`一度に処理できるのは、${BULK_LIMIT}件までです（いま ${ids.length}件）。`,true);
 openSurveyDelete(ids);
};
surveyDeleteDialog.addEventListener("close",()=>{if(surveyDeleteDialog.returnValue==="ok")doDeleteSurveys();});

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
const logout=async()=>{await db.auth.signOut();location.hash="";location.reload();};
["logoutBtn","logoutBtnMenu","logoutBtnStamps","logoutBtnPublish"].forEach(id=>{$(id).onclick=logout;});
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

// ---- スタンプ設定：お魚が増えていく順番 ----
// スタンプを1個取るごとに、上から順番に、お魚が1種類ずつ川に現れる。保存すると、参加者の画面が次に開かれたときから、新しい順番で表示される。
const Fish=window.RallyFish,FISH=Fish.fish;
let fishSaved=null,fishDraft=null,fishStage=3,fishRequired=3,fishSavedAt="";
const fishDirty=()=>!!fishDraft&&fishDraft.join()!==fishSaved.join();
function setFishStatus(text,isError=false){const el=$("fishStatus");el.textContent=text;el.classList.toggle("error",isError);}

async function loadStampSettings(){
 setFishStatus("読み込み中…");
 const {data,error}=await db.rpc("rally_config");
 if(error){console.error(error);return setFishStatus(`読み込めませんでした：${dbHint(error)}`,true);}
 const order=Fish.normalizeOrder(data.fish_order)||Fish.defaultOrder();
 fishRequired=Number(data.required)||3;
 fishSaved=order.slice();fishDraft=order.slice();fishSavedAt=data.updated_at||"";
 fishStage=Math.min(fishRequired,Fish.keys.length);
 renderFishEditor();
 setFishStatus(fishSavedAt?`現在公開中の順番です（最終保存：${fmt(fishSavedAt)}）。`:"現在公開中の順番です（初期の順番）。");
}

function renderFishEditor(){
 const last=fishDraft.length-1;
 $("fishRequired").textContent=fishRequired;
 document.querySelectorAll(".fishRequiredText").forEach(el=>{el.textContent=fishRequired;});
 // 順番の一覧。景品の条件の個数の下に、マスタード色の線を引く
 $("fishList").innerHTML=fishDraft.map((key,i)=>{
  const f=FISH[key];
  return `<li class="fish-item" data-key="${key}"><span class="fish-no num">${i+1}</span>
   <span class="fish-thumb"><img src="${esc(Fish.url(f.stamp))}" width="${f.width}" height="${f.height}" alt=""></span>
   <span class="fish-name">${esc(f.name)}</span>
   <span class="fish-btns"><button type="button" class="secondary" data-move="up" data-key="${key}" aria-label="${esc(f.name)}を1つ前にする"${i===0?" disabled":""}>▲</button><button type="button" class="secondary" data-move="down" data-key="${key}" aria-label="${esc(f.name)}を1つ後ろにする"${i===last?" disabled":""}>▼</button></span></li>`
  +(i===fishRequired-1?`<li class="fish-line" aria-hidden="true"><span>ここまでの${fishRequired}個で、景品をゲットできます</span></li>`:"");
 }).join("");
 // 川の見え方：選んだ個数のときの絵と、1〜6個の一覧
 $("fishStages").innerHTML=fishDraft.map((_,i)=>`<button type="button" class="${fishStage===i+1?"":"secondary"}" data-stage="${i+1}" aria-pressed="${fishStage===i+1}">${i+1}個${i+1===fishRequired?"（景品）":""}</button>`).join("");
 $("fishPreview").innerHTML=Fish.riverInnerHtml(fishDraft,fishStage);
 $("fishPreview").setAttribute("aria-label",`スタンプが${fishStage}個のときの川の絵`);
 $("fishPreviewNote").textContent=`スタンプが${fishStage}個のとき：${fishDraft.slice(0,fishStage).map(k=>FISH[k].name).join("・")}`+(fishStage===fishRequired?"（景品をゲットできる条件を達成したときの絵です）":"");
 $("fishThumbs").innerHTML=fishDraft.map((_,i)=>`<button type="button" class="thumb${fishStage===i+1?" on":""}" data-stage="${i+1}" aria-label="スタンプが${i+1}個のときの川の絵を見る"><span class="river">${Fish.riverInnerHtml(fishDraft,i+1)}</span><span class="thumb-label">${i+1}個${i+1===fishRequired?"（景品）":""}</span></button>`).join("");
 const dirty=fishDirty();
 $("fishSave").disabled=!dirty;$("fishReset").disabled=!dirty;
}
$("fishList").onclick=e=>{
 const b=e.target.closest("button[data-move]");if(!b)return;
 const i=fishDraft.indexOf(b.dataset.key),j=b.dataset.move==="up"?i-1:i+1;
 if(i<0||j<0||j>=fishDraft.length)return;
 [fishDraft[i],fishDraft[j]]=[fishDraft[j],fishDraft[i]];
 renderFishEditor();
 // 並べ替えたあとも、同じお魚のボタンにフォーカスを残す（続けて押せるように）
 const again=$("fishList").querySelector(`button[data-move="${b.dataset.move}"][data-key="${b.dataset.key}"]:not([disabled])`)||$("fishList").querySelector(`button[data-key="${b.dataset.key}"]:not([disabled])`);
 if(again)again.focus();
 setFishStatus("並べ替えました。まだ保存していません（「保存して公開する」を押すと、参加者の画面に反映されます）。");
};
const pickStage=e=>{const b=e.target.closest("[data-stage]");if(!b)return;fishStage=Number(b.dataset.stage);renderFishEditor();};
$("fishStages").onclick=pickStage;$("fishThumbs").onclick=pickStage;
$("fishReset").onclick=()=>{fishDraft=fishSaved.slice();renderFishEditor();setFishStatus("保存した順番に戻しました。");};
$("fishDefault").onclick=()=>{fishDraft=Fish.defaultOrder();renderFishEditor();setFishStatus(fishDirty()?"おすすめの順番にしました。まだ保存していません。":"おすすめの順番です（保存済みと同じです）。");};
$("fishSave").onclick=async()=>{
 $("fishSave").disabled=true;setFishStatus("保存しています…");
 const {data,error}=await db.rpc("admin_set_fish_order",{p_order:fishDraft});
 if(error){console.error(error);renderFishEditor();return setFishStatus(`保存できませんでした：${dbHint(error)}`,true);}
 const order=Fish.normalizeOrder(data.fish_order)||fishDraft;
 fishSaved=order.slice();fishDraft=order.slice();fishSavedAt=data.updated_at||"";
 renderFishEditor();
 setFishStatus(`保存しました（${fmt(fishSavedAt)}）。参加者の画面には、次に開いたとき（再読み込みしたとき）から、新しい順番で表示されます。`);
};
// 公開の設定：掲示板の地図を出すか・マイマップのURL・開催開始日（rally_settings）。保存するまでは、参加者の画面は変わらない。
// 「公開する」にするまでは、スタンプラリー画面に、掲示板の地図は出ない（初期は非公開）。
const MYMAP_EMBED_OK=/^https:\/\/www\.google\.com\/maps\/d\/embed\?mid=[A-Za-z0-9_-]{8,100}(&ll=-?[0-9]{1,3}(\.[0-9]{1,12})?,-?[0-9]{1,3}(\.[0-9]{1,12})?)?(&z=[0-9]{1,2})?$/;   // sql/schema.sql の rally_valid_mymap_url・rally/app.js の MYMAP_EMBED_OK と、同じ形
const WEEKDAYS=["日","月","火","水","木","金","土"];
const MYMAP_HOWTO="マイマップの共有URL（https://www.google.com/maps/d/viewer?mid=…）か、「自分のサイトに埋め込む」の iframe のタグを、そのまま貼り付けてください。";

// 貼り付けられたもの（viewer・edit・embed のURL、または iframe のタグ）から、保存する形のURLを作る。
// 戻り値：{empty:true}（空）／{url}（保存する形のURL）／{error}（読み取れない理由）
function parseMymapInput(raw){
 let text=String(raw||"").trim();
 if(!text)return {empty:true};
 const tag=/<iframe\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(text);
 if(tag)text=String(tag[1]??tag[2]??"").replace(/&amp;/g,"&").trim();
 let url;
 try{url=new URL(text);}catch(e){return {error:`URLとして読み取れません。${MYMAP_HOWTO}`};}
 if(url.protocol!=="https:"||!/^(www\.)?google\.(com|co\.jp)$/.test(url.hostname))return {error:`Googleマイマップのリンクではありません。${MYMAP_HOWTO}`};
 const path=/^\/maps\/d(?:\/u\/\d+)?(?:\/(?:viewer|edit|embed|view))?\/?$/.exec(url.pathname);   // マイマップのURL（/maps/d/…）
 if(!path)return {error:`これは、ふつうのGoogleマップのリンクです。「マイマップ」（https://www.google.com/maps/d/…）のリンクを貼り付けてください。`};
 const mid=url.searchParams.get("mid")||"";
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(mid))return {error:"リンクに、マイマップのID（mid=…）が見つかりません。マイマップを開いたときのURLを、そのまま貼り付けてください。"};
 const ll=url.searchParams.get("ll")||"", z=url.searchParams.get("z")||"";
 let out=`https://www.google.com/maps/d/embed?mid=${mid}`;
 if(/^-?\d{1,3}(\.\d{1,12})?,-?\d{1,3}(\.\d{1,12})?$/.test(ll))out+=`&ll=${ll}`;
 if(/^\d{1,2}$/.test(z)&&+z>=1&&+z<=21)out+=`&z=${+z}`;
 return MYMAP_EMBED_OK.test(out)?{url:out}:{error:`リンクを読み取れませんでした。${MYMAP_HOWTO}`};
}
const mymapViewUrl=embed=>embed.replace("/maps/d/embed?","/maps/d/viewer?");   // 入力欄に戻して見せるときの形（開いて確かめられる）
function startDateLabel(value){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
 if(!m)return null;
 const y=+m[1],mo=+m[2],d=+m[3],date=new Date(y,mo-1,d);
 if(date.getFullYear()!==y||date.getMonth()!==mo-1||date.getDate()!==d)return null;
 return `${y}年${mo}月${d}日（${WEEKDAYS[date.getDay()]}）`;
}
// js/rally-data.js に、確認用の「（仮）」の場所が残っていないか（残ったまま公開すると、参加者の画面に出てしまう）
const tentativePlaces=()=>(Array.isArray(window.RALLY_PLACES)?window.RALLY_PLACES:[]).filter(p=>p&&/[（(]仮[）)]/.test(String(p.name||""))).map(p=>String(p.name));

let infoSaved=null,previewUrl="",infoHasOngoing=false;   // infoSaved：保存済みの設定 {places:boolean,mymap:"保存する形のURL（なければ空）",date:"YYYY-MM-DD（なければ空）",ongoing:boolean,at:"保存した日時"}。infoHasOngoing：サーバー（SQL）が「開催中！」の設定に対応しているか
function setPublishStatus(text,isError=false){const el=$("publishStatus");el.textContent=text;el.classList.toggle("error",isError);}
function readInfo(){
 return {places:document.querySelector('input[name="placesPublic"]:checked')?.value==="1",mymap:parseMymapInput($("mymapInput").value),date:$("startDateInput").value,ongoing:$("ongoingInput").checked};
}
const infoDirty=()=>{
 if(!infoSaved)return false;
 const f=readInfo();
 return f.places!==infoSaved.places||f.date!==infoSaved.date||f.ongoing!==infoSaved.ongoing||(f.mymap.empty?"":f.mymap.url||"\u0000")!==infoSaved.mymap;
};
// サーバーから受け取った設定を、画面に入れる（保存済みの内容として）
function applyInfo(data){
 infoHasOngoing=!!data&&Object.prototype.hasOwnProperty.call(data,"rally_ongoing");   // 古いSQLは、この項目を返さない（その間は、「開催中！」のチェックを使えなくする）
 infoSaved={places:data?.places_public===true,mymap:MYMAP_EMBED_OK.test(data?.mymap_embed_url||"")?data.mymap_embed_url:"",date:startDateLabel(data?.start_date)?data.start_date:"",ongoing:data?.rally_ongoing===true,at:data?.info_updated_at||""};
 document.querySelector(`input[name="placesPublic"][value="${infoSaved.places?1:0}"]`).checked=true;
 $("mymapInput").value=infoSaved.mymap?mymapViewUrl(infoSaved.mymap):"";
 $("startDateInput").value=infoSaved.date;
 $("ongoingInput").checked=infoSaved.ongoing;
 $("ongoingInput").disabled=!infoHasOngoing;
 $("ongoingNote").hidden=infoHasOngoing;
 $("publishForm").disabled=false;
 renderInfo();
}
function renderInfo(){
 const f=readInfo(),dirty=infoDirty(),tentative=tentativePlaces();
 // いま参加者の画面に出ている内容（保存済み）
 if(infoSaved){
  $("publishCurrent").hidden=false;
  $("publishCurrent").textContent=`いまの参加者の画面：掲示板の地図は、${infoSaved.places?"公開中です":"公開していません"}。マイマップは、${infoSaved.mymap?"入力済みです"+(infoSaved.places?"（表示されます）":"（地図を公開すると表示されます）"):"入力されていません（表示されません）"}。バナーの下は、${infoSaved.ongoing?"「開催中！」と表示されます（開催開始日は、表示されません）":infoSaved.date?`開催開始日（${startDateLabel(infoSaved.date)}）が表示されます`:"何も表示されません（開催開始日は、入力されていません）"}。`;
 }
 // マイマップ：読み取れたか・プレビュー
 const state=$("mymapState");
 state.classList.remove("error","ok");
 if(f.mymap.empty)state.textContent="入力されていません。マイマップは表示されず、js/rally-data.js に登録した場所の一覧だけが表示されます。";
 else if(f.mymap.error){state.textContent=f.mymap.error;state.classList.add("error");}
 else{state.textContent="✓ マイマップのリンクとして読み取れました。";state.classList.add("ok");}
 const url=f.mymap.url||"";
 $("mymapPreviewBox").hidden=!url;
 if(url!==previewUrl){previewUrl=url;if(url)$("mymapPreview").src=url;else $("mymapPreview").removeAttribute("src");}
 // 開催開始日
 const label=startDateLabel(f.date);
 $("startDatePreview").textContent=f.ongoing?`スタンプラリー画面のバナーの下に、「開催中！」と表示されます。${label?`開催開始日（${label}）は、表示されません。`:"（開催開始日は、入力されていません）"}`:label?`スタンプラリー画面のバナーの下に、「開催開始日 ${label}」と表示されます。`:"入力されていません。開催開始日は表示されません。";
 $("startDateClear").disabled=!f.date;
 // 「（仮）」の場所が残ったまま公開しようとしているとき
 const warn=$("placesTentative");
 warn.hidden=!(f.places&&tentative.length);
 if(!warn.hidden)warn.textContent=`js/rally-data.js の場所に、確認用の「${tentative.join("」「")}」が残っています。このまま公開すると、参加者の画面に表示されます。先に、実際の場所に書き換えて、公開（push）してください。`;
 $("publishSave").disabled=!dirty||!!f.mymap.error;
 $("publishReset").disabled=!dirty;
}
async function loadPublishSettings(){
 setPublishStatus("読み込み中…");
 const {data,error}=await db.rpc("admin_rally_info");
 if(error){console.error(error);infoSaved=null;$("publishForm").disabled=true;$("publishCurrent").hidden=true;return setPublishStatus(`読み込めませんでした：${dbHint(error)}`,true);}
 applyInfo(data);
 setPublishStatus(infoSaved.at?`最終保存：${fmt(infoSaved.at)}`:"まだ保存していません（初期の設定です：掲示板の地図は、公開していません）。");
}
["placesPublic"].forEach(name=>document.querySelectorAll(`input[name="${name}"]`).forEach(el=>el.addEventListener("change",renderInfo)));
$("mymapInput").addEventListener("input",renderInfo);
$("startDateInput").addEventListener("input",renderInfo);$("startDateInput").addEventListener("change",renderInfo);
$("ongoingInput").addEventListener("change",renderInfo);
$("startDateClear").onclick=()=>{$("startDateInput").value="";renderInfo();$("startDateInput").focus();};
$("publishReset").onclick=()=>{if(!infoSaved)return;applyInfo({places_public:infoSaved.places,mymap_embed_url:infoSaved.mymap,start_date:infoSaved.date,...(infoHasOngoing?{rally_ongoing:infoSaved.ongoing}:{}),info_updated_at:infoSaved.at});setPublishStatus("保存した内容に戻しました。");};
$("publishSave").onclick=async()=>{
 const f=readInfo();
 if(f.mymap.error)return setPublishStatus(f.mymap.error,true);
 if(f.places&&tentativePlaces().length&&!confirm(`js/rally-data.js の場所に、確認用の「${tentativePlaces().join("」「")}」が残っています。\nこのまま、掲示板の地図を公開しますか？`))return;
 $("publishSave").disabled=true;setPublishStatus("保存しています…");
 const args={p_places_public:f.places,p_mymap_embed_url:f.mymap.url||null,p_start_date:f.date||null};
 if(infoHasOngoing)args.p_rally_ongoing=f.ongoing;   // 古いSQLには、この引数がない（送ると、関数が見つからない）。そのときは、これまでの3つだけを送る
 const {data,error}=await db.rpc("admin_set_rally_info",args);
 if(error){
  console.error(error);renderInfo();
  const bad=/invalid mymap url/.test(String(error.message))?"マイマップのリンクの形が正しくありません。":/invalid start date/.test(String(error.message))?"開催開始日は、2000年〜2100年の日付を入力してください。":dbHint(error);
  return setPublishStatus(`保存できませんでした：${bad}`,true);
 }
 applyInfo(data);
 setPublishStatus(`保存しました（${fmt(infoSaved.at)}）。参加者の画面には、次に開いたとき（再読み込みしたとき）から、反映されます。`);
};

// 保存していない変更があるまま、画面を閉じたり、メニューに戻ったりしないように確認する（スタンプ設定・公開の設定）
const dirtyOf=name=>name==="stamps"?fishDirty():name==="publish"?infoDirty():false;
window.addEventListener("beforeunload",e=>{if(fishDirty()||infoDirty()){e.preventDefault();e.returnValue="";}});
window.addEventListener("hashchange",()=>{
 if(!loggedIn)return;
 const next=routeFromHash();
 if(next!==currentSection&&dirtyOf(currentSection)&&!confirm("保存していない変更があります。破棄して、移動しますか？")){location.hash=`#${currentSection}`;return;}
 if(next!==currentSection)showSection(next);
});

// 自動更新：画面が見えているときだけ、30秒ごとに取り直す
setInterval(()=>{
 if($("dashboard").hidden||!$("autoRefresh").checked||document.hidden)return;
 loadDashboard(true);
},REFRESH_MS);
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden&&!$("dashboard").hidden&&$("autoRefresh").checked&&Date.now()-lastLoaded>REFRESH_MS)loadDashboard(true);
});

(async()=>{const r=await db.auth.getSession();if(r.data.session)await enter();})();
