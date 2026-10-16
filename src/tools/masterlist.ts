import { z } from 'zod';
import { ToolError } from '../errors.js';
import type { Student } from '../masterlist/store.js';
import { defineTool, type AppContext } from '../tool.js';

function store(ctx: AppContext) {
  if (!ctx.masterlist) throw new ToolError('The masterlist is not configured (MASTERLIST_PATH is empty).');
  return ctx.masterlist;
}

function line(s: Student): string {
  const middle = s.middleName ? ` ${s.middleName}` : '';
  return `#${s.number}  ${s.tupmId}  ${s.lastName}, ${s.firstName}${middle}`;
}

export const masterlistCount = defineTool({
  name: 'masterlist_count',
  title: 'Count students',
  description: 'Return how many students are on the class masterlist.',
  access: 'read',
  inputSchema: {},
  async run(_args, ctx) {
    return `The masterlist has ${await store(ctx).count()} students.`;
  },
});

export const masterlistGet = defineTool({
  name: 'masterlist_get',
  title: 'Get student by number',
  description: 'Return the student at a list number (the "#" column), e.g. number 6.',
  access: 'read',
  inputSchema: { number: z.number().int().min(1).describe('The # on the masterlist') },
  async run({ number }, ctx) {
    const s = await store(ctx).get(number);
    if (!s) throw new ToolError(`There is no student number ${number} (list has ${await store(ctx).count()}).`);
    return line(s);
  },
});

export const masterlistSearch = defineTool({
  name: 'masterlist_search',
  title: 'Search masterlist',
  description:
    'Find students by part of a name or a TUPM ID. Matches "first last" and "last first". Returns up to 10 matches with their numbers.',
  access: 'read',
  inputSchema: { query: z.string().min(1).max(80).describe('Part of a name or TUPM ID') },
  async run({ query }, ctx) {
    const found = await store(ctx).search(query);
    if (found.length === 0) return `No student matches "${query}".`;
    const shown = found.slice(0, 10).map(line).join('\n');
    return found.length > 10 ? `${shown}\n...and ${found.length - 10} more; use a longer query.` : shown;
  },
});

export const masterlistList = defineTool({
  name: 'masterlist_list',
  title: 'List students',
  description: 'List students from number "from" to number "to" (at most 50 at a time).',
  access: 'read',
  inputSchema: {
    from: z.number().int().min(1).default(1),
    to: z.number().int().min(1).default(50),
  },
  async run({ from, to }, ctx) {
    if (to < from) throw new ToolError('"to" must be greater than or equal to "from".');
    const capped = Math.min(to, from + 49);
    const rows = await store(ctx).range(from, capped);
    if (rows.length === 0) return 'No students in that range.';
    const note = capped < to ? `\n...showing ${from}-${capped}; ask again for the rest.` : '';
    return rows.map(line).join('\n') + note;
  },
});

export const masterlistAdd = defineTool({
  name: 'masterlist_add',
  title: 'Add student',
  description:
    'Add a student to the masterlist. Appends at the end unless position is given. Numbers below stay in order and are renumbered. ' +
    'Fails if the TUPM ID is already listed. A backup of the file is saved first. The file must not be open in Excel.',
  access: 'write',
  inputSchema: {
    tupm_id: z.string().describe('e.g. TUPM-24-0123'),
    last_name: z.string(),
    first_name: z.string(),
    middle_name: z.string().default('').describe('Leave empty if none'),
    position: z.number().int().min(1).optional().describe('Insert at this number instead of the end'),
  },
  async run({ tupm_id, last_name, first_name, middle_name, position }, ctx) {
    const s = await store(ctx).add(
      { tupmId: tupm_id, lastName: last_name, firstName: first_name, middleName: middle_name },
      position,
    );
    return `Added: ${line(s)}\nThe list now has ${await store(ctx).count()} students.`;
  },
});

export const masterlistRemove = defineTool({
  name: 'masterlist_remove',
  title: 'Remove student',
  description:
    'Remove the student at a list number. You must first look the student up (masterlist_get or masterlist_search) and pass the ' +
    'TUPM ID you saw as tupm_id; if it does not match that number nothing is removed. Requires confirm: true. ' +
    'Later numbers move up by one. A backup is saved first.',
  access: 'destructive',
  inputSchema: {
    number: z.number().int().min(1),
    tupm_id: z.string().describe('TUPM ID of the student you expect at that number'),
    confirm: z.literal(true).describe('Must be true. Ask the user before setting it.'),
  },
  async run({ number, tupm_id }, ctx) {
    const s = await store(ctx).remove(number, tupm_id);
    return `Removed: ${line(s)}\nThe list now has ${await store(ctx).count()} students.`;
  },
});

export const masterlistTools = [
  masterlistCount,
  masterlistGet,
  masterlistSearch,
  masterlistList,
  masterlistAdd,
  masterlistRemove,
];
