-- =====================================================================
-- SailShare — fix: role-gate trigger blocked direct SQL Editor runs
-- =====================================================================
-- trg_fn_enforce_partner_roster_role_gates() (0015) calls
-- can_edit_partners()/is_admin()/is_admin_or_treasurer(), all of which
-- key off auth.uid(). That's fine for RLS policies (Postgres skips RLS
-- entirely for the postgres/service role the SQL Editor runs as), but
-- a BEFORE UPDATE/DELETE TRIGGER still fires even when RLS is bypassed
-- — so running a plain UPDATE in the SQL Editor (no authenticated
-- session, auth.uid() = null) tripped the trigger's role check and
-- failed with "אין לכם הרשאה לערוך את פרטי השותף", exactly what
-- happened running 0016's balance reset.
--
-- Fix: skip the role gate entirely when auth.uid() is null — that only
-- happens for direct database-credential access (SQL Editor, this
-- migration chain itself, a service-role script), which is already a
-- stronger bar than any in-app role. Normal app traffic through
-- PostgREST always has a real auth.uid(), so this doesn't loosen
-- anything for actual users.
-- =====================================================================

create or replace function public.trg_fn_enforce_partner_roster_role_gates()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    -- Direct DB-credential execution (SQL Editor, migrations, a
    -- service-role script) — not a normal in-app request, skip the
    -- app-role gate.
    if TG_OP = 'DELETE' then
      delete from public.users where lower(email) = lower(OLD.email);
      return OLD;
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if not public.is_admin() then
      raise exception 'רק מנהל יכול למחוק שותף לצמיתות.' using errcode = 'P0001';
    end if;
    delete from public.users where lower(email) = lower(OLD.email);
    return OLD;
  end if;

  -- TG_OP = 'UPDATE'
  if (NEW.is_active is distinct from OLD.is_active) or (NEW.is_frozen is distinct from OLD.is_frozen) then
    if not public.is_admin_or_treasurer() then
      raise exception 'רק מנהל או גזבר יכולים להקפיא או להשבית שותף.' using errcode = 'P0001';
    end if;
  end if;

  if (NEW.full_name, NEW.email, NEW.phone, NEW.roles, NEW.balance)
     is distinct from (OLD.full_name, OLD.email, OLD.phone, OLD.roles, OLD.balance) then
    if not public.can_edit_partners() then
      raise exception 'אין לכם הרשאה לערוך את פרטי השותף.' using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;
