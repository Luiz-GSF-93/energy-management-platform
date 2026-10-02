type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Reply = {data: Row[] | Row | null; error: {message: string} | null};
/** A request-local read adapter. The existing engine runs against one database capture.
 * Unknown tables/operations fail closed; this adapter cannot write or reach the network.
 */
export function frozenPreparationClient(tables: Tables) {
 const captured = JSON.parse(JSON.stringify(tables)) as Tables;
 return {from(table: string) {return new FrozenQuery(captured[table]);}};
}
class FrozenQuery implements PromiseLike<Reply> {
 private filters: ((row: Row) => boolean)[] = [];
 private columns = '*';
 private orders: {column: string; ascending: boolean}[] = [];
 private start = 0;
 private end = Number.MAX_SAFE_INTEGER;
 private singleton = false;
 constructor(private readonly rows: Row[] | undefined) {}
 select(columns = '*') {this.columns = columns; return this;}
 eq(column: string, value: unknown) {this.filters.push(row => row[column] === value); return this;}
 is(column: string, value: null | boolean) {return this.eq(column, value);}
 in(column: string, values: unknown[]) {this.filters.push(row => values.includes(row[column])); return this;}
 gte(column: string, value: string) {this.filters.push(row => typeof row[column] === 'string' && (row[column] as string) >= value); return this;}
 lt(column: string, value: string) {this.filters.push(row => typeof row[column] === 'string' && (row[column] as string) < value); return this;}
 order(column: string, options: {ascending?: boolean} = {}) {this.orders.push({column, ascending: options.ascending !== false}); return this;}
 range(start: number, end: number) {this.start = start; this.end = end; return this;}
 limit(count: number) {return this.range(0, count - 1);}
 maybeSingle() {this.singleton = true; return this;}
 private reply(): Reply {
  if (!Array.isArray(this.rows)) return {data: null, error: {message: 'Uncaptured preparation table'}};
  if (this.columns !== '*' && !/^[a-z_]+(?:,[a-z_]+)*$/.test(this.columns)) return {data: null, error: {message: 'Unsupported captured projection'}};
  let result = this.rows.filter(row => this.filters.every(filter => filter(row)));
  for (const order of [...this.orders].reverse()) result.sort((a, b) => {
   const av = a[order.column], bv = b[order.column];
   if (av === bv) return 0;
   if (av == null) return order.ascending ? 1 : -1;
   if (bv == null) return order.ascending ? -1 : 1;
   const comparison = typeof av === 'number' && typeof bv === 'number' ? (av < bv ? -1 : 1) : (String(av) < String(bv) ? -1 : 1);
   return comparison * (order.ascending ? 1 : -1);
  });
  result = JSON.parse(JSON.stringify(result.slice(this.start, this.end + 1).map(row => this.columns === '*' ? row : Object.fromEntries(this.columns.split(',').map(column => [column, row[column]]))))) as Row[];
  if (this.singleton && result.length > 1) return {data: null, error: {message: 'Ambiguous captured row'}};
  return {data: this.singleton ? result[0] ?? null : result, error: null};
 }
 then<TResult1 = Reply, TResult2 = never>(onfulfilled?: ((value: Reply) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
  return Promise.resolve().then(() => this.reply()).then(onfulfilled, onrejected);
 }
}
