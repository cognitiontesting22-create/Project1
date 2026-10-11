import 'server-only';
import { convertMinorUnits } from './currency';
import { db } from './db';
import {
  PERSON_POSITIONS_SQL,
  indicativeTotal,
  normaliseName,
  summarise,
  type PersonPosition,
  type PersonSummary,
} from './people';
import { getRateE8 } from './queries';
import type { Person, PersonDirectoryEntry } from './types';

export function listPeople(): PersonDirectoryEntry[] {
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM members m WHERE m.person_id = p.id) AS group_count,
              (SELECT GROUP_CONCAT(DISTINCT m.name) FROM members m
                WHERE m.person_id = p.id)                               AS aliases
         FROM people p
        ORDER BY p.display_name COLLATE NOCASE`
    )
    .all() as PersonDirectoryEntry[];
}

export function getPerson(id: number): Person | undefined {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id) as Person | undefined;
}

export function getPersonPositions(personId: number): PersonPosition[] {
  return db.prepare(PERSON_POSITIONS_SQL).all({ personId }) as PersonPosition[];
}

export function getPersonSummary(personId: number): PersonSummary {
  return summarise(getPersonPositions(personId));
}

/**
 * A single headline figure across currencies, converted at today's rates.
 * Every other number in the app is locked to its booking rate; this one can't
 * be, so the UI labels it as indicative.
 */
export function getIndicativeTotal(positions: PersonPosition[], displayCurrency: string) {
  const target = getRateE8(displayCurrency);
  return indicativeTotal(positions, (cents, currency) =>
    convertMinorUnits(cents, getRateE8(currency), target)
  );
}

/** Member rows not yet attached to any person, for the linking UI. */
export function listUnlinkedMembers() {
  return db
    .prepare(
      `SELECT m.id, m.name, m.email, g.id AS group_id, g.name AS group_name, g.emoji
         FROM members m JOIN groups g ON g.id = m.group_id
        WHERE m.person_id IS NULL
        ORDER BY m.name COLLATE NOCASE`
    )
    .all() as {
    id: number;
    name: string;
    email: string | null;
    group_id: number;
    group_name: string;
    emoji: string;
  }[];
}

export function listMembersOfPerson(personId: number) {
  return db
    .prepare(
      `SELECT m.id, m.name, g.id AS group_id, g.name AS group_name, g.emoji
         FROM members m JOIN groups g ON g.id = m.group_id
        WHERE m.person_id = ?
        ORDER BY g.name`
    )
    .all(personId) as {
    id: number;
    name: string;
    group_id: number;
    group_name: string;
    emoji: string;
  }[];
}

export function createPerson(displayName: string, email?: string): number {
  const name = displayName.trim();
  if (!name) throw new Error('Give this person a name.');
  const info = db
    .prepare('INSERT INTO people (display_name, email) VALUES (?, ?)')
    .run(name, email?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function linkMemberToPerson(memberId: number, personId: number | null): void {
  if (personId !== null && !getPerson(personId)) throw new Error('Unknown person.');
  db.prepare('UPDATE members SET person_id = ? WHERE id = ?').run(personId, memberId);
}

/**
 * Merges one person into another, moving every member link across. Used by the
 * directory when two records turn out to be the same human.
 */
export function mergePeople(sourceId: number, targetId: number): void {
  if (sourceId === targetId) throw new Error('Pick two different people.');
  if (!getPerson(sourceId) || !getPerson(targetId)) throw new Error('Unknown person.');

  const tx = db.transaction(() => {
    db.prepare('UPDATE members SET person_id = ? WHERE person_id = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM people WHERE id = ?').run(sourceId);
  });
  tx();
}

export function deletePerson(id: number): void {
  // Member rows survive; they just stop pointing anywhere (ON DELETE SET NULL).
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
}

/** Candidate people for an unlinked member, by normalised name or email. */
export function suggestPeopleFor(memberId: number): Person[] {
  const member = db
    .prepare('SELECT name, email FROM members WHERE id = ?')
    .get(memberId) as { name: string; email: string | null } | undefined;
  if (!member) return [];

  const all = db.prepare('SELECT * FROM people').all() as Person[];
  const target = normaliseName(member.name);

  return all.filter(
    (p) =>
      normaliseName(p.display_name) === target ||
      (!!member.email && !!p.email && p.email.toLowerCase() === member.email.toLowerCase())
  );
}
