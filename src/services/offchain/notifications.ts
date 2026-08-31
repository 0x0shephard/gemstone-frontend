import { supabase } from '@/providers/supabase';

/**
 * The reader side of the notification system.
 *
 * Written only by the scheduled sweep through the service role; RLS lets a
 * signed-in reader see their own rows and change nothing but `read_at`.
 */

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  actionPath: string | null;
  entityType: string;
  entityId: string;
  expiresAt: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  action_path: string | null;
  entity_type: string;
  entity_id: string;
  expires_at: string | null;
  read_at: string | null;
  created_at: string;
}

const decode = (row: NotificationRow): AppNotification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  actionPath: row.action_path,
  entityType: row.entity_type,
  entityId: row.entity_id,
  expiresAt: row.expires_at,
  readAt: row.read_at,
  createdAt: row.created_at,
});

/**
 * Recent notifications for the signed-in reader, newest first.
 *
 * Returns nothing when auth is not configured. A configured backend error is
 * allowed to propagate so the bell can distinguish "no notifications" from
 * "notifications could not be loaded" and offer a retry.
 */
export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id,kind,title,body,action_path,entity_type,entity_id,expires_at,read_at,created_at')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => decode(row as NotificationRow));
}

/** Marks one notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Marks everything currently unread as read. */
export async function markAllNotificationsRead(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Clears one notification from the list.
 *
 * Hidden rather than deleted, and that is not squeamishness. The sweep
 * deduplicates on `(wallet, kind, entity, entity_id)` and re-derives the same
 * open offer every hour, so a deleted row would be reinserted on the next pass —
 * clearing your list would appear to work and undo itself within the hour.
 */
export async function dismissNotification(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Clears everything currently visible. */
export async function clearAllNotifications(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .is('dismissed_at', null);
  if (error) throw error;
}
