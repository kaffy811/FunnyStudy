-- Participant-editable humor preference summary shown on /history.
-- No row means the page shows a summary generated from the participant's
-- style-check answers; saving stores the participant's own text here.
-- Deleting the row ("Reset to generated") returns to the generated summary.

create table public.profile_humor_summaries (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  created_datetime_utc timestamptz not null default statement_timestamp(),
  modified_datetime_utc timestamptz not null default statement_timestamp()
);

alter table public.profile_humor_summaries enable row level security;
revoke all on public.profile_humor_summaries from public, anon, authenticated;
grant select, delete on public.profile_humor_summaries to authenticated;
grant insert (profile_id, summary), update (profile_id, summary)
  on public.profile_humor_summaries to authenticated;
create policy "Participants can read their humor summary"
  on public.profile_humor_summaries for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read humor summaries"
  on public.profile_humor_summaries for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can add their humor summary"
  on public.profile_humor_summaries for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "Participants can edit their humor summary"
  on public.profile_humor_summaries for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy "Participants can reset their humor summary"
  on public.profile_humor_summaries for delete to authenticated
  using (profile_id = (select auth.uid()));

create function public.stamp_profile_humor_summary_modified()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.modified_datetime_utc := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_profile_humor_summary_modified() from public, anon, authenticated;
create trigger stamp_profile_humor_summary_modified
  before update on public.profile_humor_summaries
  for each row execute function public.stamp_profile_humor_summary_modified();
