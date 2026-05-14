-- LS Battery Backend — Database Schema
-- Run this once to set up all tables
-- Command: psql $DATABASE_URL -f sql/schema.sql

-- ── BATTERIES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batteries (
  id           SERIAL PRIMARY KEY,
  model        VARCHAR(50)  UNIQUE NOT NULL,  -- e.g. NS60L
  brand        VARCHAR(50)  NOT NULL,          -- e.g. Amaron
  category     VARCHAR(20)  NOT NULL,          -- japanese / european / korean / commercial
  voltage      INTEGER      NOT NULL DEFAULT 12,
  capacity_ah  INTEGER      NOT NULL,          -- e.g. 45
  cca          INTEGER      NOT NULL,          -- cold cranking amps
  price        NUMERIC(8,2) NOT NULL,
  warranty_months INTEGER   NOT NULL DEFAULT 12,
  fits         TEXT,                           -- compatible vehicles description
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── LOCKER LOCATIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  address      TEXT         NOT NULL,
  hours        VARCHAR(100),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── LOCKER DOORS (30 doors, 1 location) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lockers (
  id              SERIAL PRIMARY KEY,
  location_id     INTEGER      NOT NULL REFERENCES locations(id),
  door_number     INTEGER      NOT NULL,        -- 1 to 30
  status          VARCHAR(20)  NOT NULL DEFAULT 'available',
                               -- available / reserved / collected / maintenance
  battery_id      INTEGER      REFERENCES batteries(id),  -- which battery is loaded
  access_code     VARCHAR(10),                  -- 4-digit code assigned on reservation
  reserved_until  TIMESTAMPTZ,                  -- when 24h hold expires
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(location_id, door_number)
);

-- ── CUSTOMERS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100),
  email        VARCHAR(150) UNIQUE,
  mobile       VARCHAR(20),                     -- Singapore number e.g. 91234567
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── ORDERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  reference         VARCHAR(20)  UNIQUE NOT NULL,  -- LSB-XXXXXX
  customer_id       INTEGER      REFERENCES customers(id),
  locker_id         INTEGER      NOT NULL REFERENCES lockers(id),
  battery_id        INTEGER      NOT NULL REFERENCES batteries(id),
  collection_date   DATE         NOT NULL,
  hold_expires_at   TIMESTAMPTZ  NOT NULL,          -- collection_date + 24h
  access_code       VARCHAR(10)  NOT NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
                                 -- pending / paid / collected / expired / refunded
  amount_paid       NUMERIC(8,2),
  refund_amount     NUMERIC(8,2),
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  collected_at      TIMESTAMPTZ,
  expired_at        TIMESTAMPTZ
);

-- ── PAYMENTS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER      NOT NULL REFERENCES orders(id),
  stripe_payment_id   VARCHAR(100) UNIQUE,        -- pi_xxxxxxxxx
  stripe_charge_id    VARCHAR(100),
  amount              NUMERIC(8,2) NOT NULL,
  currency            VARCHAR(5)   NOT NULL DEFAULT 'sgd',
  status              VARCHAR(20)  NOT NULL,       -- succeeded / failed / refunded
  failure_reason      TEXT,
  refund_id           VARCHAR(100),               -- re_xxxxxxxxx
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── NOTIFICATIONS LOG ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER      REFERENCES orders(id),
  type         VARCHAR(30)  NOT NULL,   -- confirmation / reminder / expiry / refund
  channel      VARCHAR(20)  NOT NULL,   -- whatsapp / email
  recipient    VARCHAR(150) NOT NULL,
  status       VARCHAR(20)  NOT NULL,   -- sent / failed
  sent_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  entity       VARCHAR(30)  NOT NULL,   -- order / locker / payment / inventory
  entity_id    INTEGER,
  action       VARCHAR(50)  NOT NULL,   -- created / updated / expired / refunded
  old_value    JSONB,
  new_value    JSONB,
  performed_by VARCHAR(50)  DEFAULT 'system',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── ADMIN USERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name         VARCHAR(100),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_reference    ON orders(reference);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_hold_expires ON orders(hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_lockers_status      ON lockers(status);
CREATE INDEX IF NOT EXISTS idx_payments_order      ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_customers_mobile    ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_email     ON customers(email);
