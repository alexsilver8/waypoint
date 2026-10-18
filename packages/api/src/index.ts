/**
 * @waypoint/api: the types of Waypoint's extension API, and small helpers that build its plain
 * objects. Everything an extension returns is plain data, so the helpers are optional: mix them
 * with object literals as you like. See docs/extensions.md in the Waypoint repository.
 *
 *   import { Action, defineExtension, item, list } from '@waypoint/api';
 *
 *   export default defineExtension({
 *     commands: {
 *       uuid: {
 *         view() {
 *           const uuid = crypto.randomUUID();
 *           return list({ items: [item({ title: uuid, actions: [Action.copy(uuid)] })] });
 *         },
 *       },
 *     },
 *   });
 */

export * from './actions';
// `Action` and `Icon` are types in ./types and builders here: naming them settles which export wins.
export { Action } from './actions';
export * from './fields';
export * from './icons';
export { Icon } from './icons';
export * from './shortcut';
export type * from './types';
export * from './views';
