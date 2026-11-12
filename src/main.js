import './style.css';
import {onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut} from 'firebase/auth';
import {auth} from './firebase.js';
import {today} from '../server/domain.js';

const root = document.querySelector('#app');
const names = {dashboard:'Visão geral',catalog:'Catálogo',stock:'Estoque',production:'Produção',sales:'Vendas internas',reports:'Relatórios',users:'Usuários',audit:'Auditoria'};
const icons = {dashboard:'▦',catalog:'◇',stock:'▤',production:'⊞',sales:'⇄',reports:'▥',users:'♙',audit:'◷'};
const types = {producao:'Produção',venda:'Venda',devolucao:'Devolução / estorno',perda:'Perda',ajusteEntrada:'Ajuste de entrada',ajusteSaida:'Ajuste de saída'};
const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const state = {page:'dashboard', products:[], variants:[], filters:{}, busy:false};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const brl = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value / 100);
const date = value => value?.split('-').reverse().join('/') ?? '—';
const timestamp = value => value?._seconds != null ? new Date(value._seconds * 1000).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}) : '—';
const admin = () => state.profile?.role === 'admin';
const option = (value,label,selected) => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
const input = (name,label,value='',type='text',attrs='') => '<label>' + esc(label) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + attrs + '></label>';
const select = (name,label,options) => '<label>' + esc(label) + '<select name="' + name + '">' + options + '</select></label>';
const button = (label,action,value='') => '<button type="button" class="secondary" data-action="' + action + '" data-value="' + esc(value) + '">' + label + '</button>';
const table = (head,body) => '<div class="table-wrap"><table><thead><tr>' + head.map(x=>'<th>' + x + '</th>').join('') + '</tr></thead><tbody>' + (body.length ? body.map(row=>'<tr>' + row.map(x=>'<td>' + x + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + head.length + '" class="empty">Nenhum registro encontrado.</td></tr>') + '</tbody></table></div>';
const panel = (title,content) => '<section class="panel"><h2>' + title + '</h2>' + content + '</section>';
const brand = '<div class="brand"><span>M</span><div>Gestao<strong>Mona</strong><small>Gestão de confecção</small></div></div>';

async function api(action,data={}) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch('/api/gestao',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},body:JSON.stringify({action,...data})});
  const result = await response.json().catch(() => {
    throw new Error('A API do GestaoMona retornou uma resposta inesperada (HTTP ' + response.status + '). Consulte os logs da função /api/gestao.');
  });
  if (!response.ok) throw new Error(result.error);
  return result;
}

function notice(message,error=false) {
  const area = document.querySelector('#notice');
  if (area) {
    area.textContent = message;
    area.classList.toggle('error',error);
    area.hidden = !message;
  }
}

function login(message='') {
  root.innerHTML = '<main class="login"><div class="login-brand">' + brand + '<h1>Estoque e produção em um só lugar.</h1><p>Acompanhe o que sua fábrica produz, vende e precisa repor.</p></div><section><form id="login"><h2>Acesse sua conta</h2><p>Use o e-mail cadastrado pela empresa.</p>' + input('email','E-mail','','email','required autocomplete="username"') + input('password','Senha','','password','required autocomplete="current-password"') + '<button>Entrar</button>' + button('Recuperar senha','reset') + '<p id="notice" role="status" hidden></p></form></section></main>';
  notice(message,true);
}

function layout() {
  const allowed = Object.keys(names).filter(page => admin() || !['users','audit'].includes(page));
  root.innerHTML = '<div class="shell"><aside id="sidebar">' + brand + '<nav aria-label="Menu principal">' + allowed.map(page=>'<button data-action="nav" data-value="' + page + '" class="' + (page===state.page?'active':'') + '"><span aria-hidden="true">' + icons[page] + '</span>' + names[page] + '</button>').join('') + '</nav><footer><strong>' + (admin()?'Administrador':'Colaborador') + '</strong><small>' + esc(state.profile.email) + '</small>' + button('Sair da conta','logout') + '</footer></aside><main><header><button class="menu secondary" data-action="menu" aria-controls="sidebar" aria-expanded="false">☰ Menu</button><h1>' + names[state.page] + '</h1></header><div id="notice" role="status" hidden></div><div id="content" aria-busy="true" class="empty">Carregando…</div></main></div>';
}

function filters() {
  const current = state.filters;
  const options = key => [...new Set(state.variants.map(v=>v[key]).filter(Boolean))].sort().map(v=>option(v,v,current[key])).join('');
  return '<form id="filters" class="toolbar">' +
    input('start','De',current.start || today().slice(0,4)+'-01-01','date','required') +
    input('end','Até',current.end || today(),'date','required') +
    select('productId','Produto',option('','Todos') + state.products.map(p=>option(p.id,p.name,current.productId)).join('')) +
    ['category','collection','size','color'].map((key,i)=>select(key,['Categoria','Coleção','Tamanho','Cor'][i],option('','Todos')+options(key))).join('') +
    (state.page==='production' ? input('reference','Lote',current.reference || '') : '') +
    (['dashboard','reports'].includes(state.page) ? input('compare','Comparar com ano',current.compare || '', 'number','min="1900" max="' + today().slice(0,4) + '"') : '') +
    '<button>Filtrar</button></form>';
}

function chart(report,compare) {
  const max = Math.max(1,...report.months.map(Math.abs),...(compare?.months ?? []).map(Math.abs));
  const peak = Math.max(0,...report.months);
  const peaks = months.filter((_,i)=>peak && report.months[i] === peak);
  const current = state.filters.end || today();
  return '<p class="muted">' + (peaks.length ? 'Pico de vendas líquidas: ' + peaks.join(', ') + ' (' + peak + ' un.)' : 'Sem pico positivo de vendas no período.') + '</p><div class="chart">' + months.map((label,i)=>{
    const units = report.months[i];
    const prior = compare?.months[i];
    const unfinished = current.slice(0,4) === today().slice(0,4) && i+1 >= Number(today().slice(5,7));
    return '<div class="month"><div class="bars"><span class="' + (units === peak && peak ? 'peak':'') + '" style="height:' + Math.max(2,Math.abs(units)/max*100) + '%" title="' + units + ' unidades"></span>' +
      (prior == null ? '' : '<span class="prior" style="height:' + Math.max(2,Math.abs(prior)/max*100) + '%" title="' + prior + ' unidades no ano comparado"></span>') +
      '</div><strong>' + units + (prior == null ? '' : ' / ' + prior) + '</strong><small>' + label + (unfinished?'*':'') + '</small></div>';
  }).join('') + '</div><p class="muted">* Mês em andamento ou futuro.' + (compare ? ' Valores na ordem: período selecionado / ' + esc(state.filters.compare) + '.' : '') + '</p>';
}

async function dashboard() {
  const selected = state.filters;
  const end = selected.end || today();
  const year = end.slice(0,4);
  const annual = {...selected,start:year+'-01-01',end:year===today().slice(0,4)?today():year+'-12-31'};
  const compareYear = selected.compare;
  const reportRequest=api('report',selected);
  const [report, trend, compare, recent] = await Promise.all([
    reportRequest, (selected.start || annual.start)===annual.start && end===annual.end ? reportRequest : api('report',annual),
    compareYear ? api('report',{...selected,start:compareYear+'-01-01',end:compareYear===today().slice(0,4)?today():compareYear+'-12-31'}) : null,
    api('history',selected)
  ]);
  const low = state.variants.filter(v=>v.active && state.products.some(p=>p.id===v.productId && p.active) && v.stock<=v.minimum && ['productId','category','collection','size','color'].every(k=>!selected[k]||selected[k]===v[k]));
  const metrics = [['Produzidas',report.produced],['Vendas brutas',report.sold],['Devoluções',report.returned],['Vendas líquidas',report.sold-report.returned]];
  if (admin()) metrics.push(['Receita líquida',brl(report.revenue)],['Margem conhecida',brl(report.margin)]);
  return filters() + (state.page==='reports' ? '<div class="actions">' + button('Exportar estoque','csv','stock') + button('Exportar produção','csv','producao') + button('Exportar vendas','csv','sales') + '</div>' : '') +
    '<div class="metrics">' + metrics.map(([label,value])=>'<article><span>' + label + '</span><strong>' + value + '</strong></article>').join('') + '</div>' +
    panel('Vendas mensais · ' + year,chart(trend,compare)) +
    '<div class="columns">' + panel('Mais vendidos',table(['Produto','Unidades líquidas',...(admin()?['Valor líquido']:[])],report.ranking.map(x=>[esc(x.name),x.qty,...(admin()?[brl(x.amount)]:[])]))) +
    panel('Saída por tamanho e cor',table(['Variação','Unidades líquidas'],report.sizes.map(x=>[esc(x[0]),x[1]]))) + '</div>' +
    (admin() ? panel('Ranking por valor líquido',table(['Produto','Valor líquido'],[...report.ranking].sort((a,b)=>b.amount-a.amount).map(x=>[esc(x.name),brl(x.amount)]))) : '') +
    panel('Reposição',stockTable(low)) + panel('Últimas movimentações',historyTable(recent.rows.slice(0,8)));
}

function stockTable(variants) {
  return table(['Produto','SKU','Tamanho','Cor','Saldo','Mínimo','Situação'],variants.map(v=>[
    esc(v.name),esc(v.sku),esc(v.size),esc(v.color),v.stock,v.minimum,
    '<span class="pill ' + (v.stock<=v.minimum?'critical':'') + '">' + (!v.active?'Arquivado':v.stock===0?'Zerado':v.stock<=v.minimum?'Reposição':'Disponível') + '</span>'
  ]));
}

function catalogView() {
  return '<div class="toolbar">' + input('search','Buscar produto ou SKU') +
    [['category','Categoria'],['collection','Coleção'],['size','Tamanho'],['color','Cor']].map(([key,label])=>
      select(key,label,option('','Todos')+[...new Set(state.variants.map(v=>v[key]).filter(Boolean))].sort().map(x=>option(x,x)).join(''))
    ).join('') +
    select('stockStatus','Estoque',option('','Todos')+option('zero','Zerado')+option('low','Abaixo ou no mínimo')+option('available','Acima do mínimo')) +
    (admin()?button('Novo produto','product',''):'') + '</div><div id="products">' + productList() + '</div><div id="detail"></div>';
}

function productList(filters={}) {
  const needle = (filters.search??'').trim().toLocaleLowerCase('pt-BR');
  const products = state.products.filter(p=>state.variants.some(v=>{
    if (v.productId!==p.id || ![p.name,p.reference,v.sku].some(x=>x.toLowerCase().includes(needle))) return false;
    if (['category','collection','size','color'].some(key=>filters[key] && v[key]!==filters[key])) return false;
    switch(filters.stockStatus) {
      case 'zero': return v.stock===0;
      case 'low': return v.stock<=v.minimum;
      case 'available': return v.stock>v.minimum;
      default: return true;
    }
  }));
  return table(['Peça','Referência','Categoria','Coleção','Status',''],products.map(p=>[
    '<strong>' + esc(p.name) + '</strong>',esc(p.reference),esc(p.category),esc(p.collection),p.active?'Ativo':'Arquivado',button('Detalhes','detail',p.id)
  ]));
}

async function productDetail(id) {
  const product = state.products.find(p=>p.id===id);
  const variants = state.variants.filter(v=>v.productId===id);
  const [prices,history, totals] = await Promise.all([
    api('prices',{id}),api('history',{productId:id,start:'1900-01-01'}),api('report',{productId:id,start:'1900-01-01'})
  ]);
  const photo = product.image ? '<img class="photo" src="' + esc(product.image) + '" alt="' + esc(product.name) + '" referrerpolicy="no-referrer">' : '<div class="photo fallback">Sem imagem</div>';
  document.querySelector('#detail').innerHTML = panel(esc(product.name),'<div class="product-detail">' + photo + '<div><p>' + esc(product.description) + '</p><p>Produzidas: ' + totals.produced + ' · Vendidas: ' + totals.sold + ' · Devolvidas: ' + totals.returned + '</p>' + (admin()?button('Editar produto','product',id):'') + '</div></div>' +
    table(['SKU','Tamanho / cor','Saldo','Preço',...(admin()?['Custo']:[])],variants.map(v=>[esc(v.sku),esc(v.size+' / '+v.color),v.stock,brl(v.price),...(admin()?[v.cost==null?'—':brl(v.cost)]:[])]))) +
    panel('Histórico de preços',table(['SKU','Anterior','Novo','Registro','Usuário','Motivo'],prices.map(x=>[esc(x.sku),x.before==null?'—':brl(x.before),brl(x.after),timestamp(x.at),esc(x.uid),esc(x.reason)]))) +
    panel('Movimentações recentes',historyTable(history.rows));
}

function variantLine(v={}) {
  const money = n => n==null?'':(n/100).toFixed(2);
  return '<div class="line variant">' + input('sku','SKU',v.sku,'text',v.sku?'required readonly':'required pattern="[a-zA-Z0-9_\\-]+"') +
    input('size','Tamanho',v.size??'Único','text','required') + input('color','Cor',v.color,'text','required') +
    input('minimum','Estoque mínimo',v.minimum??0,'number','required min="0"') + input('price','Preço (R$)',money(v.price),'number','required min="0" step="0.01"') +
    input('cost','Custo (R$)',money(v.cost),'number','min="0" step="0.01"') +
    select('active','Status',option('true','Ativo',String(v.active!==false))+option('false','Arquivado',String(v.active!==false))) +
    (v.sku?'':button('Remover','remove')) + '</div>';
}

function productForm(id) {
  const p = state.products.find(x=>x.id===id) ?? {};
  const variants = state.variants.filter(v=>v.productId===id);
  modal(p.id?'Editar produto':'Novo produto','<form id="product" data-id="' + esc(id) + '"><div class="form-grid">' +
    input('name','Nome',p.name,'text','required') + input('reference','Referência',p.reference,'text','required') +
    input('category','Categoria',p.category,'text','required') + input('collection','Coleção',p.collection) +
    input('description','Descrição',p.description) + input('image','URL HTTPS da foto',p.image,'url') +
    select('active','Status',option('true','Ativo',String(p.active!==false))+option('false','Arquivado',String(p.active!==false))) +
    input('reason','Motivo da alteração de preço') + '</div><div id="image-preview"></div><h3>Variações</h3><div id="lines">' +
    (variants.length?variants.map(variantLine).join(''):variantLine()) + '</div><div class="actions">' + button('Adicionar variação','add-variant') + '<button>Salvar produto</button></div></form>');
  previewImage(p.image);
}

function previewImage(url) {
  const area = document.querySelector('#image-preview');
  if (!area) return;
  area.innerHTML = /^https:\/\//i.test(url ?? '') ? '<img class="photo" src="' + esc(url) + '" alt="Prévia da foto" referrerpolicy="no-referrer">' : '';
}

function historyTable(records) {
  return table(['Data comercial','Operação','Referência','Itens','Usuário','Registro',...(admin()?['Total','']:[])],records.map(r=>[
    date(r.date),types[r.type],esc(r.reference || r.note || '—'),
    r.items.map(i=>esc(i.sku) + ' × ' + i.qty + ' (saldo ' + i.stock + ')').join('<br>'),
    esc(r.uid),timestamp(r.at),
    ...(admin()?[['venda','devolucao'].includes(r.type)?brl(r.items.reduce((sum,i)=>sum+i.total,0)):'—',r.type==='venda'?button('Devolver / estornar','return',r.id):'']:[])
  ]));
}

async function historyPage() {
  const matches = {production:['producao'],sales:['venda','devolucao']};
  const result = await api('history',{...state.filters,cursor:state.cursor,types:matches[state.page]});
  const totals = state.page==='production' ? await api('report',state.filters) : null;
  const pages = {
    stock:[...(admin()?[button('Ajuste de entrada','operation','ajusteEntrada'),button('Ajuste de saída','operation','ajusteSaida'),button('Registrar perda','operation','perda')]:[])],
    production:[button('Registrar lote','operation','producao')],
    sales:[button('Registrar venda externa','operation','venda')]
  };
  const records = result.rows;
  return '<div class="actions">' + pages[state.page].join('') + '</div>' +
    (state.page==='stock'?panel('Saldo por SKU',stockTable(state.variants.filter(v=>['productId','category','collection','size','color'].every(k=>!state.filters[k]||state.filters[k]===v[k])))):'') + filters() +
    panel('Histórico',(totals ? '<p class="muted">Total produzido no filtro: ' + totals.produced + ' unidades</p>' : '') + historyTable(records) + '<div class="actions">' + (state.cursor?button('Primeira página','cursor'):'') +
    (result.cursor?button('Próxima página','cursor',result.cursor):'') + '</div>');
}

function operationLine(type) {
  const eligible = state.variants.filter(v=>v.active && state.products.some(p=>p.id===v.productId&&p.active));
  return '<div class="line operation-line">' + select('sku','Variação',eligible.map(v=>option(v.sku,v.name+' · '+v.sku+' · '+v.stock+' em estoque'+(type==='venda'?' · '+brl(v.price):''))).join('')) +
    input('qty','Quantidade',1,'number','required min="1"') +
    (type==='venda'&&admin()?input('price','Preço negociado (R$)','','number','min="0" step="0.01"')+input('discount','Desconto por unidade (R$)','','number','min="0" step="0.01"'):'') + button('Remover','remove') + '</div>';
}

function operationForm(type,original) {
  const returnItems = original?.items.map(i=>({...i,remaining:i.qty-(original.returned?.[i.sku]??0)})).filter(i=>i.remaining>0);
  const draft = original?.id ?? type;
  const previous = sessionStorage.getItem('mona-operation-'+draft);
  const id = previous ? JSON.parse(previous).id : crypto.randomUUID();
  modal(types[type],'<form id="operation" data-type="' + type + '" data-id="' + id + '" data-original="' + esc(original?.id) + '"><div class="form-grid">' +
    input('date','Data comercial',today(),'date','required max="' + today() + '"') +
    input('reference',type==='producao'?'Lote':'Referência','','text',type==='producao'?'required':'') +
    (type==='venda'?input('channel','Canal'):'') +
    input('note',['venda','producao'].includes(type)?'Observação / justificativa':'Justificativa','','text',['venda','producao'].includes(type)?'':'required') +
    (original?'<label class="check"><input type="checkbox" name="restock" checked> Peças retornaram ao estoque</label>':'') +
    '</div><h3>Itens</h3><div id="lines">' +
    (original?returnItems.map(i=>'<div class="line operation-line" data-sku="' + esc(i.sku) + '">' + input('sku','SKU',i.sku,'text','readonly') + input('qty','Quantidade (máx. '+i.remaining+')',0,'number','required min="0" max="' + i.remaining + '"') + '</div>').join(''):operationLine(type)) +
    '</div><div class="actions">' + (original?button('Preencher devolução total','return-all'):button('Adicionar item','add-operation',type)) +
    (type==='venda'?'<strong id="sale-total"></strong>':'') +
    '<button>Confirmar lançamento</button></div></form>');
  if (previous) {
    const pending = JSON.parse(previous);
    const form = document.querySelector('#operation');
    for (const k of ['date','reference','channel','note']) if (form.elements[k]) form.elements[k].value = pending[k];
    if (form.elements.restock) form.elements.restock.checked = pending.restock;
    if (!original) document.querySelector('#lines').innerHTML = pending.items.map(()=>operationLine(type)).join('');
    document.querySelectorAll('.operation-line').forEach((line,i)=>{
      const item = original?pending.items.find(x=>x.sku===line.dataset.sku):pending.items[i];
      if (!item) return;
      for (const k of ['sku','qty','price','discount']) {
        const field = line.querySelector('[name="'+k+'"]');
        if (field) field.value = ['price','discount'].includes(k) && item[k]!=null ? item[k]/100 : item[k]??'';
      }
    });
  }
  saleTotal();
}

function saleTotal() {
  const output = document.querySelector('#sale-total');
  if (!output) return;
  let total = 0;
  for (const row of document.querySelectorAll('.operation-line')) {
    const data = readLine(row);
    const variant = state.variants.find(v=>v.sku===data.sku);
    total += (money(data.price) ?? variant?.price ?? 0) * Number(data.qty) - (money(data.discount)??0) * Number(data.qty);
  }
  output.textContent = 'Total: ' + brl(total);
}

function modal(title,content) {
  document.querySelector('dialog')?.remove();
  root.insertAdjacentHTML('beforeend','<dialog><header><h2>' + title + '</h2>' + button('Fechar','close') + '</header><p id="dialog-notice" role="alert" class="error" hidden></p>' + content + '</dialog>');
  const dialog = document.querySelector('dialog');
  dialog.addEventListener('cancel',event=>{ if(state.busy) event.preventDefault(); });
  dialog.showModal();
}

async function usersView() {
  const users = await api('users');
  return '<div class="actions">' + button('Adicionar usuário','user') + '</div>' + panel('Contas da equipe',table(['E-mail','Perfil','Status',''],users.map(u=>[
    esc(u.email),u.role==='admin'?'Administrador':'Colaborador',u.active?'Ativo':'Inativo',
    button('Editar','user',JSON.stringify(u))
  ])));
}

async function render() {
  layout();
  const target = document.querySelector('#content');
  try {
    let content;
    switch (state.page) {
      case 'catalog': content=catalogView(); break;
      case 'dashboard': case 'reports': content=await dashboard(); break;
      case 'stock': case 'sales': case 'production': content=await historyPage(); break;
      case 'users': content=await usersView(); break;
      case 'audit': content=panel('Últimos eventos',table(['Operação','Alvo','Usuário','Justificativa','Registro'],(await api('audit')).map(x=>[esc(types[x.type]??x.type),esc(x.target),esc(x.uid),esc(x.reason),timestamp(x.at)]))); break;
    }
    target.innerHTML = content;
    target.classList.remove('empty');
  } catch(error) {
    target.textContent = error.message;
  } finally {
    target.setAttribute('aria-busy','false');
  }
}

const money = value => value == null || value==='' ? null : Math.round(Number(value)*100);
const dataOf = form => Object.fromEntries(new FormData(form));
const readLine = line => Object.fromEntries([...line.querySelectorAll('input,select')].map(el=>[el.name,el.value]));
const refresh = async () => Object.assign(state,await api('catalog'));

root.addEventListener('submit',async event=>{
  event.preventDefault();
  if(state.busy) return;
  const form = event.target;
  const data = dataOf(form);
  state.busy = true;
  const submit = form.querySelector('button:not([type="button"])');
  if (submit) submit.disabled=true;
  try {
    switch(form.id) {
      case 'login': await signInWithEmailAndPassword(auth,data.email.trim(),data.password).catch(()=>{throw new Error('Não foi possível entrar. Confira o e-mail e a senha.');}); return;
      case 'filters': state.filters=data; state.cursor=null; await render(); return;
      case 'product':
        await api('saveProduct',{...data,id:form.dataset.id,active:data.active==='true',variants:[...form.querySelectorAll('.variant')].map(row=>{
          const v=readLine(row);
          return {...v,active:v.active==='true',minimum:Number(v.minimum),price:money(v.price),cost:money(v.cost)};
        })});
        break;
      case 'operation': {
        const {type,id,original}=form.dataset;
        if (!['venda','producao'].includes(type) && !window.confirm('Confirmar ' + types[type].toLowerCase() + '?')) return;
        const payload = {...data,type,id,original,restock:data.restock==='on',items:[...form.querySelectorAll('.operation-line')].map(row=>{
          const i=readLine(row);
          return {sku:i.sku,qty:Number(i.qty),price:money(i.price),discount:money(i.discount)};
        }).filter(i=>i.qty>0)};
        const draftKey='mona-operation-'+(original||type);
        sessionStorage.setItem(draftKey,JSON.stringify(payload));
        await api('record',payload);
        sessionStorage.removeItem(draftKey);
        break;
      }
      case 'user':
        await api('saveUser',{...data,active:data.active==='true'});
        if (data.invite==='on') {
          try { await sendPasswordResetEmail(auth,data.email.trim()); }
          catch { throw new Error('A conta foi salva. O e-mail de definição de senha precisa ser reenviado.'); }
        }
        break;
    }
    await refresh();
    await render();
    notice('Registro salvo.');
  } catch(error) {
    const alert=document.querySelector('#dialog-notice');
    if(alert){alert.textContent=error.message;alert.hidden=false;}
    else notice(error.message,true);
  } finally {
    state.busy=false;
    if(submit) submit.disabled=false;
  }
});

function csv(rows,filename) {
  const content = rows.map(row=>row.map(value=>{
    const cell=String(value??'');
    const safe=/^[\s]*[=+@-]/.test(cell)&&typeof value!=='number'?"'"+cell:cell;
    return '"' + safe.replaceAll('"','""') + '"';
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff',content],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');
  anchor.href=url; anchor.download=filename+'.csv'; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function exportCsv(kind) {
  if (kind==='stock') {
    const variants=state.variants.filter(v=>['productId','category','collection','size','color'].every(k=>!state.filters[k]||state.filters[k]===v[k]));
    csv([['SKU','Produto','Tamanho','Cor','Saldo','Mínimo'],...variants.map(v=>[v.sku,v.name,v.size,v.color,v.stock,v.minimum])],'estoque');
    return;
  }
  const report=await api('report',{...state.filters,export:true});
  const rows=report.rows.filter(r=>kind==='sales'?['venda','devolucao'].includes(r.type):r.type===kind);
  csv([['Data comercial','Tipo','Referência','SKU','Produto','Quantidade','Movimento de estoque',...(admin()?['Total (centavos)']:[])],
    ...rows.flatMap(r=>r.items.map(i=>[r.date,types[r.type],r.reference,i.sku,i.name,i.qty,i.delta,...(admin()?[i.total]:[])]))],kind);
}

root.addEventListener('click',async event=>{
  const control=event.target.closest('[data-action]');
  if(!control || state.busy) return;
  const {action,value}=control.dataset;
  try {
    switch(action){
      case 'menu': control.setAttribute('aria-expanded',String(document.querySelector('#sidebar').classList.toggle('open'))); break;
      case 'nav': state.page=value;state.cursor=null;delete state.filters.reference; await render(); break;
      case 'reset': {
        const email=document.querySelector('[name=email]').value.trim();
        if(!email) throw new Error('Informe seu e-mail para recuperar a senha.');
        await sendPasswordResetEmail(auth,email).catch(error=>{if(error.code!=='auth/user-not-found') throw error;});
        notice('Se a conta estiver cadastrada, você receberá um link por e-mail.'); break;
      }
      case 'logout': await signOut(auth); break;
      case 'detail': await productDetail(value); break;
      case 'product': productForm(value); break;
      case 'close': document.querySelector('dialog')?.remove(); break;
      case 'operation': operationForm(value); break;
      case 'return': {
        const original=await api('sale',{id:value});
        operationForm('devolucao',original); break;
      }
      case 'return-all': document.querySelectorAll('#lines [name=qty]').forEach(input=>{input.value=input.max;}); break;
      case 'add-variant': document.querySelector('#lines').insertAdjacentHTML('beforeend',variantLine()); break;
      case 'add-operation': document.querySelector('#lines').insertAdjacentHTML('beforeend',operationLine(value)); saleTotal(); break;
      case 'remove': control.closest('.line').remove(); saleTotal(); break;
      case 'cursor': state.cursor=value||null; await render(); break;
      case 'csv': await exportCsv(value); break;
      case 'user': {
        const u=value?JSON.parse(value):{};
        modal(value?'Editar usuário':'Adicionar usuário','<form id="user">' +
          input('email','E-mail',u.email,'email',value?'required readonly':'required') +
          select('role','Perfil',option('colaborador','Colaborador',u.role)+option('admin','Administrador',u.role)) +
          select('active','Status',option('true','Ativo',String(u.active!==false))+option('false','Inativo',String(u.active!==false))) +
          '<label class="check"><input type="checkbox" name="invite"' + (value?'':' checked') + '> Enviar e-mail para definir senha</label><button>Salvar usuário</button></form>');
        break;
      }
    }
  } catch(error) {notice(error.message,true);}
});

root.addEventListener('input',event=>{
  const name=event.target.name;
  const productTable = document.querySelector('#products');
  if (productTable && event.target.closest('#content > .toolbar')) {
    productTable.innerHTML=productList(readLine(event.target.closest('.toolbar')));
  }
  if(name==='image') previewImage(event.target.value);
  if(event.target.closest('#operation')) saleTotal();
});
root.addEventListener('error',event=>{
  if(event.target instanceof HTMLImageElement) {
    const placeholder=document.createElement('div');
    placeholder.className='photo fallback';
    placeholder.textContent='Imagem indisponível';
    event.target.replaceWith(placeholder);
  }
},true);

root.innerHTML='<main class="empty">Carregando GestaoMona…</main>';
onAuthStateChanged(auth,async user=>{
  if(!user){state.profile=null;state.page='dashboard';state.filters={};state.cursor=null;login(state.loginError);state.loginError='';return;}
  try {
    state.profile=await api('profile');
    await refresh();
    await render();
  } catch(error) {
    state.loginError=error.message;
    await signOut(auth);
  }
});

