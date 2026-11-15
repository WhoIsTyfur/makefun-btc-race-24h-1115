# cbBTC 24h race bot

[![make.fun bounty](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828) [![rank](https://make.fun/badge/btc-race-24h-20261115-0828/WhoIsTyfur/makefun-btc-race-24h-1115/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828) [![reward](https://make.fun/badge/btc-race-24h-20261115-0828/WhoIsTyfur/makefun-btc-race-24h-1115/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)

Entry for the make.fun bounty [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261115-0828).

## What it does
`main.ts` (Node 22, standard library only) speaks `agent-fun/bars-replay/v1`: it reads the `hello`,
then one `batch` per 1-minute cbBTC/USDC bar, and answers each with one reply of orders.
It stays in cash and waits for a market event, enters with a large sleeve, and every position has a
take profit, a stop, a trailing stop and a time exit. No new position is opened late in the window.
If the day is quiet it makes one token 2 USDC round trip so the race's "at least 1 trade" guardrail holds.
The bot is deterministic: no clock, no randomness, no files.

## How it is scored
Net PnL (USDC, after 4 bps fees, 2 bps slippage and constant-product price impact) on the 24 hours of
1-minute bars that start 15 minutes after the deadline. Only entries profitable on the published dev
window race; max drawdown must stay at or under 25%.

## Run locally
With the make.fun kit unpacked in `kit/`:

    cd kit
    node cli/makefun.mjs grade-local --kit . --bot .. --driver process
