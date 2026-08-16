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
 * Returns nothing rather than throwing when auth is unconfigured or nobody is
 * signed in: this renders in the navigation bar on every page, including the
 * public ones, and a bell is not worth an error boundary.
 */
export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id,kind,title,body,action_path,entity_type,entity_id,expires_at,read_at,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => decode(row as NotificationRow));
}

/** Marks one notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

/** Marks everything currently unread as read. */
export async function markAllNotificationsRead(): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
}
