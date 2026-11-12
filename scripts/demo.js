import {createServer} from 'node:http';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import handler from '../api/gestao.js';
import {today} from '../server/domain.js';

const projectId = 'gestaomona-60d33';
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== projectId)) {
  throw new Error('O gerador de demonstração exige os dois emuladores locais.');
}
const app = initializeApp({projectId});
const auth = getAuth(app);
const db = getFirestore(app);
const password = 'MonaDemo!2026';
const email = 'admin.demo@example.com';
const accounts = [[email,'admin'],['colaborador.demo@example.com','colaborador']];
for (const [address,role] of accounts) {
  const account = await auth.getUserByEmail(address).catch(error=>{
    if (error.code !== 'auth/user-not-found') throw error;
    return auth.createUser({email:address,password});
  });
  await db.collection('users').doc(account.uid).set({email:address,role,active:true});
}
const authResponse = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
});
if (!authResponse.ok) throw new Error('Não foi possível iniciar a sessão de demonstração.');
const {idToken} = await authResponse.json();
const server = createServer(handler);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const call = async (action,data) => {
    const response = await fetch('http://127.0.0.1:'+server.address().port,{
      method:'POST',headers:{Authorization:'Bearer '+idToken,'Content-Type':'application/json'},body:JSON.stringify({action,...data})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const catalog = await call('catalog');
  const products = [
    ['Camiseta Básica','DEMO-CB','Camisetas','Rosa',4990,2400,[7,9,15,12,18,22,15,10,13,18,24,28]],
    ['Vestido Aurora','DEMO-VA','Vestidos','Lilás',8990,5200,[8,4,7,12,9,11,8,10,12,15,22,32]],
    ['Short Linho','DEMO-SL','Shorts','Areia',6490,3400,[22,16,10,7,5,4,6,8,10,15,19,24]]
  ];
  const year = Number(today().slice(0,4));
  for (const [name,reference,category,color,price,cost,sales] of products) {
    const sku = reference+'-M';
    const small = reference+'-P';
    if (!catalog.variants.some(v=>v.sku===sku)) {
      await call('saveProduct',{name,reference,category,collection:'Essenciais',variants:[
        {sku,size:'M',color,price,cost,minimum:8},
        {sku:small,size:'P',color,price,cost,minimum:10}
      ]});
    }
    for (const [period,multiplier] of [[year-1,1],[year,1.15]]) {
      await call('record',{id:sku+'-'+period+'-lote',type:'producao',date:period+'-01-01',reference:'LOTE-'+period,items:[{sku,qty:240},{sku:small,qty:30}]});
      for (const [index,count] of sales.entries()) {
        const date = period+'-'+String(index+1).padStart(2,'0')+'-01';
        if (date > today()) continue;
        await call('record',{id:sku+'-'+date,type:'venda',date,channel:'Atacado',items:[{sku,qty:Math.round(count*multiplier)},{sku:small,qty:2}]});
      }
    }
  }
  console.log('Dados de demonstração prontos. Contas: '+accounts.map(([address])=>address).join(', ')+' | senha: '+password);
} finally {
  server.close();
}

