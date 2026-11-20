import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import handler from '../api/gestao.js';

const projectId='gestaomona-60d33';
const emulators=process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099' &&
  process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8080' &&
  (!process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID===projectId);

test('API com emuladores: login, perfis, estoque, concorrência e relatórios', {skip:!emulators,timeout:60000},async t=>{
  const app=getApps()[0] ?? initializeApp({projectId});
  const auth=getAuth(app);
  const db=getFirestore(app);
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const url='http://127.0.0.1:'+server.address().port;
  const run=randomUUID().slice(0,8);
  const password=randomUUID();
  const date='2024-01-31';
  const makeAccount=async role=>{
    const email=role+'-'+run+'@example.com';
    const account=await auth.createUser({email,password});
    await db.collection('users').doc(account.uid).set({email,role,active:true});
    const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
    });
    assert.equal(response.status,200);
    return {uid:account.uid,token:(await response.json()).idToken};
  };
  const [admin,staff]=await Promise.all([makeAccount('admin'),makeAccount('colaborador')]);
  const call=async (account,action,payload={},status=200)=>{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(account?{Authorization:'Bearer '+account.token}:{})},body:JSON.stringify({action,...payload})});
    const body=await response.json();
    assert.equal(response.status,status,JSON.stringify(body));
    return body;
  };
  await call(null,'profile',{},401);
  assert.equal((await call(staff,'profile')).role,'colaborador');
  await call(staff,'audit',{},403);
  const sku=run.toUpperCase()+'-M';
  const small=run.toUpperCase()+'-P';
  const product={name:'Camiseta Básica',reference:run,category:'Camisetas',variants:[
    {sku,size:'M',color:'Rosa',minimum:2,price:4990,cost:2200},
    {sku:small,size:'P',color:'Rosa',minimum:2,price:4990,cost:2200}
  ]};
  await call(staff,'saveProduct',product,403);
  const {id:productId}=await call(admin,'saveProduct',product);
  await call(admin,'saveProduct',product,409);
  const operation=(type,items,extra={})=>({type,date,id:randomUUID(),items,...extra});
  const batch=operation('producao',[{sku,qty:20},{sku:small,qty:10}],{reference:'Lote 1'});
  await call(staff,'record',batch);
  await call(staff,'record',batch);
  await call(staff,'record',operation('venda',[{sku,qty:21}]),400);
  const customerId=randomUUID();
  await call(staff,'saveCustomer',{newId:customerId,name:'Cliente Teste',email:'cliente@example.com',phone:'81999999999'});
  assert.equal((await call(staff,'customers')).some(c=>c.id===customerId),true);
  const sale=operation('venda',[{sku,qty:3}],{customerId});
  await call(staff,'record',sale);
  let catalog=await call(staff,'catalog');
  assert.equal(catalog.variants.find(v=>v.sku===sku).stock,17);
  assert.equal(catalog.variants.find(v=>v.sku===small).stock,10);
  assert.equal('cost' in catalog.variants.find(v=>v.sku===sku),false);
  await call(admin,'saveProduct',{...product,id:productId,variants:product.variants.map(v=>({...v,price:5490}))});
  assert.equal((await call(admin,'sale',{id:sale.id})).items[0].price,4990);
  await call(staff,'sale',{id:sale.id},403);
  const refund=operation('devolucao',[{sku,qty:1}],{original:sale.id,date:'2024-02-01',note:'Devolução',restock:true});
  await call(staff,'record',refund,403);
  await call(admin,'record',refund);
  await call(admin,'record',refund);
  await call(admin,'record',{...refund,id:randomUUID(),items:[{sku,qty:3}]},400);
  catalog=await call(admin,'catalog');
  assert.equal(catalog.variants.find(v=>v.sku===sku).stock,18);
  const customerAdmin=await call(admin,'customerHistory',{id:customerId,year:'2024'});
  assert.deepEqual(customerAdmin.monthly.slice(0,2),[14970,-4990]);
  assert.equal(customerAdmin.units,2);
  assert.equal(customerAdmin.purchases,1);
  assert.equal(customerAdmin.rows.length,2);
  const customerStaff=await call(staff,'customerHistory',{id:customerId,year:'2024'});
  assert.deepEqual(customerStaff.monthly.slice(0,2),[3,-1]);
  assert.equal('price' in customerStaff.rows[0].items[0],false);
  await call(admin,'saveCustomer',{id:customerId,name:'Cliente Editado',active:false});
  await call(staff,'record',operation('venda',[{sku,qty:1}],{customerId}),400);
  assert.equal((await call(admin,'customerHistory',{id:customerId,year:'2024'})).rows.length,2);
  const filter={productId,start:'2024-01-01',end:'2024-12-31'};
  const report=await call(staff,'report',filter);
  assert.deepEqual(report.months.slice(0,2),[3,-1]);
  assert.equal(report.produced,30);
  assert.equal('revenue' in report,false);
  assert.equal((await call(admin,'report',filter)).revenue,9980);
  await call(staff,'record',operation('venda',[{sku:small,qty:9}]));
  const lastUnit=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+staff.token},
    body:JSON.stringify({action:'record',...operation('venda',[{sku:small,qty:1}])})});
  const results=await Promise.all([lastUnit(),lastUnit()]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  await db.collection('users').doc(staff.uid).update({active:false});
  await call(staff,'profile',{},403);
  const created=await call(admin,'saveUser',{email:'novo-'+run+'@example.com',role:'colaborador',active:true});
  assert.equal((await db.collection('users').doc(created.id).get()).data().role,'colaborador');
});

