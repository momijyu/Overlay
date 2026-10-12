begin;

-- フォルダとノート名を追加する。既存のPDF・線データには触れない。
create table public.note_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, parent_id) references public.note_folders(owner_id, id),
  check (parent_id is null or parent_id <> id)
);

create unique index note_folders_root_name
on public.note_folders(owner_id, lower(name)) where parent_id is null;
create unique index note_folders_child_name
on public.note_folders(owner_id, parent_id, lower(name)) where parent_id is not null;

alter table public.note_folders enable row level security;
create policy "note_folders_select_own"
on public.note_folders for select to authenticated
using ((select auth.uid()) = owner_id);
create policy "note_folders_insert_own"
on public.note_folders for insert to authenticated
with check ((select auth.uid()) = owner_id);

revoke all on public.note_folders from anon, authenticated;
grant select, insert on public.note_folders to authenticated;

-- 親は既に保存された自分のフォルダだけ。親の変更は今回提供しない。
-- 複数行の同時INSERTで循環した親子関係を作ることも防ぐ。
create function public.check_note_folder_parent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.note_folders
    where id = new.parent_id and owner_id = new.owner_id
  ) then
    raise exception 'Parent folder is not available' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger note_folders_check_parent
before insert on public.note_folders
for each row execute function public.check_note_folder_parent();

alter table public.notes
  add column title text check (title is null or char_length(btrim(title)) between 1 and 120),
  add column folder_id uuid,
  add constraint notes_folder_matches_owner
    foreign key (owner_id, folder_id) references public.note_folders(owner_id, id);

commit;
