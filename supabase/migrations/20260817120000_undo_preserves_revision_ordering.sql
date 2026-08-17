-- Undo must not move the synchronization counter backwards.
--
-- `itinerary.revision` is not decoration. `isNewerItineraryRevision` accepts a
-- remote payload only when `incoming.revision > current.revision`, and both the
-- cloud fetch and the realtime subscription are gated on it. It exists to stop a
-- late-arriving payload from undoing a newer local state.
--
-- The first cut of `undo_itinerary_change` restored the BEFORE snapshot whole,
-- revision included, so a trip went 5 → 6 on apply and 6 → 5 on undo. A second
-- device holding 6 then evaluated `5 > 6`, discarded the undo, and kept showing
-- the applied plan — and its next edit wrote revision 7 carrying the *applied*
-- content, silently reverting an undo the user had already been told succeeded.
--
-- So: restore the content, advance the counter. The traveller gets exactly the
-- itinerary they had; every client still sees a strictly newer version.

create or replace function public.undo_itinerary_change(p_change_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_change public.itinerary_change_history%rowtype;
  v_current jsonb;
  v_current_hash text;
  v_current_revision bigint;
  v_restored jsonb;
begin
  select * into v_change
  from public.itinerary_change_history
  where id = p_change_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'change-not-undoable');
  end if;

  /**
   * A retried undo writes nothing and answers with the itinerary as it stands
   * *now* — never `before_itinerary`.
   *
   * The snapshot carries the pre-apply revision, so returning it would hand a
   * client a lower version than the one already committed and recreate the very
   * defect this migration exists to fix: lose the first undo's HTTP response,
   * retry, and the client would adopt revision 5 over a database at 7. Reading
   * the live row also means a legitimate edit made after the undo is returned as
   * itself rather than being papered over with a stale restore.
   */
  if v_change.status = 'undone' then
    select i.data into v_current
    from public.itineraries i
    where i.id = v_change.trip_id and i.user_id = p_user_id;

    if not found then
      return jsonb_build_object('ok', false, 'refusal', 'change-not-undoable');
    end if;

    return jsonb_build_object(
      'ok', true,
      'alreadyUndone', true,
      'changeId', v_change.id,
      'itinerary', v_current
    );
  end if;

  select i.data into v_current
  from public.itineraries i
  where i.id = v_change.trip_id and i.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'refusal', 'change-not-undoable');
  end if;

  -- Unchanged, and deliberately exact: undo is a restore, never a merge. If
  -- anything at all has happened since the apply, the newer work survives.
  v_current_hash := public.itinerary_state_hash(v_current);
  if v_current_hash is distinct from v_change.after_hash then
    return jsonb_build_object('ok', false, 'refusal', 'undo-stale');
  end if;

  /**
   * The next revision comes from the row being undone, not from the snapshot.
   * The hash check above has just proven this row is exactly the applied state,
   * so its revision is the authoritative one to advance from; the snapshot's
   * revision is historical content with no claim to ordering. Missing or
   * malformed values fall back to 0, matching `sanitizeItinerary`.
   */
  v_current_revision := case
    when jsonb_typeof(v_current->'revision') = 'number'
      then greatest(0, floor((v_current->>'revision')::numeric))::bigint
    else 0
  end;

  v_restored := case
    when jsonb_typeof(v_change.before_itinerary) = 'object'
      then jsonb_set(v_change.before_itinerary, '{revision}', to_jsonb(v_current_revision + 1), true)
    else v_change.before_itinerary
  end;

  update public.itineraries
     set data = v_restored,
         updated_at = now()
   where id = v_change.trip_id and user_id = p_user_id;

  update public.itinerary_change_history
     set status = 'undone', undone_at = now()
   where id = v_change.id;

  update public.trip_registry
     set updated_at = now(),
         day_count = case
           when jsonb_typeof(v_restored->'days') = 'array'
             then jsonb_array_length(v_restored->'days')
           else day_count
         end
   where id = v_change.trip_id and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyUndone', false,
    'changeId', v_change.id,
    'itinerary', v_restored
  );
end;
$$;

revoke all on function public.undo_itinerary_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_itinerary_change(uuid, uuid) to service_role;
