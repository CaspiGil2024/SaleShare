-- =====================================================================
-- SailShare — Partners Sail participants + 9-person capacity cap
-- =====================================================================
-- bookings.id is integer (confirmed live schema, not uuid — see
-- 0005_schema_reality_baseline.sql), so the FK here matches that.
--
-- Capacity rule (owner + participants + guests <= 9) is enforced in
-- two places, each a single-statement check with no cross-transaction
-- gap:
--   1. BEFORE INSERT on booking_participants — blocks adding a partner
--      that would push the total over 9.
--   2. BEFORE UPDATE OF guests_count on bookings — blocks raising the
--      guest count on an existing booking past what its already-
--      attached participants leave room for.
--
-- NOT enforced server-side (deliberately, see chat): "a Shared booking
-- must have at least 1 participant". The client creates a booking row
-- first, then inserts participant rows in a second call — there's an
-- inherent moment where a Shared booking has 0 participants that a
-- same-transaction trigger can't see past. Doing this properly needs a
-- single RPC wrapping both inserts in one transaction; out of scope
-- for this pass. Enforced client-side only for now.
-- =====================================================================

create table if not exists public.booking_participants (
  id         uuid primary key default gen_random_uuid(),
  booking_id integer not null references public.bookings(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (booking_id, user_id)
);

alter table public.booking_participants enable row level security;

drop policy if exists booking_participants_select_all on public.booking_participants;
create policy booking_participants_select_all on public.booking_participants
  for select using (auth.role() = 'authenticated');

drop policy if exists booking_participants_manage on public.booking_participants;
create policy booking_participants_manage on public.booking_participants
  for all using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_participants.booking_id
        and (b.user_id = auth.uid() or public.is_manager())
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_participants.booking_id
        and (b.user_id = auth.uid() or public.is_manager())
    )
  );


create or replace function public.trg_fn_enforce_booking_capacity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_guests int;
  v_existing_participants int;
  v_total int;
begin
  select guests_count into v_guests from public.bookings where id = NEW.booking_id;

  select count(*) into v_existing_participants
  from public.booking_participants
  where booking_id = NEW.booking_id;

  -- owner(1) + existing participants + this new row + guests
  v_total := 1 + v_existing_participants + 1 + coalesce(v_guests, 0);

  if v_total > 9 then
    raise exception
      'לא ניתן להוסיף שותף נוסף - סך המשתתפים (שותפים ואורחים) לא יכול לעלות על 9. הסירו אורחים או שותפים לפני ההוספה.'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_booking_capacity on public.booking_participants;
create trigger trg_enforce_booking_capacity
  before insert on public.booking_participants
  for each row execute function public.trg_fn_enforce_booking_capacity();


create or replace function public.trg_fn_enforce_booking_capacity_on_guests()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_participant_count int;
  v_total int;
begin
  select count(*) into v_participant_count
  from public.booking_participants
  where booking_id = NEW.id;

  v_total := 1 + v_participant_count + coalesce(NEW.guests_count, 0);

  if v_total > 9 then
    raise exception
      'לא ניתן לעדכן את מספר האורחים - סך המשתתפים (שותפים ואורחים) לא יכול לעלות על 9.'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_booking_capacity_on_guests on public.bookings;
create trigger trg_enforce_booking_capacity_on_guests
  before update of guests_count on public.bookings
  for each row execute function public.trg_fn_enforce_booking_capacity_on_guests();
