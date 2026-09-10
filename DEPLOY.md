# Deploying DevGear

Everything on this page needs accounts in your name, so these are steps for
you to run. The application side is already done: it detects PostgreSQL,
creates its own tables, and fills an empty database with the catalogue on
first boot.

Budget about 30 minutes the first time.

---

## Step 1 - a PostgreSQL database

The app uses SQLite on your laptop and PostgreSQL when deployed. This is not
optional on free hosting: free web services wipe their disk on every restart,
so a SQLite file would take every account and order with it.

Use a provider whose free tier **does not expire**. A link on your resume has
to still work in 2027, and a database that quietly shuts off after 30 days or
when student credit runs out is worse than never deploying - it fails exactly
when somebody is looking.

[Neon](https://neon.com) fits: free tier, no card, no expiry. Sign up, create
a project, and copy the connection string. It looks like:

```
postgresql://user:password@ep-something.aws.neon.tech/dbname?sslmode=require
```

Keep it somewhere safe for a moment. **Never commit it** - it is a password.

## Step 2 - check it works before deploying

Worth doing, and it takes a minute:

```bash
DATABASE_URL="your-connection-string" npm test
```

The same 37 tests now run against real PostgreSQL. This is the more meaningful
run: on SQLite in one process Node handles the two racing checkouts one after
another, but PostgreSQL executes them genuinely in parallel. If the atomic
`UPDATE` were wrong, this is where it would show.

Then try the app itself:

```bash
DATABASE_URL="your-connection-string" npm run dev
```

First boot creates the tables, loads the 48 products, and prints the owner
password once. Save it.

### One gotcha if you use the same database for both

The app fills an empty database on first boot. If you have already pointed
your laptop at the same Neon branch, the catalogue is no longer empty, so the
deployed copy will not seed - and there will be no owner account.

Two ways round it, either is fine:

- Create the owner from your laptop before deploying: put `OWNER_PASSWORD` in
  `.env` and run `npm run seed`. It only creates what is missing.
- Or give the deployment its own database. Neon branches are free and instant,
  and your plan includes ten of them: branch `production` for the deployed
  site, another for your laptop. That is the tidier habit - it means you can
  never break the live shop by experimenting locally.

Note that `npm test` always uses SQLite unless you pass `DATABASE_URL`
explicitly, so the tests never touch either of them.

## Step 3 - put the app somewhere

### Option A: Render (simplest, no card)

1. Sign in to [render.com](https://render.com) with GitHub.
2. **New > Blueprint**, pick `Charan1845/ecommerce-website`. It reads
   `render.yaml` and fills the form in.
3. Set the environment variables it asks for:
   - `DATABASE_URL` - the Neon string from step 1
   - `OWNER_PASSWORD` - choose one, or leave it blank for a random one
     printed in the logs
   - `JWT_SECRET` is generated for you
4. Deploy, then watch the logs until `DevGear listening on port ...`.

**The catch, stated honestly:** free services sleep after about 15 minutes with
no visitors, and waking takes roughly 30-60 seconds. Somebody clicking your
link cold may stare at a blank tab long enough to give up.

### Option B: Google Cloud Run (faster to wake, needs a card on file)

Free allowance covers a portfolio app comfortably, but Google requires a card
to open the account even so. Cold starts are a second or two rather than a
minute, which is the real reason to prefer it.

Note that **Cloud SQL has no free tier** - keep using Neon for the database and
Cloud Run only for the app.

```bash
gcloud run deploy devgear \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "DATABASE_URL=your-connection-string,JWT_SECRET=a-long-random-string,OWNER_PASSWORD=your-choice"
```

`asia-south1` is Mumbai - closest to you and to anyone in India opening the
link. It builds from the `Dockerfile` in this repository.

For anything beyond a demo, put the secrets in Secret Manager rather than
`--set-env-vars`, which leaves them visible in your deployment history.

### Option C: Azure

App Service runs this fine, and **Azure for Students** verifies with your
college email rather than a card. Be deliberate about one thing: that credit
expires, typically after a year, and the site stops when it does. You graduate
in 2027, so plan for the expiry date or use it only for experimenting.

---

## Environment variables

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Yes, in production | PostgreSQL connection string. Without it the app uses SQLite. |
| `JWT_SECRET` | Yes, in production | Signs the login cookie. Long and random. The app refuses to start in production without it. |
| `PORT` | Usually set for you | Which port to listen on. |
| `OWNER_PASSWORD` | Optional | Sets the owner password on first boot instead of generating one. |
| `DEMO_LOGIN` | Optional | `off` removes the demo button entirely. |
| `SEED_ON_BOOT` | Optional | `off` stops the first-boot catalogue load. |
| `PG_SSL_NO_VERIFY` | Rarely | `1` if your provider uses a self-signed certificate. Neon and Supabase do not. |
| `PAYMENT_SANDBOX` | Optional | `on` enables the built-in simulator. Ignored when Razorpay keys are set. |
| `RAZORPAY_KEY_ID` | Optional | Test key from Razorpay. Without it, no Pay button. |
| `RAZORPAY_KEY_SECRET` | Optional | The matching secret. Never goes to the browser. |

## Switching payments on, without a gateway account

Razorpay asks for identity documents - PAN and business details - before it
will issue keys, including test keys. That is a lot to hand over so a demo
shop can show a green tick, and it is not needed.

Set `PAYMENT_SANDBOX=on` instead and the built-in simulator takes over. The
checkout can be clicked through end to end, and every screen says plainly that
it is simulated. Nothing about it is hidden: the button, the payment window
and the receipt all say so, and the database records which provider was used.

The signature verification is the same code the real gateway path uses, so the
part worth showing an interviewer is genuinely exercised.

## Switching on the real Razorpay

Payments are off until both Razorpay keys are set, and the shop works fine
without them - orders simply stay `pending`.

To turn them on:

1. Sign up at [razorpay.com](https://razorpay.com). No company details are
   needed to use test mode.
2. Make sure the dashboard is in **Test Mode** - there is a toggle, and it
   matters. A live key moves real money.
3. **Settings -> API Keys -> Generate Test Key.** The id starts `rzp_test_`.
   If it starts `rzp_live_`, you are in the wrong mode.
4. Put both values in `.env` locally, and in Render's environment settings for
   the deployed site.

The app checks the prefix and tells the visitor when it is in test mode, so
nobody thinks they are being charged.

**Test cards** come from Razorpay's own documentation - card
`4111 1111 1111 1111`, any future expiry, any CVV. No money moves at any
point, and no real card should ever be typed into a test-mode shop.

## After it is live

1. Open `https://your-url/api/health` - it should say `{"ok":true}`.
2. Open the site. You should land on the login page.
3. Press **Look around with the demo account**. You should be in the shop.
4. Log in as `owner` and check the dashboard.
5. Put the URL in the repository's About box on GitHub so it is visible from
   the repository page.

## If something breaks

**"Failed to start" in the logs** - almost always `DATABASE_URL`. Check for a
missing character when it was pasted.

**Pages load but everything is empty** - the seed did not run. Check the logs
for `empty database - setting it up`, and that `SEED_ON_BOOT` is not `off`.

**Login works, then you are logged out again** - `JWT_SECRET` is changing
between restarts. Set it explicitly rather than letting something generate a
new one each deploy.

**A certificate error connecting to the database** - try `PG_SSL_NO_VERIFY=1`,
but check first that the host really is your provider's.
