const $=(id)=>document.getElementById(id);
async function render(){try{const s=await window.elpCompanion.status();$('state').innerHTML=`<div class="metric"><small>DEVICE</small><b>${escapeText(s.label||s.deviceId)}</b></div><div class="metric"><small>STATUS</small><b class="${s.enrolled?'ok':'bad'}">${s.enrolled?'ENROLLED':'NOT ENROLLED'}</b></div><div class="metric"><small>PRINCIPAL</small><b>${escapeText(s.principalId||'—')}</b></div><div class="metric"><small>LAST POLL</small><b>${s.lastPollAt?new Date(s.lastPollAt).toLocaleTimeString():'—'}</b></div>`;$('error').textContent=s.lastError||'';$('enrollCard').hidden=s.enrolled;$('signedCard').hidden=!s.enrolled;}catch(e){$('error').textContent=e instanceof Error?e.message:String(e);}}
function escapeText(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
$('refresh').addEventListener('click',()=>void render());
$('openElp').addEventListener('click',()=>void window.elpCompanion.open('https://elpgpt.com/authority-control'));
$('enroll').addEventListener('click',async()=>{try{$('error').textContent='';await window.elpCompanion.enroll($('token').value.trim(),$('label').value.trim());$('token').value='';await render();}catch(e){$('error').textContent=e instanceof Error?e.message:String(e);}});
$('signout').addEventListener('click',async()=>{try{await window.elpCompanion.signOut();await render();}catch(e){$('error').textContent=e instanceof Error?e.message:String(e);}});
void render();setInterval(()=>void render(),10000);
