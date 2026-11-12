import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialDate,operationItems,summarize} from '../server/domain.js';

const p = {stock:20,price:4990,cost:2200,active:true,productId:'camiseta',name:'Camiseta',size:'M',color:'Rosa',category:'Básicos',collection:''};
const line = {sku:'ROSA-M',qty:3};

test('produção e venda por variação dão o saldo correto',()=>{
  const batch = operationItems('producao',[{sku:'ROSA-P',qty:10},{sku:'ROSA-M',qty:20}],[{...p,stock:0},{...p,stock:0}],null,false,false);
  assert.deepEqual(batch.map(i=>i.stock),[10,20]);
  const sale=operationItems('venda',[line],[p],null,false,false)[0];
  assert.equal(sale.stock,17);
  assert.equal(sale.total,14970);
});
test('estoque insuficiente e quantidade fracionária são rejeitados',()=>{
  assert.throws(()=>operationItems('venda',[line],[{...p,stock:2}],null,false,false),/insuficiente/);
  assert.throws(()=>operationItems('venda',[{...line,qty:1.5}],[p],null,false,false),/inteiro/);
});
test('preço do catálogo permanece na venda de colaborador',()=>{
  const [item]=operationItems('venda',[{...line,price:100,discount:100}],[p],null,false,false);
  assert.equal(item.price,4990);
  assert.equal(item.discount,0);
});
test('devolução preserva preço histórico, limita a quantidade e pode não repor estoque',()=>{
  const items=operationItems('venda',[line],[p],null,false,false);
  const current={...p,price:5490,stock:17,active:false};
  const original={items,returned:{'ROSA-M':2}};
  const returns=operationItems('devolucao',[{...line,qty:1}],[current],original,true,true);
  assert.equal(returns[0].stock,18);
  assert.equal(returns[0].price,4990);
  assert.equal(operationItems('devolucao',[{...line,qty:1}],[current],original,true,false)[0].stock,17);
  assert.throws(()=>operationItems('devolucao',[{...line,qty:2}],[current],original,true,true),/acima/);
});
test('datas comerciais válidas e agregação no mês da devolução',()=>{
  assert.equal(commercialDate('2024-02-29'),'2024-02-29');
  assert.throws(()=>commercialDate('2025-02-29'),/válida/);
  const item={sku:'M',productId:'p',name:'Camiseta',size:'M',color:'Rosa',qty:3,total:14970,margin:3000};
  const result=summarize([{type:'venda',date:'2024-01-31',items:[item]},{type:'devolucao',date:'2024-02-01',items:[{...item,qty:1,total:4990,margin:1000}]}]);
  assert.deepEqual(result.months.slice(0,2),[3,-1]);
  assert.equal(result.ranking[0].qty,2);
  assert.equal(result.revenue,9980);
});

