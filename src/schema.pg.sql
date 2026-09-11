-- DevGear schema for PostgreSQL - what the deployed site uses.
--
-- The SQLite version in schema.sql is the same tables with three differences:
-- SERIAL instead of AUTOINCREMENT, TIMESTAMPTZ with now() instead of TEXT with
-- datetime('now'), and TEXT lengths that PostgreSQL enforces properly.
--
-- Money rule for the whole project: every amount is a whole number of paise.
-- Rs 7,499 is stored as 749900. Computers cannot hold 0.1 exactly, so money
-- kept as a decimal quietly drifts. Whole paise cannot drift.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  -- Never the password itself. A one-way scramble that cannot be reversed.
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  state         VARCHAR(50),
  -- 'customer' or 'owner'. This single column is our authorization:
  -- logging in says who you are, this says what you are allowed to do.
  role          VARCHAR(20)  NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'owner')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Set when a password is reset, so sessions opened before it stop working.
  password_changed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS products (
  -- Not SERIAL: the catalogue file chooses these ids.
  id          INTEGER PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  brand       VARCHAR(100) NOT NULL,
  category    VARCHAR(50)  NOT NULL,
  price_paise INTEGER      NOT NULL CHECK (price_paise >= 0),
  description TEXT         NOT NULL DEFAULT '',
  image       VARCHAR(200),
  -- The number this whole project is about.
  -- The CHECK is a last line of defence: even if application code has a bug,
  -- the database itself refuses to let stock go negative.
  stock       INTEGER      NOT NULL DEFAULT 0 CHECK (stock >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_brand    ON products (brand);

-- One row per product sitting in somebody's cart.
-- Deliberately has no price column: the cart points at the product and reads
-- the price live, so a price change shows up immediately. Nothing has been
-- bought yet, so there is nothing to freeze.
CREATE TABLE IF NOT EXISTS cart_items (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  quantity   INTEGER     NOT NULL CHECK (quantity > 0),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The same product cannot appear twice in one cart; adding it again
  -- increases the quantity instead.
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items (user_id);

-- The header of an order: who, when, how much, where to.
CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER      NOT NULL REFERENCES users (id),
  -- 'pending' today. When a payment gateway is added later this flips to
  -- 'paid' and nothing else has to change.
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'cancelled')),
  total_paise      INTEGER      NOT NULL CHECK (total_paise >= 0),
  placed_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  shipping_name    VARCHAR(120) NOT NULL,
  shipping_phone   VARCHAR(20)  NOT NULL,
  shipping_address TEXT         NOT NULL,
  shipping_state   VARCHAR(50)  NOT NULL,
  shipping_pincode VARCHAR(10)  NOT NULL,
  -- Razorpay's own identifiers, kept so a payment can be traced back to an
  -- order from their dashboard and vice versa. Null until payment is started.
  razorpay_order_id   VARCHAR(80),
  razorpay_payment_id VARCHAR(80),
  paid_at             TIMESTAMPTZ,
  -- 'razorpay' or 'sandbox'. Recorded so a receipt can never quietly imply
  -- money moved when it was the simulator.
  payment_provider    VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, placed_at DESC);

-- One product inside an order.
--
-- This table DOES copy the product name and price, which looks like exactly
-- the duplication cart_items avoids. It is deliberate: an order is a
-- historical record. If the shop raises the price next month this receipt
-- must still say what was actually paid, and it must survive the product
-- being renamed or removed from the catalogue.
--
-- A cart points at a product. An order remembers a product.
CREATE TABLE IF NOT EXISTS order_items (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id       INTEGER      NOT NULL REFERENCES products (id),
  product_name     VARCHAR(200) NOT NULL,
  unit_price_paise INTEGER      NOT NULL CHECK (unit_price_paise >= 0),
  quantity         INTEGER      NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- A password reset that has been asked for but not yet used.
--
-- The token itself is never stored, only a SHA-256 of it - the same reasoning
-- as passwords. Anyone who steals this table gets a list of hashes they
-- cannot turn back into working links.
--
-- SHA-256 rather than bcrypt here on purpose: a reset token is 32 random
-- bytes we generated, not a word a human chose, so there is nothing to guess
-- and no reason to make checking it deliberately slow.
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash VARCHAR(64)  NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  -- Set the moment it is spent. A reset link works exactly once.
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
