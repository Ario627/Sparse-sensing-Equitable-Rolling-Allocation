import type { EventType } from '@sera/contracts';

export const EVENT_ENTITY = 'Event';
export const ACKNOWLEDGE_AUDIT_ACTION = 'event.acknowledge';
export const EVENT_TYPE_ALERT: EventType = 'alert';

export const EVENT_MESSAGES = {
  notFound: 'Event not found',
  notAlert: 'Only alert events can be acknowledged',
} as const;
