-- LS Battery — Seed Data
-- Run after schema.sql: psql $DATABASE_URL -f sql/seed.sql

-- ── LOCATION (1 location, 30 doors) ─────────────────────────────────────────
INSERT INTO locations (name, address, hours) VALUES
  ('Kian Teck Road (West)', '46 Kian Teck Road, Singapore 628786', 'Mon–Fri 8:30am–5:30pm · Sat 8:30am–4pm · Sun Closed')
ON CONFLICT DO NOTHING;

-- ── 20 BATTERY MODELS ───────────────────────────────────────────────────────
INSERT INTO batteries (model, brand, category, voltage, capacity_ah, cca, price, warranty_months, fits) VALUES
  ('NS40ZL',  'Amaron',  'japanese',   12, 35,  330, 89.00,  12, 'Toyota Vios, Honda Jazz, Suzuki Swift'),
  ('NS60L',   'Amaron',  'japanese',   12, 45,  390, 109.00, 12, 'Toyota Camry, Honda Civic, Nissan Sylphy'),
  ('NS70',    'Amaron',  'japanese',   12, 55,  480, 129.00, 12, 'Toyota Fortuner, Honda CR-V, Mitsubishi Outlander'),
  ('NS60LS',  'Exide',   'japanese',   12, 45,  400, 99.00,  12, 'Mazda 3, Mitsubishi Lancer, Nissan Livina'),
  ('NS70L',   'Exide',   'japanese',   12, 60,  500, 139.00, 12, 'Toyota Alphard, Honda Odyssey, Nissan Serena'),
  ('55B24L',  'Globatt', 'korean',     12, 45,  380, 99.00,  12, 'Hyundai Elantra, Kia Cerato, Ssangyong Tivoli'),
  ('75D23L',  'Globatt', 'korean',     12, 52,  470, 119.00, 12, 'Hyundai Tucson, Kia Sportage, Genesis G70'),
  ('95D31L',  'Globatt', 'korean',     12, 70,  550, 149.00, 12, 'Hyundai Santa Fe, Kia Sorento, Genesis GV80'),
  ('DIN45',   'Bosch',   'european',   12, 45,  400, 129.00, 24, 'Volkswagen Polo, Mini Cooper, BMW 1 Series'),
  ('DIN55',   'Bosch',   'european',   12, 55,  520, 149.00, 24, 'BMW 3 Series, Audi A4, Volkswagen Golf'),
  ('DIN66',   'Bosch',   'european',   12, 66,  620, 179.00, 24, 'Mercedes C-Class, BMW 5 Series, Audi A6'),
  ('DIN74',   'Bosch',   'european',   12, 74,  680, 199.00, 24, 'Volvo XC60, Land Rover Discovery, Porsche Cayenne'),
  ('DIN88',   'Bosch',   'european',   12, 88,  720, 229.00, 24, 'Mercedes E-Class, BMW 7 Series, Audi A8'),
  ('N50ZZ',   'Volta',   'japanese',   12, 60,  430, 119.00, 12, 'Toyota Hiace (old), Mitsubishi Delica'),
  ('N70ZZ',   'Amaron',  'commercial', 12, 80,  600, 159.00, 12, 'Toyota HiAce, Nissan NV350, Mitsubishi Canter'),
  ('N100',    'Bosch',   'commercial', 12, 100, 750, 219.00, 12, 'Isuzu NPR, Hino 300, Ford Transit'),
  ('N120',    'Exide',   'commercial', 12, 120, 850, 259.00, 12, 'Isuzu ELF, Hino 500, Mercedes Sprinter'),
  ('MF40B19', 'Hercules','japanese',   12, 28,  280, 79.00,  12, 'Suzuki Jimny, Perodua Myvi, Toyota Agya'),
  ('MF50B24', 'Hercules','japanese',   12, 36,  320, 89.00,  12, 'Honda Freed, Suzuki Ertiga, Daihatsu Terios'),
  ('LN2',     'Bosch',   'european',   12, 60,  580, 169.00, 24, 'Mercedes A-Class, Volvo V40, Peugeot 308')
ON CONFLICT (model) DO NOTHING;

-- ── 30 LOCKER DOORS ─────────────────────────────────────────────────────────
-- Doors 1–20: stocked with a battery each (cycles through first 20 models)
-- Doors 21–30: empty/available for restocking
DO $$
DECLARE
  loc_id   INTEGER;
  bat_id   INTEGER;
  door_num INTEGER;
  bat_ids  INTEGER[];
BEGIN
  SELECT id INTO loc_id FROM locations LIMIT 1;
  SELECT ARRAY(SELECT id FROM batteries ORDER BY id) INTO bat_ids;

  FOR door_num IN 1..30 LOOP
    -- Doors 1–20 get a battery loaded; 21–30 start empty
    IF door_num <= 20 THEN
      bat_id := bat_ids[((door_num - 1) % array_length(bat_ids, 1)) + 1];
      INSERT INTO lockers (location_id, door_number, status, battery_id)
        VALUES (loc_id, door_num, 'available', bat_id)
        ON CONFLICT (location_id, door_number) DO NOTHING;
    ELSE
      INSERT INTO lockers (location_id, door_number, status)
        VALUES (loc_id, door_num, 'available')
        ON CONFLICT (location_id, door_number) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ── DEFAULT ADMIN USER ───────────────────────────────────────────────────────
-- Password: Admin@LSBattery1 — CHANGE THIS IMMEDIATELY after first login
-- Hash generated with bcrypt rounds=10
INSERT INTO admin_users (email, password_hash, name) VALUES
  ('admin@lsbattery.com.sg',
   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.',
   'LS Battery Admin')
ON CONFLICT (email) DO NOTHING;
