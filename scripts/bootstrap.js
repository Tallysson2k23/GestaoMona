import {getAuth} from 'firebase-admin/auth';
import {FieldValue,getFirestore} from 'firebase-admin/firestore';
import {applicationDefault,initializeApp} from 'firebase-admin/app';

const email = process.argv[2];
const projectId = process.env.FIREBASE_PROJECT_ID || 'gestaomona-60d33';
if (!email || !email.includes('@')) throw new Error('Informe o e-mail de uma conta existente no Firebase Authentication.');
const app = initializeApp({projectId,...(process.env.FIRESTORE_EMULATOR_HOST?{}:{credential:applicationDefault()})});
const auth = getAuth(app);
const user = await auth.getUserByEmail(email);
if (user.disabled) throw new Error('A conta está desativada no Firebase Authentication.');
const db = getFirestore(app);
await db.runTransaction(async transaction=>{
  const users = db.collection('users');
  const admins = await transaction.get(users.where('role','==','admin').limit(1));
  if (!admins.empty) throw new Error('Já existe um administrador. Gerencie contas pelo painel.');
  transaction.set(users.doc(user.uid),{email:user.email,active:true,role:'admin'});
  transaction.create(db.collection('audit').doc(),{type:'bootstrap',uid:user.uid,target:user.uid,reason:'Primeiro administrador',at:FieldValue.serverTimestamp()});
});
console.log('Administrador provisionado.');

