# DevGear

A small online shop for computer accessories - keyboards, mice, headsets and
monitors. Express REST API, plain HTML/CSS/JavaScript front end, SQLite on a
laptop and PostgreSQL when deployed.

It is a demo store. No payment is taken and no order is fulfilled.

## What it does

- Browse 48 products across 4 categories, with search, sorting and category filters
- Sign up and log in
- Add to cart, change quantities, remove items
- Place an order and see your own order history
- A shop owner account that can adjust stock and see every order

## Running it

```bash
npm install
npm run seed     # loads the 48 products and creates the owner account
npm run dev      # http://localhost:3000
```

`npm run seed` prints the owner's password once. It is generated randomly
unless you set `OWNER_PASSWORD` in a `.env` file, so no password is ever
committed to this repository.

Running the seed again resets every product's stock to its starting number.
Customers, carts and orders are left alone.

```bash
npm test         # 31 tests
npm run images   # redraw the 48 product illustrations
```

## Getting in

The shop is behind the login. Opening any page while logged out sends you to
the login screen, and you land back on the page you wanted once you are in.

The seed creates two accounts:

- **owner** - password printed once when you seed. Can change stock and see
  every order.
- **demo** / `demo1234` - an ordinary customer, and the login page has a
  button that signs you in as it with one click. It exists so somebody can
  look around without making an account.

The demo account is deliberately a plain customer. Its password is public, so
it must not be able to touch stock or read anyone else's orders - there are
tests for both. Deploy with `DEMO_LOGIN=off` and the button disappears.

## Two databases, one set of queries

With no `DATABASE_URL` the app uses SQLite, which ships inside Node 24 - so
`npm install && npm run dev` works with nothing installed and the tests run in
seconds. Set `DATABASE_URL` and it uses PostgreSQL instead, which is what the
deployed site needs: free hosting wipes its disk on every restart, and a
SQLite file would take every account and order with it.

Only `src/db.js` knows which one is in use. Queries are written once with `?`
placeholders and the PostgreSQL adapter rewrites them to `$1, $2`; the routes
never find out. Both helpers are async, because a network database cannot be
anything else.

To run the tests against real PostgreSQL:

```bash
DATABASE_URL="postgresql://..." npm test
```

That run means more than the SQLite one - see the honest limit below.

## The part worth reading

Most shopping-cart projects sell the last item in stock more than once. It is
easy to miss, because it only happens when two people check out at the same
moment.

The obvious way to write checkout is:

```js
const product = getProduct(id);          // stock is 1
if (product.stock >= quantity) {         // fine, says both requests
  setStock(id, product.stock - quantity);
}
```

Between the read and the write, a second request can do its own read. Both see
one in stock, both decide it is fine, and the shop sells a mouse it does not
have.

This project does the check and the subtraction in one statement instead, so
the database tests the condition at the moment it writes:

```sql
UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?
```

If it changed a row, the stock was there and is now ours. If it changed
nothing, somebody else got there first - and we find that out by looking at
how many rows changed, not by asking a second time.

The whole checkout runs inside one transaction, so an order that fails halfway
puts back any stock it had already taken. A test covers that case too.

`tests/checkout.test.js` fires two checkouts for the same last item and asserts
that exactly one succeeds, that stock lands on zero rather than minus one, and
that only one order exists afterwards.

**An honest limit on the SQLite run:** those two requests are handled by one
Node process holding one SQLite connection, so Node runs them one after the
other. That run proves the logic is right; it does not reproduce true parallel
execution.

Run the same tests with `DATABASE_URL` pointed at PostgreSQL and they do
overlap for real, because the two checkouts are on separate connections. That
is the run worth quoting.

## Two rules about copying data

The cart stores **no price**. It points at the product, and the price is read
live, so a price change shows up straight away. Nothing has been bought yet, so
there is nothing to freeze.

An order stores **the price and the product name**. An order is a historical
record: if the shop raises the price next month, the receipt must still say
what was actually paid, and it has to survive the product being renamed or
removed.

A cart points at a product. An order remembers a product.

## Money

Every amount is a whole number of paise. Rs 7,499 is stored as `749900`.
Computers cannot represent 0.1 exactly, so money held as a decimal quietly
drifts. Whole paise cannot drift. `rupees()` in `public/js/common.js` is the
only place it turns back into something with a decimal point, and it groups
digits the Indian way - 12,34,567 rather than 1,234,567.

## Passwords

Passwords are never stored. A bcrypt hash is, and a hash cannot be turned back
into the password. Logging in hashes what you typed and compares the hashes.
If this database ever leaked, nobody would get anyone's password out of it.

Storing them safely is only half of it, though. The shop is public and the
owner's username is not a secret, so the login also counts failures: eight
wrong guesses from one address and that address waits fifteen minutes. A
success clears the count, so mistyping your own password twice does nothing.

The counters live in memory, which is the honest size of the problem for one
small server - they reset on restart, and several machines would each count
separately. A shop with real customers would keep them in Redis.

## Paying

Two providers, chosen by configuration, and the shop's own code cannot tell
them apart:

| Setting | Provider | What it is |
|---|---|---|
| Both `RAZORPAY_*` keys set | `razorpay` | The real gateway, in test mode |
| `PAYMENT_SANDBOX=on`, no keys | `sandbox` | A simulator that lives in this repository |
| Neither | off | No Pay button; orders stay `pending` |

**The sandbox is a simulator and the site says so, in those words.** Razorpay
will not issue even test-mode keys without identity documents, which is a lot
to hand a payments company so a student project can show a green tick. The
simulator stands in for them, and it is labelled on the button, inside its own
window, and on the receipt - the `payment_provider` column records which one
was used, so a paid order can never quietly imply money moved.

What is genuinely demonstrated, and what is not:

- **Real** - the verification. The shop recomputes an HMAC signature and
  refuses anything that does not match, using the same code either way. The
  tests forge signatures, tamper with one character, and replay real
  signatures from other orders. All are refused.
- **Fake** - the counterparty. With Razorpay a valid signature proves the
  message came from Razorpay, because only they know their secret. In the
  sandbox one process plays both sides, so it proves only that the message
  came from us. That is the one thing a simulator cannot fake, and it is why
  the sandbox must never be used to take money.

Real keys always win: with `RAZORPAY_*` configured the simulator's endpoint
returns 404, so a live shop cannot have a working simulator sitting next to
it. There is a test for that.

**This server never sees a card number.** Card details are typed into
Razorpay's own window, served from Razorpay's domain, and go straight to them.
That is the whole reason gateways exist: handling raw card data would drag a
student project into PCI-DSS compliance.

The order of events:

```
1. browser  -> us          "I want to pay for order 12"
2. us       -> Razorpay    "create a payment order for 79800 paise"
3. us       -> browser     razorpay_order_id + our public key
4. browser  -> Razorpay    card details, directly, never through us
5. Razorpay -> browser     payment id + a signature
6. browser  -> us          those three values
7. us                      recompute the signature and compare
```

**Step 7 is the only thing standing between the shop and free hardware.**
Anything the browser sends can be typed by hand, so "payment succeeded" is a
claim, not a fact. Razorpay signs `<order_id>|<payment_id>` with the key
secret, which only they and this server know; recomputing that HMAC and
getting the same answer is what makes the claim believable.

Three more things the verify step checks, each of which is a way to get free
hardware if it is missing:

- The Razorpay order id must be **the one we created for this order**.
  Otherwise a genuine signature from a ₹399 mouse could be replayed onto a
  ₹27,999 monitor.
- The order must **belong to the person asking**, so changing the number in
  the request does not pay for - or reveal - somebody else's order.
- The amount always comes from **our own database row**, never from the
  request. A browser allowed to name its own price will.

The signature comparison uses `crypto.timingSafeEqual` rather than `===`, so
it takes the same time whether the first character is wrong or only the last
one is.

Six tests cover this, and none of them call Razorpay: the test signs like
Razorpay would, using a fake secret. That includes a forged signature being
refused, a genuine signature being refused when replayed onto a different
order, and a double submit being treated as a double click rather than an
error.

## Layout

```
server.js              starts the server
src/
  app.js               builds the Express app (kept separate so tests can start their own)
  db.js                the database connection and the query helpers
  schema.sql           the tables
  schema.pg.sql        the same tables for PostgreSQL
  seed.js              loads data/products.json, creates the owner and demo accounts
  auth.js              hashing, login cookie, requireAuth / requireOwner
  payments.js          picks a provider, creates payment orders, verifies signatures
  sandbox-gateway.js   the pretend gateway, kept away from the shop's own code
  rate-limit.js        slows down password guessing
  routes/              auth, products, cart, orders, admin, payments
public/                the pages the browser loads
scripts/make-images.js draws the 48 product illustrations
data/products.json     the catalogue
tests/                 checkout, stock, pricing, access control
Dockerfile             for Cloud Run, Container Apps, anything container-shaped
render.yaml            so Render can create the service without a form
DEPLOY.md              step by step, start to finish
```

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/signup` | anyone |
| POST | `/api/auth/login` | anyone |
| POST | `/api/auth/logout` | anyone |
| GET | `/api/auth/me` | anyone |
| GET | `/api/auth/demo` | anyone |
| POST | `/api/auth/demo-login` | anyone |
| GET | `/api/products` | logged in |
| GET | `/api/products/:id` | logged in |
| GET | `/api/cart` | logged in |
| POST | `/api/cart` | logged in |
| PATCH | `/api/cart/:productId` | logged in |
| DELETE | `/api/cart/:productId` | logged in |
| POST | `/api/orders` | logged in |
| GET | `/api/orders` | logged in |
| GET | `/api/orders/:id` | logged in, own orders only |
| GET | `/api/admin/stats` | owner |
| GET | `/api/admin/products` | owner |
| PATCH | `/api/admin/products/:id/stock` | owner |
| GET | `/api/admin/orders` | owner |
| GET | `/api/payments/config` | anyone |
| POST | `/api/payments/orders/:id` | logged in, own orders only |
| POST | `/api/payments/verify` | logged in, own orders only |
| POST | `/api/payments/sandbox/authorize` | logged in; 404 unless in sandbox mode |

## Product images

The 48 illustrations in `public/images/products/` are generated by
`scripts/make-images.js`, not photographed. Brand product photography belongs
to the brands, and a demo shop has no claim on it - so each product gets a
drawing of the right kind of thing in that brand's colour. A full-size
keyboard has a number pad and a 60% one does not, gaming mice have side
buttons, wired things have cables, gaming headsets have a boom mic and plain
headphones do not, and monitors scale with their inch size.

All 48 come to 292 KB, less than a single photograph.

## Not done yet

- **Webhooks.** Payment is confirmed by the browser reporting back. If someone
  closes the tab at exactly the wrong moment, the money is taken but the order
  stays `pending`. A real shop also listens to Razorpay's webhook, which
  arrives server to server and does not care about the browser. The signature
  checking is the same; it is the delivery that differs.
- **Refunds and cancellation.** `cancelled` is an allowed status but nothing
  sets it.
