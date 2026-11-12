-- AI studies: each sign-in starts a fresh study of random study images with
-- AI-written captions in balanced, randomly assigned humor styles. A Funny tap
-- is the A/B signal; when the study ends an AI summary updates the profile.
-- Captions live in ai_generated_captions (image_source = 'study').

create table public.ai_study_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  item_count smallint check (item_count between 0 and 50),
  liked_count smallint check (liked_count between 0 and 50),
  ai_summary text check (char_length(ai_summary) between 1 and 1000),
  ended_datetime_utc timestamptz,
  created_datetime_utc timestamptz not null default statement_timestamp()
);

create index ai_study_sessions_profile_created_idx
  on public.ai_study_sessions(profile_id, created_datetime_utc desc);

alter table public.ai_study_sessions enable row level security;
revoke all on public.ai_study_sessions from public, anon, authenticated;
grant select on public.ai_study_sessions to authenticated;
grant insert (profile_id, model, prompt_version),
  update (item_count, liked_count, ai_summary, ended_datetime_utc)
  on public.ai_study_sessions to authenticated;
create policy "Participants can read their AI studies"
  on public.ai_study_sessions for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read AI studies"
  on public.ai_study_sessions for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can start their AI studies"
  on public.ai_study_sessions for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "Participants can finish their AI studies"
  on public.ai_study_sessions for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Study captions: one per image, linked to the study and its position.
alter table public.ai_generated_captions
  drop constraint ai_generated_captions_image_source_check;
alter table public.ai_generated_captions
  add constraint ai_generated_captions_image_source_check
    check (image_source in ('upload', 'style_pair', 'study')),
  add column session_id uuid references public.ai_study_sessions(id) on delete cascade,
  add column position smallint check (position between 1 and 50),
  add column image_id uuid references public.images(id) on delete set null,
  add column viewed_datetime_utc timestamptz,
  add constraint ai_generated_captions_study_fields_check
    check ((image_source = 'study') = (session_id is not null and position is not null)),
  add constraint ai_generated_captions_session_position_key unique (session_id, position);

grant insert (session_id, position, image_id), update (viewed_datetime_utc)
  on public.ai_generated_captions to authenticated;

drop policy "Participants can save their AI captions" on public.ai_generated_captions;
create policy "Participants can save their AI captions"
  on public.ai_generated_captions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      session_id is null
      or exists (
        select 1 from public.ai_study_sessions s
        where s.id = session_id and s.profile_id = (select auth.uid())
      )
    )
  );

-- Random images that appear in research studies and that the caller may see
-- (security invoker, so the images RLS policies still apply).
create function public.pick_ai_study_images(p_count integer, p_exclude uuid[] default '{}')
returns table (id uuid, url text)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.url
  from public.images i
  where i.url is not null
    and (i.is_public or i.is_common_use)
    and not (i.id = any (coalesce(p_exclude, '{}'::uuid[])))
    and exists (
      select 1
      from public.captions c
      join public.study_caption_mappings m on m.caption_id = c.id
      where c.image_id = i.id
    )
  order by random()
  limit least(greatest(coalesce(p_count, 1), 1), 40);
$$;
revoke all on function public.pick_ai_study_images(integer, uuid[]) from public, anon;
grant execute on function public.pick_ai_study_images(integer, uuid[]) to authenticated;

-- Who wrote the saved humor summary: the participant or the end-of-study AI.
alter table public.profile_humor_summaries
  add column source text not null default 'user' check (source in ('user', 'ai'));
grant insert (source), update (source) on public.profile_humor_summaries to authenticated;
