const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
let options={}, currentCategory='', currentSpecial='', currentAsset=null;
const canonical={
  category:['COMPUTADOR','IMPRESSORA','MONITOR','TABLET','PERIFÉRICO'],
  status:['ATIVO','EM USO','EM ESTOQUE','MANUTENÇÃO','QUARENTENA','BAIXADO'],
  area:['FÁBRICA','VAREJO','ATACADO','E-COMMERCE','CAFÉ'],
  department:['COMERCIAL','DHO','RH','ESTÚDIO','MARKETING','ESTILO','FISCAL','DIRETORIA','FINANCEIRO','FACILITIES','EXPEDIÇÃO'],
  operating_system:['WINDOWS 10 PRO','WINDOWS 11 PRO','WINDOWS 11 HOME','LINUX','SEM SO'],
  ram:['4 GB DDR3','4 GB DDR4','8 GB DDR3','8 GB DDR4','8 GB DDR5','12 GB DDR4','16 GB DDR3','16 GB DDR4','16 GB DDR5','24 GB DDR4','24 GB DDR5','32 GB DDR4','32 GB DDR5','64 GB DDR4','64 GB DDR5'],
  storage:['128 GB','256 GB','512 GB','1 TB','2 TB']
};
const fixedOnly=new Set(['status','area','department','operating_system','storage']);
const fieldDefs=[
  {k:'asset_code',l:'Identificação do ativo',type:'text'},
  {k:'category',l:'Tipo de ativo',type:'select',required:true},
  {k:'status',l:'Status',type:'select',required:true},
  {k:'area',l:'Área',type:'select',required:true},
  {k:'department',l:'Setor',type:'select'},
  {k:'subcategory',l:'Subcategoria',type:'text'},
  {k:'owner',l:'Responsável',type:'text'},
  {k:'brand',l:'Marca',type:'text'},
  {k:'model',l:'Modelo',type:'text',required:true},
  {k:'serial',l:'Serial / Service Tag',type:'text',required:true},
  {k:'hostname',l:'Hostname',type:'text',group:'computer'},
  {k:'ip',l:'IP',type:'text'},
  {k:'operating_system',l:'Sistema operacional',type:'select',group:'computer'},
  {k:'processor',l:'Processador',type:'text',group:'computer'},
  {k:'ram',l:'RAM / Tipo de memória',type:'select',group:'computer'},
  {k:'storage',l:'Armazenamento',type:'select',group:'computer'},
  {k:'notes',l:'Observações',type:'textarea',className:'wide'}
];
function mergedOptions(k){const vals=fixedOnly.has(k)?(canonical[k]||[]):[...(canonical[k]||[]),...(options[k]||[])];return [...new Set(vals)].filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'))}
function formOptions(k){return k==='category'?(canonical.category||[]):mergedOptions(k)}
async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt}); const ct=r.headers.get('content-type')||''; const d=ct.includes('json')?await r.json():await r.text(); if(!r.ok)throw new Error(d.error||'Erro'); return d}
async function init(){try{let me=await api('/api/me'); if(me.authenticated){await showApp(me.user)}else $('#login').classList.remove('hidden')}catch(e){$('#loginError').textContent=e.message}}
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{let d=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});await showApp(d.user)}catch(err){$('#loginError').textContent=err.message}};
async function showApp(user){
  $('#login').classList.add('hidden');$('#app').classList.remove('hidden');
  $('#avatar').textContent=(user.display_name||user.username).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  renderForm(); // render immediately so Novo Ativo always works
  try{options=await api('/api/options');fillFilters();renderForm()}catch(err){console.warn('Opções não carregadas:',err)}
  await showDashboard();
}
function fillFilters(){[['#catFilter','category'],['#areaFilter','area'],['#statusFilter','status']].forEach(([sel,key])=>{let el=$(sel);if(!el)return;let first=el.options[0]?.outerHTML||'<option value="">Todos</option>';el.innerHTML=first+mergedOptions(key).map(v=>`<option value="${attr(v)}">${esc(v)}</option>`).join('')})}
function navActive(btn){$$('nav button').forEach(b=>b.classList.remove('active')); if(btn)btn.classList.add('active')}
$$('nav button').forEach(btn=>btn.onclick=()=>{
  navActive(btn);
  if(btn.dataset.special==='GUIDE_SHOP'){
    currentCategory='COMPUTADOR'; currentSpecial='GUIDE_SHOP'; showAssets('COMPUTADOR','GUIDE_SHOP');
  }else if(btn.dataset.category){
    currentCategory=btn.dataset.category; currentSpecial=''; showAssets(currentCategory);
  }else if(btn.dataset.view==='dashboard'){
    currentCategory=''; currentSpecial=''; showDashboard();
  }else if(btn.dataset.view==='supplies'){
    currentCategory=''; currentSpecial=''; showSupplies();
  }else if(btn.dataset.view==='audit'){
    currentCategory=''; currentSpecial=''; showAudit();
  }else if(btn.dataset.view==='team'){
    currentCategory=''; currentSpecial=''; showTeam();
  }
});
function setView(id,title,sub){$$('.view').forEach(v=>v.classList.add('hidden'));$('#'+id).classList.remove('hidden');$('#pageTitle').textContent=title;$('#pageSub').textContent=sub||''}
async function showDashboard(){setView('dashboard','Visão geral','Parque tecnológico da empresa');let d=await api('/api/dashboard');let cards=[['Ativos cadastrados',d.total],['Em quarentena',d.quarantine],['Windows 10',d.windows10],['Alertas de suprimentos',d.supply_alerts]];$('#dashboard').innerHTML=`<div class="kpis">${cards.map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div><div class="dashboard-grid"><div class="card"><h3>Ativos por categoria</h3>${bars(d.categories)}</div><div class="card"><h3>Distribuição por área</h3>${bars(d.areas)}</div></div><div class="dashboard-grid"><div class="card"><h3>Status</h3>${bars(d.statuses)}</div><div class="card"><h3>Atenção do TI</h3><p style="color:var(--muted);line-height:1.7;margin:0">${d.windows10} computadores ainda aparecem com Windows 10. ${d.quarantine} itens estão em quarentena e ${d.supply_alerts} suprimentos exigem revisão de estoque.</p></div></div>`}
function bars(items){let max=Math.max(1,...items.map(x=>x.value));return `<div class="bars">${items.map(x=>`<div class="bar-row"><span>${esc(x.label||'N/I')}</span><div class="track"><div class="fill" style="width:${Math.round(x.value/max*100)}%"></div></div><b>${x.value}</b></div>`).join('')}</div>`}
async function showAssets(category='',special=''){
  currentCategory=category||'';
  currentSpecial=special||'';
  const dedicated=Boolean(currentCategory||currentSpecial);
  const title=currentSpecial==='GUIDE_SHOP'?'Guide Shop':(dedicated?titleCat(currentCategory):'Ativos');
  const sub=currentSpecial==='GUIDE_SHOP'?'Computadores exclusivos das lojas Guide Shop':(dedicated?`Somente ${titleCat(currentCategory).toLowerCase()} do inventário`:'Consulta e gestão de todo o inventário');
  setView('assets',title,sub);
  const cat=$('#catFilter');
  if(cat){
    cat.value='';
    cat.classList.toggle('hidden',dedicated);
  }
  await loadAssets();
}
function titleCat(c){return {'COMPUTADOR':'Computadores','IMPRESSORA':'Impressoras','MONITOR':'Monitores','TABLET':'Tablets','PERIFÉRICO':'Periféricos','QUARENTENA':'Quarentena'}[c]||c}
function assetTableLayout(category,special=''){
  if(special==='GUIDE_SHOP') return {
    head:['ID','Loja','Modelo','Serial','Processador','RAM','Armazenamento','Sistema','Hostname','Status'],
    cells:r=>[r.asset_code,r.owner||r.location||r.area||'-',r.model||r.brand||'-',r.serial||'-',r.processor||'-',r.ram||'-',r.storage||'-',r.operating_system||'-',r.hostname||'-',badge(r.status)]
  };
  if(category==='COMPUTADOR') return {
    head:['ID','Usuário','Modelo','Service Tag','Processador','RAM','Sistema operacional','Status'],
    cells:r=>[r.asset_code,r.owner||'-',r.model||r.brand||'-',r.serial||'-',r.processor||'-',r.ram||'-',r.operating_system||'-',badge(r.status)]
  };
  if(category==='IMPRESSORA') return {
    head:['ID','Modelo','Serial','Área / Loja','IP','Status'],
    cells:r=>[r.asset_code,r.model||r.brand||'-',r.serial||'-',r.area||r.owner||'-',r.ip||'-',badge(r.status)]
  };
  if(category==='MONITOR') return {
    head:['ID','Modelo','Serial','Área / Usuário','Status'],
    cells:r=>[r.asset_code,r.model||r.brand||'-',r.serial||'-',r.area||r.owner||'-',badge(r.status)]
  };
  if(category==='TABLET') return {
    head:['ID','Loja / Colaborador','Modelo','Marca','Status'],
    cells:r=>[r.asset_code,r.owner||r.area||r.location||'-',r.model||'-',r.brand||'-',badge(r.status)]
  };
  return {
    head:['ID do ativo','Categoria','Área / Usuário','Marca / Modelo','Serial','Status'],
    cells:r=>[r.asset_code,r.category,r.area||r.owner||r.location||'-',r.model||r.brand||'-',r.serial||'-',badge(r.status)]
  };
}
function badge(v){return `<span class="badge">${esc(v||'N/I')}</span>`}
async function loadAssets(){
  let p=new URLSearchParams();
  if($('#search').value)p.set('q',$('#search').value);
  const forcedCategory=currentCategory||'';
  const selectedCategory=!forcedCategory && $('#catFilter') ? $('#catFilter').value : '';
  if(forcedCategory)p.set('category',forcedCategory); else if(selectedCategory)p.set('category',selectedCategory);
  if(currentSpecial==='GUIDE_SHOP') p.set('area','GUIDE SHOP');
  else if($('#areaFilter').value)p.set('area',$('#areaFilter').value);
  if($('#statusFilter').value)p.set('status',$('#statusFilter').value);
  let rows=await api('/api/assets?'+p);
  if(forcedCategory==='COMPUTADOR' && !currentSpecial) rows=rows.filter(r=>String(r.area||'').toUpperCase()!=='GUIDE SHOP');
  const layout=assetTableLayout(forcedCategory||selectedCategory,currentSpecial);
  $('#assetHead').innerHTML=`<tr>${layout.head.map(h=>`<th>${esc(h)}</th>`).join('')}<th></th></tr>`;
  $('#assetRows').innerHTML=rows.map(r=>`<tr>${layout.cells(r).map((v,i)=>`<td>${i===0?'<b>'+esc(v)+'</b>':(String(v).startsWith('<span')?v:esc(v))}</td>`).join('')}<td><button class="icon-btn" onclick="openAsset(${r.id})" title="Abrir ativo">›</button></td></tr>`).join('')||`<tr><td colspan="${layout.head.length+1}">Nenhum ativo encontrado nesta categoria.</td></tr>`;
}
let searchTimer; $('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadAssets,250)};['#catFilter','#areaFilter','#statusFilter'].forEach(s=>$(s).onchange=loadAssets);
async function showSupplies(){setView('supplies','Suprimentos','Estoque de toner, tinta e cilindros');let rows=await api('/api/supplies');$('#supplyRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.printer_model)}</td><td>${esc(r.supply_type)}</td><td><b>${esc(r.supply_model)}</b></td><td>${r.quantity}</td><td>${r.minimum}</td><td><span class="badge ${r.alert?'alert':'good'}">${r.alert?'REPOR':'OK'}</span></td></tr>`).join('')}
async function showAudit(){
  setView('audit','Histórico','Registro de alterações e backups do sistema');
  const rows=await api('/api/audit?limit=250');
  $('#auditRows').innerHTML=rows.map(r=>`<tr><td>${esc(formatDate(r.created_at))}</td><td><b>${esc(r.actor||'sistema')}</b></td><td>${esc(r.action)}</td><td>${esc(r.entity_type||'-')}</td><td>${esc(r.details||'-')}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma ação registrada.</td></tr>';
  await loadBackups();
}
async function loadBackups(){
  const rows=await api('/api/backups');
  $('#backupList').innerHTML=rows.map(r=>`<div class="backup-item"><div><b>${esc(r.name)}</b><span>${esc(r.modified)}</span></div><small>${Math.max(1,Math.round(r.size/1024))} KB</small></div>`).join('')||'<span class="muted-copy">Nenhum backup criado ainda.</span>';
}
async function showTeam(){
  setView('team','Equipe','4 pessoas podem usar contas individuais com o mesmo acesso');
  const rows=await api('/api/users');
  $('#teamList').innerHTML=rows.map(r=>`<div class="team-item"><div class="avatar small-avatar">${esc(initials(r.display_name||r.username))}</div><div><b>${esc(r.display_name||r.username)}</b><span>@${esc(r.username)} · acesso TI completo</span></div><button class="danger mini" onclick="deleteUser(${r.id},'${attr(r.username)}')">Remover</button></div>`).join('');
}
function formatDate(v){if(!v)return '-';return String(v).replace('T',' ').replace('Z','')}
function initials(v){return String(v||'TI').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
window.deleteUser=async function(id,username){if(!confirm(`Remover o usuário ${username}?`))return;try{await api('/api/users/'+id,{method:'DELETE'});toast('Usuário removido.');showTeam()}catch(e){toast(e.message,true)}}

function renderForm(){
  let html='';
  for(const f of fieldDefs){
    const req=f.required?' required':'';
    if(f.type==='textarea'){
      html+=`<label class="${f.className||''}"${f.group?` data-group="${f.group}"`:''}>${f.l}<textarea id="f_${f.k}" rows="3"></textarea></label>`;
      continue;
    }
    if(f.type==='select'){
      html+=`<label class="${f.className||''}"${f.group?` data-group="${f.group}"`:''}>${f.l}<select id="f_${f.k}"${req}><option value="">Selecione...</option>${formOptions(f.k).map(v=>`<option value="${attr(v)}">${esc(v)}</option>`).join('')}</select></label>`;
      continue;
    }
    html+=`<label class="${f.className||''}"${f.group?` data-group="${f.group}"`:''}>${f.l}<input id="f_${f.k}"${req}></label>`;
  }
  $('.form-grid').innerHTML=html;
  $('#f_category')?.addEventListener('change',updateCategoryFields);
  $('#f_area')?.addEventListener('change',updateAreaFields);
  updateCategoryFields();
  updateAreaFields();
}
function updateCategoryFields(){
  const cat=$('#f_category')?.value||'';
  const computer=cat==='COMPUTADOR';
  $$('[data-group="computer"]').forEach(label=>{
    label.classList.toggle('hidden',!computer);
    const el=label.querySelector('input,select,textarea');
    if(el)el.disabled=!computer;
  });
}
function updateAreaFields(){
  const area=$('#f_area')?.value||'';
  const factory=area==='FÁBRICA';
  const department=$('#f_department');
  const label=department?.closest('label');
  if(!department||!label)return;
  label.classList.toggle('hidden',!factory);
  department.disabled=!factory;
  department.required=factory;
  if(!factory)department.value='';
}
function ensureForm(){if(!$('#f_category'))renderForm()}
function renderAssetSummary(a){
  const box=$('#assetSummary');
  if(!box)return;
  if(!a){box.classList.add('hidden');box.innerHTML='';return;}
  box.innerHTML=`<div><span>Identificação do ativo</span><strong>${esc(a.asset_code||'Sem identificação')}</strong></div><div><span>Tipo</span><strong>${esc(a.category||'-')}</strong></div><div><span>Status</span><strong>${esc(a.status||'-')}</strong></div>`;
  box.classList.remove('hidden');
}
window.openNewAsset=function(){ try{ openAsset(); }catch(err){ console.error(err); alert('Não foi possível abrir o cadastro: '+err.message); } };
$('#newBtn')?.addEventListener('click',e=>{e.preventDefault();window.openNewAsset()});
async function openAsset(id){
  ensureForm();
  currentAsset=null;
  $('#assetId').value=id||'';
  fieldDefs.forEach(f=>{const el=$('#f_'+f.k);if(el)el.value=''});
  $('#history').innerHTML='';
  renderAssetSummary(null);
  $('#moveBtn').classList.toggle('hidden',!id);
  $('#retireBtn').classList.toggle('hidden',!id);
  $('#modalTitle').textContent=id?'Editar ativo':'Novo ativo';
  $('#modalSubtitle').textContent=id?'Atualize os dados e salve as alterações':'Cadastre um novo item no inventário';

  if(!id){
    $('#f_status').value='ATIVO';
    $('#f_category').value='COMPUTADOR';
    updateCategoryFields();
    updateAreaFields();
  }

  if(id){
    let d=await api('/api/assets/'+id);
    currentAsset=d.asset;
    renderAssetSummary(d.asset);
    fieldDefs.forEach(f=>{
      const el=$('#f_'+f.k);
      if(el)el.value=d.asset[f.k]||'';
    });
    updateCategoryFields();
    updateAreaFields();
    $('#modalTitle').textContent=`Editar ${d.asset.category||'ativo'}${d.asset.model?' · '+d.asset.model:''}`;
    $('#history').innerHTML=`<div class="history"><h4>Histórico</h4>${d.movements.map(m=>`<div class="history-item"><b>${esc(m.action)}</b> · ${esc(m.actor||'sistema')}<br><span>${esc(m.created_at)} ${m.note?'— '+esc(m.note):''}</span></div>`).join('')||'<span>Sem movimentações.</span>'}</div>`;
  }

  $('#modal').classList.remove('hidden');
  $('#modal').setAttribute('aria-hidden','false');
  setTimeout(()=>$('#f_category')?.focus(),0);
}
window.openAsset=openAsset;
function closeModal(){$('#modal').classList.add('hidden');$('#modal').setAttribute('aria-hidden','true')}
$('#closeModal').onclick=$('#cancelBtn').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').classList.contains('hidden'))closeModal()});
$('#assetForm').onsubmit=async e=>{
  e.preventDefault();

  // Em edição, preserva campos antigos que não aparecem neste formulário.
  // Em cadastro novo, começa vazio e força a categoria COMPUTADOR.
  let b=currentAsset?{...currentAsset}:{};

  fieldDefs.forEach(f=>{
    const el=$('#f_'+f.k);
    b[f.k]=el?el.value.trim():'';
  });

  if(!currentAsset){
    b.subcategory='';
    b.location='';
    b.owner='';
    b.brand='';
    b.hostname='';
  }
  if(b.area!=='FÁBRICA')b.department='';
  if(b.category!=='COMPUTADOR'){
    b.operating_system='';
    b.processor='';
    b.ram='';
    b.storage='';
  }

  let id=$('#assetId').value;

  try{
    let result=await api(id?'/api/assets/'+id:'/api/assets',{
      method:id?'PUT':'POST',
      body:JSON.stringify(b)
    });
    closeModal();
    toast(id?'Ativo atualizado com sucesso.':(result.asset_code?`Ativo ${result.asset_code} cadastrado com sucesso.`:'Ativo cadastrado com sucesso.'));
    await showAssets(currentCategory,currentSpecial);
  }catch(err){
    toast(err.message,true);
  }
};
$('#moveBtn').onclick=()=>{
  if(!currentAsset)return;
  $('#moveLocation').value=currentAsset.location||'';
  $('#moveOwner').value=currentAsset.owner||'';
  $('#moveNote').value='';
  $('#moveTitle').textContent=`Movimentar ${currentAsset.asset_code||'ativo'}`;
  $('#moveModal').classList.remove('hidden');
  $('#moveModal').setAttribute('aria-hidden','false');
  setTimeout(()=>$('#moveLocation').focus(),0);
};
function closeMoveModal(){$('#moveModal').classList.add('hidden');$('#moveModal').setAttribute('aria-hidden','true')}
$('#closeMoveModal').onclick=$('#cancelMoveBtn').onclick=closeMoveModal;
$('#moveModal').addEventListener('click',e=>{if(e.target===$('#moveModal'))closeMoveModal()});
$('#moveForm').onsubmit=async e=>{
  e.preventDefault(); if(!currentAsset)return;
  try{
    await api('/api/assets/'+currentAsset.id+'/move',{method:'POST',body:JSON.stringify({location:$('#moveLocation').value.trim(),owner:$('#moveOwner').value.trim(),note:$('#moveNote').value.trim()})});
    closeMoveModal(); toast('Movimentação registrada.'); await openAsset(currentAsset.id);
  }catch(err){toast(err.message,true)}
};
$('#retireBtn').onclick=async()=>{if(!confirm('Marcar este ativo como BAIXADO?'))return;await api('/api/assets/'+currentAsset.id,{method:'DELETE'});closeModal();toast('Ativo marcado como baixado.');showAssets(currentCategory,currentSpecial)};
$('#refreshAudit')?.addEventListener('click',showAudit);
$('#backupBtn')?.addEventListener('click',async()=>{try{let r=await api('/api/backup',{method:'POST',body:'{}'});toast('Backup criado: '+r.name);await loadBackups()}catch(e){toast(e.message,true)}});
$('#userForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify({display_name:$('#newDisplayName').value,username:$('#newUsername').value,password:$('#newPassword').value})});e.target.reset();toast('Usuário criado com sucesso.');await showTeam()}catch(err){toast(err.message,true)}});
$('#exportBtn').onclick=()=>location.href='/api/export.csv';$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()};
function toast(msg,isError=false){const t=$('#toast');t.textContent=msg;t.classList.toggle('error-toast',isError);t.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add('hidden'),3500)}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(v){return esc(v).replace(/`/g,'&#96;')}
init();
