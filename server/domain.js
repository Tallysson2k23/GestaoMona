/** @param {unknown} condition @param {string} message @param {number} [status] @returns {asserts condition} */
export function ensure(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), {status});
}

/** @param {unknown} value @param {number} [limit] @param {boolean} [required] */
export function field(value, limit = 120, required = false) {
  ensure(typeof value === 'string' || value == null, 'Campo inválido.');
  const clean = (value ?? '').trim();
  ensure(clean.length <= limit && (!required || clean.length > 0), 'Confira os campos obrigatórios e seus limites.');
  return clean;
}

/** @param {number} value @param {number} [minimum] */
export function integer(value, minimum = 0) {
  ensure(Number.isSafeInteger(value) && value >= minimum && value <= 100000000, 'Informe um número inteiro válido.');
  return value;
}

export function today() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Fortaleza'}).format(new Date());
}

/** @param {unknown} value */
export function commercialDate(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Data inválida.');
  const parsed = new Date(value);
  ensure(!Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === value && value <= today(), 'Informe uma data comercial válida até hoje.');
  return value;
}

/**
 * @typedef {{sku:string,qty:number,price?:number|null,discount?:number|null}} Line
 * @typedef {{active:boolean,stock:number,price:number,cost?:number|null,productId:string,name:string,size:string,color:string,category:string,collection:string}} Variant
 * @typedef {{sku:string,qty:number,delta:number,stock:number,price:number,discount:number,cost:number|null,total:number,margin:number|null,productId:string,name:string,size:string,color:string,category:string,collection:string}} Item
 * @typedef {{items:Item[],returned?:Record<string,number>}} Original
 * @param {string} type
 * @param {Line[]} lines
 * @param {Variant[]} variants
 * @param {Original|null} original
 * @param {boolean} admin
 * @param {boolean} restock
 * @returns {Item[]}
 */
export function operationItems(type, lines, variants, original, admin, restock) {
  return lines.map((line, i) => {
    const variant = variants[i];
    const qty = integer(line.qty, 1);
    const previous = original?.items.find(item => item.sku === line.sku);
    const returned = original?.returned?.[line.sku] ?? 0;
    if (type === 'devolucao') ensure(previous && returned + qty <= previous.qty, 'Quantidade acima do saldo disponível para devolução.');
    else ensure(variant.active, 'A variação está arquivada.');
    const delta = ['venda','perda','ajusteSaida'].includes(type) ? -qty : type === 'devolucao' && !restock ? 0 : qty;
    ensure(variant.stock + delta >= 0, 'Estoque insuficiente para ' + line.sku + '.');
    const price = type === 'devolucao' ? previous?.price ?? 0 : type === 'venda' ? (admin && line.price != null ? integer(line.price) : variant.price) : 0;
    const discount = type === 'devolucao' ? previous?.discount ?? 0 : type === 'venda' && admin && line.discount != null ? integer(line.discount) : 0;
    ensure(discount <= price, 'Desconto acima do preço unitário.');
    const unit = price - discount;
    const cost = type === 'devolucao' ? previous?.cost ?? null : variant.cost ?? null;
    return {
      sku:line.sku, qty, delta, stock:variant.stock + delta, price, discount, cost,
      total:unit * qty, margin:cost == null ? null : (unit - cost) * qty,
      productId:variant.productId, name:previous?.name ?? variant.name,
      size:previous?.size ?? variant.size, color:previous?.color ?? variant.color,
      category:previous?.category ?? variant.category, collection:previous?.collection ?? variant.collection
    };
  });
}

/**
 * @typedef {Pick<Item,'qty'|'productId'|'name'|'size'|'color'> & Partial<Pick<Item,'total'|'margin'>>} ReportItem
 * @param {{type:string,date:string,items:ReportItem[]}[]} records
 */
export function summarize(records) {
  const months = Array(12).fill(0);
  const ranking = new Map();
  const sizes = new Map();
  let sold = 0, returned = 0, produced = 0, revenue = 0, margin = 0;
  for (const record of records) {
    for (const item of record.items) {
      if (record.type === 'producao') produced += item.qty;
      const direction = record.type === 'venda' ? 1 : record.type === 'devolucao' ? -1 : 0;
      if (!direction) continue;
      if (direction === 1) sold += item.qty;
      else returned += item.qty;
      const net = item.qty * direction;
      const amount = (item.total ?? 0) * direction;
      revenue += amount;
      margin += (item.margin ?? 0) * direction;
      months[Number(record.date.slice(5,7)) - 1] += net;
      const entry = ranking.get(item.productId) ?? {name:item.name, qty:0, amount:0};
      entry.qty += net;
      entry.amount += amount;
      ranking.set(item.productId, entry);
      const key = item.size + ' / ' + item.color;
      sizes.set(key, (sizes.get(key) ?? 0) + net);
    }
  }
  return {
    sold, returned, produced, revenue, margin, months,
    ranking:[...ranking.values()].sort((a,b) => b.qty - a.qty),
    sizes:[...sizes].sort((a,b) => b[1] - a[1])
  };
}
