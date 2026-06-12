let CHAT_MESSAGES=[];let SESSION_KEY=null;let starredIds=new Set();let matches=[];let currentMatch=-1;let selectedMessageId=null;
const $=id=>document.getElementById(id);
const loginScreen=$("loginScreen"),chatApp=$("chatApp"),loginForm=$("loginForm"),passwordInput=$("passwordInput"),loginError=$("loginError"),togglePassword=$("togglePassword"),chat=$("chat");
$("loginPhoto").src=CHAT_CONFIG.loginPhoto;
togglePassword.onclick=()=>passwordInput.type=passwordInput.type==="password"?"text":"password";
loginForm.onsubmit=async e=>{e.preventDefault();loginError.textContent="";try{const {messages,key}=await decryptChat(passwordInput.value);CHAT_MESSAGES=messages;SESSION_KEY=key;starredIds=new Set(loadStarred());loginScreen.hidden=true;chatApp.hidden=false;setupHeader();renderChat()}catch{loginError.textContent="La contraseña no es correcta."}};
async function decryptChat(password){const enc=new TextEncoder(),salt=b64(ENCRYPTED_CHAT.salt),iv=b64(ENCRYPTED_CHAT.iv),data=b64(ENCRYPTED_CHAT.data);const material=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:ENCRYPTED_CHAT.iterations,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["decrypt"]);const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,data);return{messages:JSON.parse(new TextDecoder().decode(raw)),key}}
function b64(v){const s=atob(v);return Uint8Array.from(s,c=>c.charCodeAt(0))}
function setupHeader(){$("contactName").textContent=CHAT_CONFIG.contactName;$("contactStatus").textContent=CHAT_CONFIG.status;$("profilePhoto").src=CHAT_CONFIG.profilePhoto}
async function decryptMedia(info){
  const response=await fetch(info.encryptedPath,{cache:"no-store"});
  if(!response.ok)throw new Error(`No se pudo descargar ${info.encryptedPath}: ${response.status}`);
  const encrypted=await response.arrayBuffer();
  const raw=await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:b64(info.iv)},
    SESSION_KEY,
    encrypted
  );
  return URL.createObjectURL(new Blob([raw],{type:info.mime}));
}
async function createMedia(item){
  const wrap=document.createElement("div");
  wrap.className="media-wrap";

  try{
    if(!item.secureMedia)throw new Error("Archivo multimedia no encontrado");

    const url=await decryptMedia(item.secureMedia);

    if(["image","sticker"].includes(item.mediaType)){
      const img=document.createElement("img");
      img.src=url;
      img.className=item.mediaType==="sticker"?"message-sticker":"message-media";
      img.onerror=()=>{
        URL.revokeObjectURL(url);
        wrap.innerHTML="";
        const missing=document.createElement("div");
        missing.className="missing-media";
        missing.textContent="No se pudo mostrar: "+(item.fileName||"imagen");
        wrap.appendChild(missing);
      };
      wrap.appendChild(img);
    }else if(item.mediaType==="video"){
      const video=document.createElement("video");
      video.src=url;
      video.controls=true;
      video.preload="metadata";
      video.className="message-video";
      wrap.appendChild(video);
    }else if(item.mediaType==="audio"){
      const audio=document.createElement("audio");
      audio.src=url;
      audio.controls=true;
      audio.preload="metadata";
      audio.className="message-audio";
      wrap.appendChild(audio);
    }else{
      const link=document.createElement("a");
      link.href=url;
      link.download=item.fileName||"archivo";
      link.className="document-card";
      link.textContent="📄 "+(item.fileName||"Documento");
      wrap.appendChild(link);
    }
  }catch(error){
    console.warn("Multimedia omitida sin detener el chat:",item.fileName,error);
    const missing=document.createElement("div");
    missing.className="missing-media";
    missing.textContent="No se pudo cargar: "+(item.fileName||"archivo");
    wrap.appendChild(missing);
  }

  return wrap;
}
async function renderChat(){
  chat.innerHTML='<div class="loading-chat">Cargando conversación…</div>';
  let fragment=document.createDocumentFragment();
  let last="";
  let rendered=0;

  for(const item of CHAT_MESSAGES){if(item.date!==last){last=item.date;const d=document.createElement("div");d.className="date-divider";d.dataset.date=item.date;d.textContent=item.displayDate;fragment.appendChild(d)}if(item.type==="system"){const s=document.createElement("div");s.className="system-message";s.textContent=item.text;fragment.appendChild(s);continue}const b=document.createElement("article");b.className="message "+item.side;b.dataset.messageId=item.id;b.dataset.searchText=((item.text||"")+" "+(item.fileName||"")).toLowerCase();if(item.secureMedia||item.missingMedia)b.appendChild(await createMedia(item));const row=document.createElement("div");row.className="message-row";const visible=item.deleted?"Se eliminó este mensaje.":(item.caption||(!item.secureMedia?item.text:""));if(visible){const t=document.createElement("div");t.className="message-text";t.textContent=visible;t.dataset.original=visible;row.appendChild(t)}const meta=document.createElement("div");meta.className="meta";meta.innerHTML=(starredIds.has(item.id)?'<span class="star-indicator">★</span>':'')+`<span>${item.time}</span>`+(item.side===CHAT_CONFIG.mySide?'<svg class="read-ticks" viewBox="0 0 20 12"><path d="M1.5 6.5 5 10l6.7-8"/><path d="M7 7.2 10 10l8-8"/></svg>':'');row.appendChild(meta);b.appendChild(row);b.onclick=e=>openMessageMenu(item.id,e);fragment.appendChild(b);
    rendered++;

    if(rendered%250===0){
      const loading=chat.querySelector(".loading-chat");
      if(loading)loading.remove();
      chat.appendChild(fragment);
      fragment=document.createDocumentFragment();
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
  }

  const loading=chat.querySelector(".loading-chat");
  if(loading)loading.remove();
  if(fragment.childNodes.length)chat.appendChild(fragment);

  configureDatePicker();
  chat.scrollTop=chat.scrollHeight;
}
const menuButton=$("menuButton"),menuPanel=$("menuPanel"),toolPanel=$("toolPanel"),searchTools=$("searchTools"),dateTools=$("dateTools"),messageMenu=$("messageMenu");
menuButton.onclick=e=>{e.stopPropagation();menuPanel.hidden=!menuPanel.hidden};document.onclick=e=>{if(!menuPanel.contains(e.target)&&e.target!==menuButton)menuPanel.hidden=true;if(!messageMenu.contains(e.target)&&!e.target.closest(".message"))messageMenu.hidden=true};
menuPanel.onclick=e=>{const a=e.target.dataset.action;if(!a)return;menuPanel.hidden=true;if(a==="search")openOnly("search");if(a==="date")openOnly("date");if(a==="starred")openStarred();if(a==="theme"){document.body.classList.toggle("dark");localStorage.setItem("viewer-theme",document.body.classList.contains("dark")?"dark":"light")}if(a==="print")window.print();if(a==="logout")location.reload()};
function openOnly(which){toolPanel.hidden=false;searchTools.hidden=which!=="search";dateTools.hidden=which!=="date";if(which==="search")$("searchInput").focus()}
function closeTools(){toolPanel.hidden=true;searchTools.hidden=true;dateTools.hidden=true;$("searchInput").value="";$("searchCount").textContent="";matches=[];currentMatch=-1;document.querySelectorAll(".active-match").forEach(x=>x.classList.remove("active-match"));document.querySelectorAll(".message-text").forEach(t=>{if(t.dataset.original)t.textContent=t.dataset.original})}
$("closeSearch").onclick=closeTools;$("closeDate").onclick=closeTools;
$("searchInput").oninput=()=>{const q=$("searchInput").value.trim().toLowerCase();matches=[];currentMatch=-1;document.querySelectorAll(".message").forEach(el=>{el.classList.remove("active-match");const t=el.querySelector(".message-text");if(t&&t.dataset.original)t.textContent=t.dataset.original;if(q&&(el.dataset.searchText||"").includes(q)){matches.push(el);if(t){const safe=q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");t.innerHTML=t.dataset.original.replace(new RegExp(safe,"gi"),m=>`<mark>${m}</mark>`)}}});if(matches.length){currentMatch=0;focusMatch()}else $("searchCount").textContent=""};
function focusMatch(){document.querySelectorAll(".active-match").forEach(x=>x.classList.remove("active-match"));const t=matches[currentMatch];if(!t)return;t.classList.add("active-match");t.scrollIntoView({behavior:"smooth",block:"center"});$("searchCount").textContent=`${currentMatch+1}/${matches.length}`}
$("nextResult").onclick=()=>{if(matches.length){currentMatch=(currentMatch+1)%matches.length;focusMatch()}};$("prevResult").onclick=()=>{if(matches.length){currentMatch=(currentMatch-1+matches.length)%matches.length;focusMatch()}};
function configureDatePicker(){
  const dates=[...new Set(CHAT_MESSAGES.map(item=>item.date).filter(Boolean))].sort();
  const picker=$("datePicker");
  if(!dates.length)return;
  picker.min=dates[0];
  picker.max=dates[dates.length-1];
  if(!picker.value)picker.value=dates[dates.length-1];
}

$("goDate").onclick=()=>{
  const selected=$("datePicker").value;
  if(!selected)return;

  const target=chat.querySelector(`.date-divider[data-date="${CSS.escape(selected)}"]`);
  if(!target){
    const button=$("goDate");
    const original=button.textContent;
    button.textContent="Sin mensajes";
    setTimeout(()=>button.textContent=original,1400);
    return;
  }

  target.scrollIntoView({behavior:"smooth",block:"start"});
  target.classList.add("date-highlight");
  setTimeout(()=>target.classList.remove("date-highlight"),1600);
};
function storageKey(){return"starred-"+CHAT_CONFIG.storageNamespace}function loadStarred(){try{return JSON.parse(localStorage.getItem(storageKey())||"[]")}catch{return[]}}function saveStarred(){localStorage.setItem(storageKey(),JSON.stringify([...starredIds]))}
function openMessageMenu(id,e){selectedMessageId=id;$("toggleStarMessage").textContent=starredIds.has(id)?"★ Quitar de destacados":"☆ Destacar";const r=document.querySelector(".phone-shell").getBoundingClientRect();messageMenu.style.left=Math.max(8,Math.min(e.clientX-r.left,r.width-190))+"px";messageMenu.style.top=Math.max(66,Math.min(e.clientY-r.top,r.height-70))+"px";messageMenu.hidden=false}
function updateStarIndicator(messageId){
  const bubble=chat.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if(!bubble)return;

  const meta=bubble.querySelector(".meta");
  if(!meta)return;

  const currentStar=meta.querySelector(".star-indicator");
  const shouldBeStarred=starredIds.has(messageId);

  if(shouldBeStarred && !currentStar){
    const star=document.createElement("span");
    star.className="star-indicator";
    star.setAttribute("aria-label","Mensaje destacado");
    star.textContent="★";
    meta.prepend(star);
  }else if(!shouldBeStarred && currentStar){
    currentStar.remove();
  }
}

function syncAllStarIndicators(){
  chat.querySelectorAll(".message[data-message-id]").forEach(bubble=>{
    updateStarIndicator(bubble.dataset.messageId);
  });
}

$("toggleStarMessage").onclick=()=>{
  const messageId=selectedMessageId;
  if(!messageId)return;

  if(starredIds.has(messageId)){
    starredIds.delete(messageId);
  }else{
    starredIds.add(messageId);
  }

  saveStarred();
  updateStarIndicator(messageId);
  messageMenu.hidden=true;
  selectedMessageId=null;
};
function openStarred(){closeTools();renderStarred();$("starredPanel").hidden=false}
function renderStarred(){const list=$("starredList");list.innerHTML="";const items=CHAT_MESSAGES.filter(x=>starredIds.has(x.id));$("starredCount").textContent=`${items.length} ${items.length===1?"mensaje":"mensajes"}`;for(const item of items){const b=document.createElement("button");b.className="starred-item";b.innerHTML=`<span class="starred-item-date">${item.displayDate} · ${item.time}</span><span>${escapeHtml(item.text||item.fileName||"Multimedia")}</span>`;b.onclick=()=>{$("starredPanel").hidden=true;const t=document.querySelector(`[data-message-id="${CSS.escape(item.id)}"]`);if(t){t.scrollIntoView({behavior:"smooth",block:"center"});t.classList.add("active-match");setTimeout(()=>t.classList.remove("active-match"),1500)}};list.appendChild(b)}}
$("closeStarred").onclick=()=>$("starredPanel").hidden=true;
$("exportStarred").onclick=()=>{
  const blob=new Blob(
    [JSON.stringify({messageIds:[...starredIds]},null,2)],
    {type:"application/json"}
  );
  const a=document.createElement("a");
  const url=URL.createObjectURL(blob);
  a.href=url;
  a.download="mensajes-destacados.json";
  a.click();
  URL.revokeObjectURL(url);
};
$("importStarredButton").onclick=()=>$("importStarredInput").click();
$("importStarredInput").onchange=async()=>{
  try{
    const file=$("importStarredInput").files[0];
    if(!file)return;

    const payload=JSON.parse(await file.text());
    starredIds=new Set(
      (payload.messageIds||[]).filter(id=>CHAT_MESSAGES.some(item=>item.id===id))
    );

    saveStarred();
    syncAllStarIndicators();
    renderStarred();
  }catch{
    alert("Archivo inválido");
  }finally{
    $("importStarredInput").value="";
  }
};
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
if(localStorage.getItem("viewer-theme")==="dark")document.body.classList.add("dark");
