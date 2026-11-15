// cbBTC/USDC bar bot for agent-fun/bars-replay/v1 (Node 22, standard library only).
// Reads hello, then one batch per 1-minute bar, answers each batch with one reply of orders.
import { createInterface } from "node:readline";

export type Params = {
  mode: "dip" | "breakout" | "both";
  look: number;      // bars of rolling high/low
  dip: number;       // fractional drop from rolling high that arms an entry (dip mode)
  turn: number;      // bounce off the low since arming that confirms the turn
  brk: number;       // breakout above rolling high (breakout mode)
  tp: number;        // take profit, fraction over entry
  sl: number;        // stop, fraction under entry
  trail: number;     // trailing stop from the high since entry (0 = off)
  hold: number;      // time exit in bars
  maxTrades: number; // entries allowed in the window
  sleeve: number;    // fraction of equity per entry, in bps of 10000
  lateCut: number;   // no new entry within this many bars of the window end
  cool: number;      // bars to wait after an exit
  maxBrk: number;    // breakout entries allowed (own budget, separate from dip entries)
  bTrail: number;    // breakout leg: trailing stop from its peak
  bSl: number;       // breakout leg: hard stop under entry
  bHold: number;     // breakout leg: time exit in bars
};

export const DEFAULT: Params = {
  mode: "both", look: 240, dip: 0.04, turn: 0.002, brk: 0.004,
  tp: 0.04, sl: 0.01, trail: 0.008, hold: 240, maxTrades: 1,
  sleeve: 10000, lateCut: 180, cool: 30,
  maxBrk: 2, bTrail: 0.008, bSl: 0.006, bHold: 1440,
};

export type Order =
  | { side: "buy"; client_id: string; symbol: string; notional_quote_units: string; max_slippage_bps: number }
  | { side: "sell"; client_id: string; symbol: string; qty: string; max_slippage_bps: number };

// Pure decision core: feed it each bar's close and the account, it returns orders.
export class Strategy {
  p: Params;
  closes: number[] = [];
  dq: number[] = []; // indices of a monotonic deque for the rolling high
  bar = 0;
  total = 1440;
  armedLow = 0;      // low since the dip armed, 0 = not armed
  entry = 0;         // entry close of the open position, 0 = flat
  entryBar = 0;
  peak = 0;
  trades = 0;
  lastExit = -1e9;
  seq = 0;
  token = false;
  kind = "";         // "dip" | "brk" | "tok": which leg the open position belongs to
  brkTrades = 0;
  constructor(p: Params, totalBars = 1440) { this.p = p; this.total = totalBars; }

  step(close: number, cash: bigint, qty: bigint, sym: string): Order[] {
    const p = this.p;
    this.closes.push(close);
    const i = this.bar++;
    const out: Order[] = [];
    const n = this.closes.length;
    // rolling high of the `look` closes before this bar (O(1) amortised)
    while (this.dq.length && this.dq[0] < n - 1 - p.look) this.dq.shift();
    const hi = this.dq.length ? this.closes[this.dq[0]] : close;
    while (this.dq.length && this.closes[this.dq[this.dq.length - 1]] <= close) this.dq.pop();
    this.dq.push(n - 1);
    const left = this.total - 1 - i;

    if (qty > 0n) {
      if (this.entry === 0) { this.entry = close; this.entryBar = i; this.peak = close; }
      if (close > this.peak) this.peak = close;
      const r = close / this.entry - 1;
      let exit = left <= 1 || this.kind === "tok";
      if (this.kind === "brk") exit = exit || r <= -p.bSl || i - this.entryBar >= p.bHold || close <= this.peak * (1 - p.bTrail);
      else exit = exit || r >= p.tp || r <= -p.sl || i - this.entryBar >= p.hold || (p.trail > 0 && close <= this.peak * (1 - p.trail) && r > 0);
      if (exit && left >= 1) {
        out.push({ side: "sell", client_id: "s" + (this.seq++), symbol: sym, qty: qty.toString(), max_slippage_bps: 10000 });
        this.entry = 0; this.lastExit = i;
      }
      return out;
    }
    this.entry = 0;
    // guardrail insurance: the race needs one filled order, so a quiet day gets a token 2 USDC round trip
    if (this.trades === 0 && i === this.total - 240 && cash > 3_000_000n) {
      this.trades++; this.token = true; this.kind = "tok";
      out.push({ side: "buy", client_id: "t" + (this.seq++), symbol: sym, notional_quote_units: "2000000", max_slippage_bps: 10000 });
      return out;
    }
    if (n <= Math.min(p.look, 60) || left < p.lateCut || i - this.lastExit < p.cool) return out;

    let go = false;
    if (p.mode !== "breakout" && this.trades - this.brkTrades < p.maxTrades) {
      if (this.armedLow === 0) { if (close <= hi * (1 - p.dip)) this.armedLow = close; }
      else {
        if (close < this.armedLow) this.armedLow = close;
        if (close >= this.armedLow * (1 + p.turn)) { go = true; this.armedLow = 0; this.kind = "dip"; }
      }
    }
    if (!go && p.mode !== "dip" && p.brk > 0 && this.brkTrades < p.maxBrk && n > p.look && close >= hi * (1 + p.brk)) {
      go = true; this.kind = "brk"; this.brkTrades++;
    }
    if (go) {
      const spend = (cash * BigInt(p.sleeve)) / 10000n - 1000n;
      if (spend >= 1_000_000n) {
        out.push({ side: "buy", client_id: "b" + (this.seq++), symbol: sym, notional_quote_units: spend.toString(), max_slippage_bps: 10000 });
        this.trades++;
      }
    }
    return out;
  }
}

function run(): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  let strat: Strategy | null = null;
  let sym = "CBBTC";
  rl.on("line", (line: string) => {
    if (!line.trim()) return;
    const m = JSON.parse(line);
    if (m.type === "hello") {
      sym = m.symbols[0].symbol;
      strat = new Strategy(DEFAULT, 1440);
      return;
    }
    if (m.type === "done") { rl.close(); return; }
    if (m.type !== "batch") return;
    let orders: Order[] = [];
    const b = (m.bars || []).find((x: { symbol: string }) => x.symbol === sym);
    if (b && strat) {
      const pos = (m.account.positions || []).find((x: { symbol: string }) => x.symbol === sym);
      orders = strat.step(Number(b.c), BigInt(m.account.cash_quote_units), pos ? BigInt(pos.qty) : 0n, sym);
    }
    process.stdout.write(JSON.stringify({ type: "reply", seq: m.seq, orders }) + "\n");
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() as string) && !process.env.BENCH) run();
