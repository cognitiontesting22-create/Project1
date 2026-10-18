import 'server-only';
import { cookies } from 'next/headers';
import { actorCookieName, resolveActor } from './activity';
import { listMembers } from './queries';
import type { Member } from './types';

/**
 * The acting-as member for a group, from this request's cookie. Works the same
 * in pages, server actions and route handlers, so a script sending
 * `Cookie: tally_actor_3=12` acts as member 12 in group 3.
 */
export async function currentActor(groupId: number): Promise<Member | undefined> {
  const store = await cookies();
  return resolveActor(listMembers(groupId), store.get(actorCookieName(groupId))?.value);
}

export async function currentActorId(groupId: number): Promise<number | null> {
  return (await currentActor(groupId))?.id ?? null;
}
