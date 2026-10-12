create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  full_name varchar(120) not null,
  email varchar(254) not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_unique unique (email)
);

create table if not exists events (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  title varchar(100) not null,
  type varchar(20) not null check (type in ('prazo', 'audiencia', 'reuniao')),
  event_date date not null,
  event_time time,
  process_number varchar(80),
  client varchar(120),
  court varchar(180),
  responsible varchar(120),
  reminder_minutes integer not null default 1440 check (reminder_minutes >= 0 and reminder_minutes <= 525600),
  notes varchar(2000),
  status varchar(20) not null default 'pending' check (status in ('pending', 'completed')),
  priority boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_user_date_idx on events (user_id, event_date, event_time);
create index if not exists events_user_status_idx on events (user_id, status);

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx on password_reset_tokens (user_id, expires_at);
