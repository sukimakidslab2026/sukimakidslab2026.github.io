const surveyForm=document.getElementById("surveyForm");
const lead=document.getElementById("lead");
const participantId=document.getElementById("participantId");
const satisfaction=document.getElementById("satisfaction");
const comment=document.getElementById("comment");
const prizeRequested=document.getElementById("prizeRequested");
const shipping=document.getElementById("shipping");
const recipientName=document.getElementById("name");
const postal=document.getElementById("postal");
const address=document.getElementById("address");
const phone=document.getElementById("phone");
const consent=document.getElementById("consent");
const submitBtn=document.getElementById("submitBtn");
const message=document.getElementById("message");
const privacyDialog=document.getElementById("privacyDialog");
const privacyContent=document.getElementById("privacyContent");
const PRIVACY_URL="privacy.html";
let privacyVersion=null;

// CDN版supabase-jsがグローバル変数 supabase を定義するため、別名で作成します。
const db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY,{
	auth:{persistSession:false,autoRefreshToken:false}
});
// ブラウザが保存を許可していなくても、画面が止まらないようにする
const safeGet=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
const safeSet=(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){ /* 保存できなくても、送信は完了している */ } };
const query=new URLSearchParams(location.search);
const participant=(query.get("participant_id")||safeGet("stamp_rally_participant_id")||"").trim();
// 管理者プレビュー（?preview=1）：管理画面にログインしている管理者だけが、コンプリートしていなくても画面を確認できる。
// 画面を開くだけで、送信しても記録は保存しない（submit_survey は呼ばない）。管理者でなければ、通常どおりの動作になる。
const wantsPreview=query.get("preview")==="1";
let previewMode=false;
const submittedKey="stamp_rally_survey_submitted";
participantId.value=participant;

const RESULT_MESSAGES={
	already_submitted:"この参加者IDのアンケートは回答済みです。ご協力ありがとうございました。",
	not_completed:"景品を希望できる数のスタンプ取得が確認できません。",
	invalid_participant:"参加者IDが確認できません。スタンプラリーのページからお進みください。",
	invalid_satisfaction:"満足度を選択してください。",
	invalid_comment:"自由記述は2000文字以内で入力してください。",
	invalid_name:"氏名を100文字以内で入力してください。",
	invalid_postal:"郵便番号を7桁の数字で入力してください。",
	invalid_address:"住所を300文字以内で入力してください。",
	invalid_phone:"電話番号を10〜11桁の数字で入力してください。",
	invalid_consent:"プライバシー規約への同意が必要です。",
	invalid_workshop:"ワークショップへの参加について選択してください。"
};

// 管理画面で保存されたログイン情報（Supabase Auth）があり、is_admin が true のときだけ true。
// ログイン情報がない人（参加者）には、通信もしない。
async function isAdminSession(){
	try{
		const key=Object.keys(localStorage).find(k=>/^sb-.+-auth-token$/.test(k));
		if(!key) return false;
		const adminDb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:false}});
		const result=await adminDb.rpc("is_admin");
		return !result.error&&result.data===true;
	}catch(e){ return false; }
}

function block(text){
	lead.textContent=text;
	surveyForm.hidden=true;
	window.scrollTo(0,0);
}

// 全角数字・ハイフンを半角にそろえます。
function toHalfWidth(value){
	return value.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[ー－‐−―]/g,"-");
}

function normalizePostal(value){
	const digits=toHalfWidth(value).replace(/\D/g,"");
	return digits.length===7 ? `${digits.slice(0,3)}-${digits.slice(3)}` : null;
}

function normalizePhone(value){
	const digits=toHalfWidth(value).replace(/[\s\-()（）]/g,"");
	return /^0\d{9,10}$/.test(digits) ? digits : null;
}

prizeRequested.onchange=()=>{
	// disabledの間は必須チェックの対象外になります。
	shipping.hidden=shipping.disabled=!prizeRequested.checked;
};

// プライバシー規約：privacy.html の本文をモーダルで表示します（入力中の内容はそのまま残ります）。
async function loadPrivacy(){
	try{
		const response=await fetch(PRIVACY_URL,{cache:"no-cache"});
		if(!response.ok) throw new Error(`HTTP ${response.status}`);
		const doc=new DOMParser().parseFromString(await response.text(),"text/html");
		const policy=doc.getElementById("policy");
		privacyVersion=policy.dataset.version||null;
		privacyContent.replaceChildren(...[...policy.childNodes].map(n=>document.importNode(n,true)));
	}catch(error){
		console.error(error);
		privacyContent.innerHTML=`<p>規約を読み込めませんでした。<a href="${PRIVACY_URL}" target="_blank" rel="noopener">別のタブで開く</a></p>`;
	}
}
document.querySelectorAll("[data-open-privacy]").forEach(button=>button.onclick=()=>{
	if(typeof privacyDialog.showModal!=="function") return window.open(PRIVACY_URL,"_blank","noopener");
	privacyDialog.showModal();
	privacyContent.scrollTop=0;
});
document.querySelectorAll("[data-close-privacy]").forEach(button=>button.onclick=()=>privacyDialog.close());
privacyDialog.addEventListener("click",e=>{ if(e.target===privacyDialog) privacyDialog.close(); }); // 背景のタップで閉じる

async function start(){
	if(wantsPreview&&await isAdminSession()){
		previewMode=true;
		participantId.value=participant||"（プレビュー）";
		lead.textContent="アンケートの確認画面です。";
		document.getElementById("previewBanner").hidden=false;
		surveyForm.hidden=false;
		loadPrivacy();
		return;
	}
	const previewHint=wantsPreview?" 管理者プレビューを使うには、先に管理画面（admin/）でログインしてください。":"";
	if(!participant) return block(RESULT_MESSAGES.invalid_participant+previewHint);
	if(safeGet(submittedKey)===participant) return block(RESULT_MESSAGES.already_submitted);
	const completion=await db.rpc("is_completed",{p_participant_id:participant});
	if(completion.error){
		console.error(completion.error);
		return block("コンプリート状況を確認できませんでした。通信環境をご確認のうえ、再読み込みしてください。");
	}
	if(!completion.data) return block(RESULT_MESSAGES.not_completed+"スタンプラリーのページで取得状況をご確認ください。"+previewHint);
	lead.textContent="コンプリートおめでとうございます！アンケートにご協力ください。";
	surveyForm.hidden=false;
	loadPrivacy();
}

surveyForm.onsubmit=async e=>{
	e.preventDefault();
	message.textContent="";
	const prize=prizeRequested.checked;
	const postalValue=prize ? normalizePostal(postal.value) : null;
	const phoneValue=prize ? normalizePhone(phone.value) : null;
	if(prize && !postalValue) return message.textContent=RESULT_MESSAGES.invalid_postal;
	if(prize && !phoneValue) return message.textContent=RESULT_MESSAGES.invalid_phone;

	if(previewMode){ // プレビューでは、入力の確認までを行い、送信（記録）はしない
		return block(prize ? "【プレビュー】送信ありがとうございました。景品の発送先を受け付けました。（記録は保存されていません）" : "【プレビュー】送信ありがとうございました。（記録は保存されていません）");
	}
	submitBtn.disabled=true;
	submitBtn.textContent="送信中…";
	const result=await db.rpc("submit_survey",{
		p_participant_id:participant,
		p_satisfaction:Number(satisfaction.value),
		p_memorable_spot:null, // 印象に残ったスポットの質問は廃止（掲示板に名前がなくなったため）。引数だけ残してある
		p_comment:comment.value.trim()||null,
		p_prize_requested:prize,
		p_recipient_name:prize ? recipientName.value.trim() : null,
		p_postal_code:postalValue,
		p_address:prize ? address.value.trim() : null,
		p_phone:phoneValue,
		p_consent:prize && consent.checked,
		p_workshop_participation:surveyForm.elements.workshop.value||null,
		p_privacy_version:prize ? privacyVersion : null
	});
	submitBtn.disabled=false;
	submitBtn.textContent="送信する";

	if(result.error){
		console.error(result.error);
		return message.textContent="送信に失敗しました。時間をおいて再度お試しください。";
	}
	if(result.data==="ok"){
		safeSet(submittedKey,participant);
		return block(prize ? "送信ありがとうございました。景品の発送先を受け付けました。" : "送信ありがとうございました。");
	}
	if(result.data==="already_submitted"){
		safeSet(submittedKey,participant);
		return block(RESULT_MESSAGES.already_submitted);
	}
	message.textContent=RESULT_MESSAGES[result.data]||"送信できませんでした。入力内容をご確認ください。";
};

start();
