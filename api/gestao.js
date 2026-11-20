import {applicationDefault, cert, getApps, initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {commercialDate, ensure, field, integer, operationItems, summarize, today} from '../server/domain.js';

function firebase() {
  const {FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY} = process.env;
  return getApps()[0] ?? initializeApp({
    projectId:FIREBASE_PROJECT_ID || 'gestaomona-60d33',
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : {
      credential:FIREBASE_PRIVATE_KEY && FIREBASE_CLIENT_EMAIL
        ? cert({projectId:FIREBASE_PROJECT_ID, clientEmail:FIREBASE_CLIENT_EMAIL, privateKey:FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')})
        : applicationDefault()
    })
  });
}

function key(value) {
  const clean = field(value, 80, true);
  ensure(/^[a-zA-Z0-9_-]+$/.test(clean) && !/^__.*__$/.test(clean), 'Código inválido. Use letras, números, hífen ou sublinhado.');
  return clean;
}

function rows(snapshot) {
  return snapshot.docs.map(doc => ({id:doc.id, ...doc.data()}));
}

function operational(record) {
  const {items, note, ...rest} = record;
  return {...rest, note:record.type==='venda' ? '' : note, items:items.map(({sku,qty,delta,stock,name,size,color,productId,category,collection}) =>
    ({sku,qty,delta,stock,name,size,color,productId,category,collection}))};
}

async function catalog(db, admin) {
  const [products, variants] = await Promise.all([db.collection('products').get(), db.collection('variants').get()]);
  return {
    products:rows(products),
    variants:rows(variants).map(({cost,...variant}) => admin ? {...variant,cost} : variant)
  };
}

async function verifyWriter(transaction, db, uid, adminRequired) {
  const profile = (await transaction.get(db.collection('users').doc(uid))).data();
  ensure(profile?.active && ['admin','colaborador'].includes(profile.role), 'Conta sem acesso ao MD sport fit.',403);
  ensure(!adminRequired || profile.role === 'admin','Acesso administrativo necessário.',403);
  return profile.role === 'admin';
}

async function saveProduct(db, body, uid) {
  const ref = body.id ? db.collection('products').doc(key(body.id)) : db.collection('products').doc();
  const product = {
    name:field(body.name,120,true), reference:field(body.reference,80,true),
    category:field(body.category,80,true), collection:field(body.collection,80),
    description:field(body.description,1000), image:field(body.image,1000), active:body.active !== false
  };
  if (product.image) {
    let url;
    try { url = new URL(product.image); } catch { ensure(false,'Informe uma URL de imagem válida.'); }
    ensure(url.protocol === 'https:' && !url.username && !url.password, 'A imagem precisa de uma URL HTTPS.');
  }
  ensure(Array.isArray(body.variants) && body.variants.length && body.variants.length <= 30, 'Cadastre de 1 a 30 variações por produto.');
  const variants = body.variants.map(v => ({
    sku:key(v.sku).toUpperCase(), size:field(v.size,40,true), color:field(v.color,40,true),
    minimum:integer(v.minimum), price:integer(v.price), cost:v.cost == null ? null : integer(v.cost),
    active:v.active !== false, productId:ref.id, name:product.name, category:product.category, collection:product.collection
  }));
  ensure(new Set(variants.map(v => v.sku)).size === variants.length, 'SKU repetido.');
  const reason = field(body.reason,300);
  await db.runTransaction(async transaction => {
    await verifyWriter(transaction,db,uid,true);
    const current = await transaction.get(ref);
    ensure(!body.id || current.exists, 'Produto não encontrado.', 404);
    const existing = await transaction.get(db.collection('variants').where('productId','==',ref.id));
    const refs = variants.map(v => db.collection('variants').doc(v.sku));
    const snapshots = await transaction.getAll(...refs);
    ensure(existing.docs.every(doc => variants.some(v => v.sku === doc.id)), 'Arquive as variações que saíram de linha.');
    ensure(snapshots.every(doc => !doc.exists || doc.data().productId === ref.id), 'SKU já cadastrado em outro produto.',409);
    transaction.set(ref, product);
    for (const [i, variant] of variants.entries()) {
      const before = snapshots[i].data();
      transaction.set(refs[i], {...variant, stock:before?.stock ?? 0});
      if (before?.price !== variant.price) {
        transaction.create(ref.collection('prices').doc(), {
          sku:variant.sku, before:before?.price ?? null, after:variant.price, reason, uid, at:FieldValue.serverTimestamp()
        });
      }
    }
    transaction.create(db.collection('audit').doc(), {type:'produto', target:ref.id, uid, at:FieldValue.serverTimestamp(), reason});
  });
  return {id:ref.id};
}


async function saveCustomer(db,body,uid) {
 const ref=db.collection('customers').doc(body.id?key(body.id):key(body.newId));
 const data={};
 for(const [name,max] of Object.entries({name:120,document:30,email:254,phone:40,birthDate:10,postalCode:12,street:150,number:20,complement:100,district:80,city:80,state:2,notes:1000})) data[name]=field(body[name],max,name==='name');
 ensure(!data.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),'E-mail inválido.');
 if(data.birthDate) commercialDate(data.birthDate);
 data.active=body.active!==false;
 await db.runTransaction(async t=>{
  await verifyWriter(t,db,uid,false);
  const before=await t.get(ref);
  ensure(!body.id||before.exists,'Cliente não encontrado.',404);
  t.set(ref,{...data,createdAt:before.data()?.createdAt??FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  t.create(db.collection('audit').doc(),{type:'cliente',target:ref.id,uid,at:FieldValue.serverTimestamp()});
 });
 return {id:ref.id};
}
async function customerHistory(db,body,admin) {
 const id=key(body.id);
 const year=String(body.year||today().slice(0,4));
 ensure(/^\d{4}$/.test(year)&&Number(year)>=1900&&Number(year)<=Number(today().slice(0,4)),'Ano inválido.');
 ensure((await db.collection('customers').doc(id).get()).exists,'Cliente não encontrado.',404);
 const query=db.collection('operations').where('customerId','==',id).orderBy('__name__');
 let cursor,history=[],monthly=Array(12).fill(0),purchases=0,units=0;
 do {
  const page=await (cursor?query.startAfter(cursor):query).limit(250).get();
  for(const {signature,...record} of rows(page)){
   if(!['venda','devolucao'].includes(record.type))continue;
   history.push(admin?record:operational(record));
   if(!record.date.startsWith(year+'-'))continue;
   const sign=record.type==='venda'?1:-1;
   if(sign===1)purchases++;
   for(const item of record.items){units+=sign*item.qty;monthly[Number(record.date.slice(5,7))-1]+=sign*(admin?item.total:item.qty);}
  }
  cursor=page.size===250?page.docs.at(-1):null;
 }while(cursor);
 history.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
 const offset=body.cursor?history.findIndex(r=>r.id===body.cursor)+1:0;
 const selected=history.slice(offset,offset+50);
 return {rows:selected,cursor:offset+50<history.length?selected.at(-1).id:null,monthly,purchases,units,measure:admin?'value':'units'};
}
async function record(db, body, uid, admin) {
  const type = body.type;
  const adminTypes = ['devolucao','perda','ajusteEntrada','ajusteSaida'];
  ensure(['producao','venda',...adminTypes].includes(type), 'Operação inválida.');
  ensure(admin || !adminTypes.includes(type), 'Operação exclusiva do administrador.',403);
  const date = commercialDate(body.date);
  const reference = field(body.reference,100,type === 'producao');
  const channel = field(body.channel,80);
  const note = field(body.note,500,adminTypes.includes(type));
  const customerId=type==='venda'&&body.customerId?key(body.customerId):null;
  const restock = body.restock === true;
  const id = key(body.id);
  const entry = db.collection('operations').doc(id);
  const source = type === 'devolucao' ? db.collection('operations').doc(key(body.original)) : null;
  ensure(Array.isArray(body.items) && body.items.length && body.items.length <= 30, 'Informe de 1 a 30 itens.');
  const lines = body.items.map(item => ({...item,sku:key(item.sku).toUpperCase()}));
  ensure(new Set(lines.map(line => line.sku)).size === lines.length, 'Informe cada SKU uma única vez.');
  const refs = lines.map(item => db.collection('variants').doc(item.sku));
  const signature = JSON.stringify([type,date,reference,channel,note,restock,source?.id,lines,...(customerId?[customerId]:[])]);
  return db.runTransaction(async transaction => {
    const canAdmin = await verifyWriter(transaction,db,uid,adminTypes.includes(type));
    if (type === 'venda' && canAdmin && lines.some(item => item.price != null || item.discount > 0)) field(note,500,true);
    const duplicate = await transaction.get(entry);
    if (duplicate.exists) {
      ensure(duplicate.data().uid === uid && duplicate.data().signature === signature, 'Identificador de operação já utilizado.',409);
      return {id};
    }
    const original = source ? (await transaction.get(source)).data() : null;
    if (source) ensure(original?.type === 'venda' && original.date <= date,'Venda original inválida ou posterior à devolução.');
    const customer=customerId?(await transaction.get(db.collection('customers').doc(customerId))).data():null;
    if(customerId)ensure(customer?.active,'Cliente inativo ou não encontrado.');
    const variants = (await transaction.getAll(...refs)).map(snap => snap.data());
    ensure(variants.every(Boolean),'Variação não encontrada.',404);
    if (!source) {
      const products = [...new Set(variants.map(v => v.productId))].map(id => db.collection('products').doc(id));
      ensure((await transaction.getAll(...products)).every(doc => doc.data()?.active), 'Produto arquivado.');
    }
    const items = operationItems(type,lines,variants,original,canAdmin,restock);
    for (const [i, item] of items.entries()) transaction.update(refs[i], {stock:item.stock});
    transaction.create(entry, {customerId:original?.customerId??customerId,customerName:original?.customerName??customer?.name??'',type,date,reference,channel,note,uid,signature,items,original:source?.id ?? null,restock,at:FieldValue.serverTimestamp()});
    if (source) {
      const returned = {...original.returned};
      for (const item of items) returned[item.sku] = (returned[item.sku] ?? 0) + item.qty;
      transaction.update(source,{returned});
    }
    if (adminTypes.includes(type)) transaction.create(db.collection('audit').doc(), {type,target:id,uid,reason:note,at:FieldValue.serverTimestamp()});
    return {id};
  });
}

async function records(db, body, admin, report) {
  const end = commercialDate(body.end || today());
  const start = commercialDate(body.start || end.slice(0,4) + '-01-01');
  ensure(start <= end, 'A data inicial deve ser anterior à final.');
  const query = db.collection('operations').where('date','>=',start).where('date','<=',end).orderBy('date','desc');
  let cursor = body.cursor && !report ? await db.collection('operations').doc(key(body.cursor)).get() : null;
  const selected = [];
  const reference = field(body.reference,100);
  do {
    const page = await (cursor?.exists ? query.startAfter(cursor) : query).limit(report ? 250 : 50).get();
    cursor = page.docs.at(-1);
    for (const item of rows(page)) {
      if (reference && item.reference !== reference) continue;
      const {signature,...clean} = item;
      clean.items = clean.items.filter(line => ['sku','productId','category','collection','size','color'].every(k => !body[k] || line[k] === body[k]));
      if ((!body.types || (Array.isArray(body.types) && body.types.includes(clean.type))) && clean.items.length) selected.push(admin ? clean : operational(clean));
    }
    if (page.size < (report ? 250 : 50)) cursor = null;
  } while (report && cursor);
  if (!report) return {rows:selected,cursor:cursor?.id ?? null};
  const result = summarize(selected);
  if (!admin) {
    delete result.revenue;
    delete result.margin;
    for (const item of result.ranking) delete item.amount;
  }
  return {...result, rows:body.export === true ? selected : undefined};
}

async function userAction(db, auth, body, uid) {
  const email = field(body.email,254,true);
  const role = body.role;
  ensure(['admin','colaborador'].includes(role), 'Perfil inválido.');
  let account;
  try { account = await auth.getUserByEmail(email); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    account = await auth.createUser({email});
  }
  const active = body.active !== false;
  ensure(account.uid !== uid || (active && role === 'admin'), 'Você precisa manter seu próprio acesso administrativo.');
  const ref = db.collection('users').doc(account.uid);
  await db.runTransaction(async transaction => {
    await verifyWriter(transaction,db,uid,true);
    transaction.set(ref,{email:account.email,role,active});
    transaction.create(db.collection('audit').doc(), {type:'usuario',target:account.uid,uid,reason:role + (active ? ' ativo' : ' inativo'),at:FieldValue.serverTimestamp()});
  });
  return {id:account.uid};
}

export default async function handler(req, res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  try {
    ensure(req.method === 'POST','Método não permitido.',405);
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    ensure(token,'Entre para continuar.',401);
    const app = firebase();
    const db = getFirestore(app);
    const auth = getAuth(app);
    const identity = await auth.verifyIdToken(token,true).catch(error => {
      const code = error.code ?? 'unknown';
      console.error('Firebase Admin: falha ao verificar sessão', code);
      const invalidSession = ['auth/argument-error','auth/invalid-id-token','auth/id-token-expired','auth/id-token-revoked','auth/user-disabled','auth/user-not-found'].includes(code);
      ensure(!invalidSession,'Sessão inválida ou expirada.',401);
      throw error;
    });
    const uid = identity.uid;
    const profile = (await db.collection('users').doc(uid).get()).data();
    ensure(profile?.active && ['admin','colaborador'].includes(profile.role),'Conta sem acesso ao MD sport fit.',403);
    const admin = profile.role === 'admin';
    let body = req.body;
    if (body == null) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        ensure(raw.length <= 65536,'Solicitação grande demais.',413);
      }
      body = raw;
    }
    if (typeof body === 'string') {
      ensure(body.length <= 65536,'Solicitação grande demais.',413);
      try { body = JSON.parse(body); } catch { ensure(false,'Solicitação inválida.'); }
    }
    ensure(body && typeof body === 'object','Solicitação inválida.');
    const {action} = body;
    if (['saveProduct','users','saveUser','audit'].includes(action)) ensure(admin,'Acesso administrativo necessário.',403);
    let result;
    switch (action) {
      case 'customers': result=rows(await db.collection('customers').orderBy('name').get()); break;
      case 'saveCustomer': result=await saveCustomer(db,body,uid); break;
      case 'customerHistory': result=await customerHistory(db,body,admin); break;
      case 'profile': result = {uid,email:identity.email,role:profile.role}; break;
      case 'catalog': result = await catalog(db,admin); break;
      case 'saveProduct': result = await saveProduct(db,body,uid); break;
      case 'record': result = await record(db,body,uid,admin); break;
      case 'sale': {
        ensure(admin,'Acesso administrativo necessário.',403);
        const sale = await db.collection('operations').doc(key(body.id)).get();
        ensure(sale.data()?.type === 'venda','Venda não encontrada.',404);
        const {signature,...data} = sale.data();
        result = {id:sale.id,...data};
        break;
      }
      case 'history': result = await records(db,body,admin,false); break;
      case 'report': result = await records(db,body,admin,true); break;
      case 'prices': result = rows(await db.collection('products').doc(key(body.id)).collection('prices').orderBy('at','desc').limit(100).get()); break;
      case 'users': result = rows(await db.collection('users').orderBy('email').limit(200).get()); break;
      case 'saveUser': result = await userAction(db,auth,body,uid); break;
      case 'audit': result = rows(await db.collection('audit').orderBy('at','desc').limit(100).get()); break;
      default: ensure(false,'Ação desconhecida.',404);
    }
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.status || 500;
    if (!error.status) console.error(error.code ?? error.name);
    res.end(JSON.stringify({error:error.status ? error.message : 'Não foi possível concluir a operação. Confira a configuração e tente novamente.'}));
  }
}

