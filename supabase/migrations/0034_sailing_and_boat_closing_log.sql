-- =====================================================================
-- SailShare — Sailing & Boat-Closing Log (יומן הפלגות וסגירת סירה)
-- =====================================================================
-- Append-only ship's-log, written exclusively by triggers (same
-- pattern as coin_transactions/checklist_submissions — no client
-- insert/update/delete policy at all).
--
-- "Boat closing" has no existing concept anywhere in this app, and
-- there's no scheduled job that could detect "a sail's time has simply
-- elapsed" — only discrete database actions can be logged
-- automatically. Mapped here (2026-08-27 decision, flagged in chat) to
-- the two real, system-observable events that affect the boat's
-- availability:
--   'departure' — a real sail booking (Private/Dockside/Shared/Cyprus,
--                 not Maintenance) is created.
--   'closing'   — either that sail is cancelled, OR a Maintenance
--                 booking is created (the boat is taken out of service).
-- If a manual "I've returned and secured the boat" check-out action is
-- actually what was meant instead, that needs a new UI action (there's
-- nothing to automatically hook for it) — flagged as a fast follow-up,
-- not built here.
-- =====================================================================

create table if not exists public.sailing_log (
  id          uuid primary key default gen_random_uuid(),
  booking_id  integer references public.bookings(id) on delete set null,
  user_id     uuid references public.users(id) on delete set null,
  action      text not null check (action in ('departure', 'closing')),
  reason      text, -- only set for 'closing': 'cancelled' | 'maintenance'
  booking_type text,
  start_time  timestamptz,
  end_time    timestamptz,
  logged_at   timestamptz not null default now()
);

create index if not exists sailing_log_logged_at_idx on public.sailing_log (logged_at);

alter table public.sailing_log enable row level security;

-- Universal read access, per requirement — same openness as bookings/
-- booking_participants/user_wallets already have.
drop policy if exists sailing_log_select_all on public.sailing_log;
create policy sailing_log_select_all on public.sailing_log
  for select using (auth.role() = 'authenticated');


create or replace function public.trg_fn_log_sail_departure()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.status = 'Cancelled' then
    return NEW;
  end if;

  if NEW.booking_type = 'Maintenance' then
    insert into public.sailing_log (booking_id, user_id, action, reason, booking_type, start_time, end_time)
    values (NEW.id, NEW.user_id, 'closing', 'maintenance', NEW.booking_type, NEW.start_time, NEW.end_time);
  else
    insert into public.sailing_log (booking_id, user_id, action, booking_type, start_time, end_time)
    values (NEW.id, NEW.user_id, 'departure', NEW.booking_type, NEW.start_time, NEW.end_time);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_log_sail_departure on public.bookings;
create trigger trg_log_sail_departure
  after insert on public.bookings
  for each row execute function public.trg_fn_log_sail_departure();


create or replace function public.trg_fn_log_sail_closing_on_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if OLD.status <> 'Cancelled' and NEW.status = 'Cancelled' then
    insert into public.sailing_log (booking_id, user_id, action, reason, booking_type, start_time, end_time)
    values (NEW.id, NEW.user_id, 'closing', 'cancelled', NEW.booking_type, NEW.start_time, NEW.end_time);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_log_sail_closing_on_cancel on public.bookings;
create trigger trg_log_sail_closing_on_cancel
  after update of status on public.bookings
  for each row execute function public.trg_fn_log_sail_closing_on_cancel();
