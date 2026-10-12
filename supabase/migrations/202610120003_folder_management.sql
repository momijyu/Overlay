begin;

-- 直接UPDATE・DELETEは許可せず、所有者を確認する窓口だけを追加する。
create or replace function public.rename_note_folder(target_folder_id uuid, new_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_owner uuid := auth.uid();
  trimmed_name text := pg_catalog.btrim(new_name);
begin
  if request_owner is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if trimmed_name is null or pg_catalog.char_length(trimmed_name) not between 1 and 100 then
    raise exception 'Invalid folder name' using errcode = '23514';
  end if;

  -- 移動関数と同じロックを使い、別タブの移動・管理を順番に処理する。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_owner::text, 0));
  perform 1 from public.note_folders
    where id = target_folder_id and owner_id = request_owner for update;
  if not found then
    raise exception 'Folder is not available' using errcode = '42501';
  end if;

  -- 同じ親の下での同名衝突は既存のlower(name)ユニーク制約が拒否する。
  update public.note_folders set name = trimmed_name
    where id = target_folder_id and owner_id = request_owner;
  return target_folder_id;
end;
$$;

create or replace function public.delete_empty_note_folder(target_folder_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_owner uuid := auth.uid();
begin
  if request_owner is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_owner::text, 0));
  perform 1 from public.note_folders
    where id = target_folder_id and owner_id = request_owner for update;
  if not found then
    raise exception 'Folder is not available' using errcode = '42501';
  end if;

  if exists (select 1 from public.note_folders where parent_id = target_folder_id)
    or exists (select 1 from public.notes where folder_id = target_folder_id) then
    raise exception 'Folder is not empty' using errcode = '23503';
  end if;

  -- 外部キーは削除連鎖なしのまま。並行した子の追加も制約で保護する。
  delete from public.note_folders where id = target_folder_id and owner_id = request_owner;
  return target_folder_id;
end;
$$;

revoke execute on function public.rename_note_folder(uuid, text) from public, anon, authenticated;
revoke execute on function public.delete_empty_note_folder(uuid) from public, anon, authenticated;
grant execute on function public.rename_note_folder(uuid, text) to authenticated;
grant execute on function public.delete_empty_note_folder(uuid) to authenticated;

commit;
