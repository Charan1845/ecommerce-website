# Roadmap

This project has one claim: **the last item in stock is sold exactly once, and
there is a test that proves it.**

Everything worth building next either strengthens that claim or stops it being
undermined elsewhere. A shop that sells the last mouse once but silently loses
a payment, or quietly drifts its stock count over six months, has not really
kept the promise.

So the order below is not "features I would like". It is the shortest path
from *correct once, in a test* to **correct continuously, on real data, and
able to prove it**.

---

## Phase 1 — Prove it stays right

*Inventory that can be audited, not just trusted.*

Right now stock is a number that gets added to and subtracted from. It is
correct today, but it cannot answer the question anyone asks when something
looks wrong: **why is this 3?** Nothing records how it got there.

| | |
|---|---|
| [#9](https://github.com/Charan1845/ecommerce-website/issues/9) | **Stock as a ledger, not a number.** Every movement is a row - sale, cancellation, restock, correction. Current stock becomes something derived rather than something hoped for. |
| [#10](https://github.com/Charan1845/ecommerce-website/issues/10) | **A job that checks the books balance.** Five invariants over real data, exiting non-zero when one fails. The shop checks itself instead of a README claiming it is fine. |
| [#11](https://github.com/Charan1845/ecommerce-website/issues/11) | **A load test that genuinely tries to break it.** Two hundred buyers, four in stock, four sold. Two is a unit test; two hundred is a demonstration. |
| [#12](https://github.com/Charan1845/ecommerce-website/issues/12) | **Make the race reproducible on demand.** The most interesting thing here is invisible because it happens in microseconds. A guarded switch makes it watchable in two browser tabs. |
| [#2](https://github.com/Charan1845/ecommerce-website/issues/2) | **Cancelling and refunds.** Which is the checkout transaction in reverse, and has the same race to get right. The ledger makes returning stock honest rather than an edit. |
| [#6](https://github.com/Charan1845/ecommerce-website/issues/6) | **Order progress** - packed, shipped, delivered. An order currently stops being interesting the moment it is paid for. |

**Why this phase first.** The rest of the list is ordinary good practice that
any shop needs. This phase is the part that makes *this* shop worth looking
at, and it is the part that gets harder to add later once orders exist that
the ledger cannot explain.

---

## Phase 2 — Money you can trust

*Payment that does not depend on a browser staying open.*

| | |
|---|---|
| [#1](https://github.com/Charan1845/ecommerce-website/issues/1) | **Confirm payments with a webhook.** Today an order is marked paid because the browser reports back. Close the tab at the wrong moment and the money is taken while the order sits at `pending` forever. |
| [#7](https://github.com/Charan1845/ecommerce-website/issues/7) | **Real Razorpay test keys**, if the paperwork ever becomes worth it. The code already picks a provider; only the account is missing. |

---

## Phase 3 — Fast, awake, and close to its data

*Nothing here is clever. All of it is measurable.*

| | |
|---|---|
| [#3](https://github.com/Charan1845/ecommerce-website/issues/3) | **The app and the database are on opposite sides of the Pacific.** Render in Oregon, Neon in Singapore: about 350ms of every page load is travel time, measured. |
| [#5](https://github.com/Charan1845/ecommerce-website/issues/5) | **The free instance sleeps.** A cold visitor waits 30 to 60 seconds, which reads as broken. |
| [#4](https://github.com/Charan1845/ecommerce-website/issues/4) | **Local development shares the live database.** Testing locally writes to the real shop. |
| [#8](https://github.com/Charan1845/ecommerce-website/issues/8) | **Images are three times larger than they are displayed.** |

---

## What is deliberately not on this list

**A framework.** The front end is plain HTML, CSS and JavaScript because the
interesting problems here are on the server. Rewriting it in React would take
a week and change nothing about whether the shop can count.

**More products, more categories, a wishlist, reviews, coupons.** Each is an
afternoon of CRUD that makes the project bigger without making it better. A
demo shop with 48 products that is provably correct beats one with 500 that
is not.

**Real payments.** The simulator is labelled as a simulator everywhere it
appears. Taking real money would mean obligations - refunds, disputes, records
- that a portfolio project has no business taking on.
