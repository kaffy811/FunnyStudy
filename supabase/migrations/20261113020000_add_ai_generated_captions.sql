-- Caption lab: captions written by an AI model for an image the participant
-- uploads (not stored) or picks from the style-check images. Participants rate
-- each caption; ratings feed their humor profile. Kept apart from captions,
-- caption_votes and study statistics.

create table public.ai_generated_captions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid not null,
  image_source text not null check (image_source in ('upload', 'style_pair')),
  -- Uploaded photos are never stored; only sample images keep their URL.
  image_url text check ((image_source = 'upload') = (image_url is null)),
  style_id smallint not null references public.humor_styles(id),
  caption text not null check (char_length(caption) between 1 and 300),
  personalized boolean not null,
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  rating smallint check (rating in (-1, 1)),
  rated_datetime_utc timestamptz,
  created_datetime_utc timestamptz not null default statement_timestamp()
);

create index ai_generated_captions_profile_created_idx
  on public.ai_generated_captions(profile_id, created_datetime_utc desc);

alter table public.ai_generated_captions enable row level security;
revoke all on public.ai_generated_captions from public, anon, authenticated;
grant select on public.ai_generated_captions to authenticated;
grant insert (profile_id, batch_id, image_source, image_url, style_id, caption, personalized, model, prompt_version),
  update (rating)
  on public.ai_generated_captions to authenticated;
create policy "Participants can read their AI captions"
  on public.ai_generated_captions for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "Superadmins can read AI captions"
  on public.ai_generated_captions for select to authenticated
  using (public.is_superadmin((select auth.uid())));
create policy "Participants can save their AI captions"
  on public.ai_generated_captions for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "Participants can rate their AI captions"
  on public.ai_generated_captions for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create function public.stamp_ai_generated_caption_rating()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.rated_datetime_utc := case when new.rating is null then null else statement_timestamp() end;
  return new;
end;
$$;
revoke all on function public.stamp_ai_generated_caption_rating() from public, anon, authenticated;
create trigger stamp_ai_generated_caption_rating
  before update of rating on public.ai_generated_captions
  for each row execute function public.stamp_ai_generated_caption_rating();
