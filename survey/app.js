const surveyForm=document.getElementById("surveyForm");
const lead=document.getElementById("lead");
const participantId=document.getElementById("participantId");
const satisfaction=document.getElementById("satisfaction");
const comment=document.getElementById("comment");
const motivation=document.getElementById("motivation");
const motivationBlock=document.getElementById("motivationBlock");
const prizeRequested=document.getElementById("prizeRequested");
const shipping=document.getElementById("shipping");
const recipientName=document.getElementById("name");
const postal=document.getElementById("postal");
const address=document.getElementById("address");
const phone=document.getElementById("phone");
const email=document.getElementById("email");
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
let previewLabel="プレビュー";
// デバッグモード（チーム用）：スタンプラリーの画面の、デバッグ用QRコード（掲示板 No.61〜70）で入る。このあいだ、アンケートの画面は、管理者プレビューと同じ
// （コンプリートしていなくても開け、送信しても、記録は保存されない）。デバッグを終わるときは、スタンプラリーの画面の「デバッグを終わる」を押す。
const debugOn=safeGet("stamp_rally_debug")==="1";
const submittedKey="stamp_rally_survey_submitted";
participantId.value=participant;

const RESULT_MESSAGES={
	already_submitted:"この参加者IDのアンケートは回答済みです。ご協力ありがとうございました。",
	not_completed:"景品をゲットできる数のスタンプ取得が確認できません。",
	invalid_participant:"参加者IDが確認できません。スタンプラリーのページからお進みください。",
	invalid_satisfaction:"スタンプラリーが楽しかったかを（1〜5で）選択してください。",
	invalid_comment:"ご意見・ご感想は2000文字以内で入力してください。",
	invalid_motivation:"きっかけは2000文字以内で入力してください。",
	invalid_name:"氏名を100文字以内で入力してください。",
	invalid_postal:"郵便番号を7桁の数字で入力してください。",
	invalid_address:"住所を300文字以内で入力してください。",
	invalid_phone:"電話番号を10〜11桁の数字で入力してください。",
	invalid_email:"メールアドレスを半角の英数字で正しい形式（例：example@mail.com）で入力してください。",
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

// 景品を希望する場合は、規約への同意（最後のチェックボックス）にチェックを入れるまで、「送信する」を押せない。
// 景品を希望しない場合は、同意の欄が表示されないので、そのまま送信できる。
function syncSubmit(){
	submitBtn.disabled=prizeRequested.checked && !consent.checked;
}
function syncPrize(){
	// disabledの間は必須チェックの対象外になります。
	shipping.hidden=shipping.disabled=!prizeRequested.checked;
	syncSubmit();
}
// メールアドレス：全角の英数字・記号（＠ など）は半角にそろえ、空白は取り除く。形は、サーバー（submit_survey）の検査と同じ。
// 入力欄を type="email" にしないのは、ブラウザが、全角のまま送信をはばんで、そろえる前に、分かりにくい警告を出すため。
const EMAIL_PATTERN=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
function normalizeEmail(value){
	const v=value.normalize("NFKC").replace(/\s+/g,"");
	const local=v.split("@")[0];
	const ok=v.length<=254 && EMAIL_PATTERN.test(v) && local.length<=64 && !/^\.|\.$|\.\./.test(local);
	return ok ? v : null;
}

prizeRequested.onchange=syncPrize;
consent.onchange=syncSubmit;
syncPrize(); // 再読み込みで、ブラウザがチェックの状態を戻した場合にも、画面とボタンの状態をそろえる

// 「すきまキッズラボに参加していない方へ」の質問（きっかけ）：ワークショップに「参加していない」と答えたときだけ出す
function syncMotivation(){
	motivationBlock.hidden=surveyForm.elements.workshop.value!=="not_attended";
}
surveyForm.querySelectorAll('input[name="workshop"]').forEach(radio=>radio.addEventListener("change",syncMotivation));
syncMotivation();
// 「はい／いいえ」の質問の答え：はい＝true・いいえ＝false（選んでいなければ null）
const yesNo=name=>{ const value=surveyForm.elements[name].value; return value==="yes"?true:value==="no"?false:null; };
// SQL（新しい質問への対応）を、まだ実行していない間は、新しい引数を受け付ける関数が、サーバーにない（PGRST202）。そのときは、これまでの質問の答えだけを送る
const isMissingFunction=error=>!!error&&(error.code==="PGRST202"||/Could not find the function|schema cache/i.test(String(error.message||"")));

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

// 端末に「回答済み」の印があるとき、サーバーに回答が、本当にあるかを確かめる。管理者がアンケートの回答を削除していたら、印を消して、答え直せるようにする。
// 確かめられないとき（通信できない・新しい関数がまだない）は、これまでどおり、回答済みとして扱う。
async function surveyStillSubmitted(){
	try{
		const state=await db.rpc("rally_reset_state",{p_participant_id:participant});
		if(!state.error&&state.data&&state.data.survey_submitted===false){
			try{ localStorage.removeItem(submittedKey); }catch(e){ /* 消せなくても、このページは、答え直せる */ }
			return false;
		}
	}catch(e){ console.error(e); }
	return true;
}

async function start(){
	if(debugOn){
		previewMode=true;
		previewLabel="デバッグ";
		participantId.value=participant||"（デバッグ）";
		lead.textContent="デバッグ中のアンケート画面です。";
		const banner=document.getElementById("previewBanner");
		banner.innerHTML="<strong>デバッグ中（チーム用）：</strong>この画面は動作確認用です。<strong>送信しても記録は保存されません。</strong>デバッグを終わるときはスタンプラリーの画面の「デバッグを終わる」を押してください。";
		banner.hidden=false;
		surveyForm.hidden=false;
		loadPrivacy();
		return;
	}
	if(wantsPreview&&await isAdminSession()){
		previewMode=true;
		participantId.value=participant||"（プレビュー）";
		lead.textContent="アンケートの確認画面です。";
		document.getElementById("previewBanner").hidden=false;
		surveyForm.hidden=false;
		loadPrivacy();
		return;
	}
	const previewHint=wantsPreview?" 管理者プレビューを使うには先に管理画面（admin/）でログインしてください。":"";
	if(!participant) return block(RESULT_MESSAGES.invalid_participant+previewHint);
	if(safeGet(submittedKey)===participant && await surveyStillSubmitted()) return block(RESULT_MESSAGES.already_submitted);
	const completion=await db.rpc("is_completed",{p_participant_id:participant});
	if(completion.error){
		console.error(completion.error);
		return block("コンプリート状況を確認できませんでした。通信環境をご確認のうえ再読み込みしてください。");
	}
	if(!completion.data) return block(RESULT_MESSAGES.not_completed+"スタンプラリーのページで取得状況をご確認ください。"+previewHint);
	lead.textContent="オリジナルマステをゲットできる条件を達成しました！アンケートにご協力ください。";
	surveyForm.hidden=false;
	loadPrivacy();
}

surveyForm.onsubmit=async e=>{
	e.preventDefault();
	message.textContent="";
	const prize=prizeRequested.checked;
	const postalValue=prize ? normalizePostal(postal.value) : null;
	const phoneValue=prize ? normalizePhone(phone.value) : null;
	const emailValue=prize ? normalizeEmail(email.value) : null;
	if(prize && !postalValue) return message.textContent=RESULT_MESSAGES.invalid_postal;
	if(prize && !phoneValue) return message.textContent=RESULT_MESSAGES.invalid_phone;
	if(prize && !emailValue) return message.textContent=RESULT_MESSAGES.invalid_email;

	if(previewMode){ // プレビューでは、入力の確認までを行い、送信（記録）はしない
		return block(prize ? `【${previewLabel}】送信ありがとうございました。景品の発送先を受け付けました。（記録は保存されていません）` : `【${previewLabel}】送信ありがとうございました。（記録は保存されていません）`);
	}
	submitBtn.disabled=true;
	submitBtn.textContent="送信中…";
	const answers={
		p_participant_id:participant,
		p_satisfaction:Number(satisfaction.value), // 「今回のスタンプラリーは楽しかったですか？」（1〜5）
		p_memorable_spot:null, // 印象に残ったスポットの質問は廃止（掲示板に名前がなくなったため）。引数だけ残してある
		p_comment:comment.value.trim()||null, // 「その他、ご意見・ご感想」
		p_prize_requested:prize,
		p_recipient_name:prize ? recipientName.value.trim() : null,
		p_postal_code:postalValue,
		p_address:prize ? address.value.trim() : null,
		p_phone:phoneValue,
		p_consent:prize && consent.checked,
		p_workshop_participation:surveyForm.elements.workshop.value||null,
		p_privacy_version:prize ? privacyVersion : null,
		p_email:emailValue
	};
	const added={
		p_visited_new_place:yesNo("visitedNewPlace"),
		p_checks_boards:yesNo("checksBoards"),
		p_saw_other_notices:yesNo("sawOtherNotices"),
		p_motivation:motivationBlock.hidden ? null : (motivation.value.trim()||null) // 「参加していない」と答えた方だけの質問
	};
	let result=await db.rpc("submit_survey",{...answers,...added});
	if(isMissingFunction(result.error)) result=await db.rpc("submit_survey",answers); // SQLを、まだ更新していない間は、これまでの質問の答えだけを送る
	submitBtn.textContent="送信する";
	syncSubmit();

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
