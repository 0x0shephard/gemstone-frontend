import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import {
  clearAllNotifications,
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/offchain/notifications';
import { cn } from '@/lib/cn';
import { PushToggle } from './PushToggle';

/**
 * Unread protocol notifications, in the navigation bar.
 *
 * The email is what reaches someone who is not looking at the site; this is what
 * they find when they arrive. It reads the same rows, so a message is never in
 * one place and not the other.
 */

/** Matches the sweep's cadence. Notifications are written hourly at most. */
const REFRESH_MS = 120_000;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1_000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id ?? 'anonymous'],
    queryFn: () => listNotifications(),
    // Nothing to read when signed out, and the table would refuse anyway.
    enabled: Boolean(user),
    refetchInterval: REFRESH_MS,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['notifications', user?.id ?? 'anonymous'] });

  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });
  const dismissOne = useMutation({ mutationFn: dismissNotification, onSuccess: invalidate });
  const clearAll = useMutation({ mutationFn: clearAllNotifications, onSuccess: invalidate });

  // Dismiss on an outside click or Escape, so the panel does not sit open over
  // the page after attention has moved on.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const unread = notifications.filter((notification) => !notification.readAt);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[4px] border border-line/[0.1] text-ink transition-colors hover:bg-line/[0.035]"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3a6 6 0 0 0-6 6c0 3.6-1 5.4-1.7 6.3a.7.7 0 0 0 .5 1.2h14.4a.7.7 0 0 0 .5-1.2C19 14.4 18 12.6 18 9a6 6 0 0 0-6-6ZM9.5 19.5a2.6 2.6 0 0 0 5 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread.length > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: 'var(--dc-amber, #b4762c)' }}
          >
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="dc-header-popover dc-header-popover-notifications z-50 flex flex-col overflow-hidden overscroll-contain rounded-[4px] border border-line/[0.1] bg-card shadow-xl"
        >
          <div className="flex shrink-0 flex-col items-start gap-2 border-b border-line/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-ink-dim">
              Notifications
            </span>
            <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
              {unread.length > 0 && (
                <button
                  type="button"
                  onClick={() => readAll.mutate()}
                  className="text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearAll.mutate()}
                  className="text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <PushToggle />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-ink-dim">
                Nothing needs your attention.
              </p>
            ) : (
              notifications.map((notification) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold leading-snug text-ink">
                        {notification.title}
                      </span>
                      {!notification.readAt && (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: 'var(--dc-amber, #b4762c)' }}
                          aria-hidden
                        />
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                      {notification.body}
                    </p>
                    <span className="mt-1.5 block text-[10.5px] text-ink-dim">
                      {timeAgo(notification.createdAt)}
                    </span>
                  </>
                );

                const className = cn(
                  'block w-full py-3 pl-4 pr-9 text-left transition-colors',
                  notification.readAt
                    ? 'hover:bg-line/[0.02]'
                    : 'bg-line/[0.025] hover:bg-line/[0.045]',
                );

                // Reading and acting are the same gesture: anything worth
                // notifying about has somewhere to go and something to do.
                const openNotification = () => {
                  if (!notification.readAt) readOne.mutate(notification.id);
                  setOpen(false);
                };

                return (
                  // The dismiss control is a sibling of the row, not a child: a
                  // button nested inside a link is invalid, and browsers resolve
                  // it by firing whichever they feel like.
                  <div
                    key={notification.id}
                    className="relative border-b border-line/[0.06] last:border-b-0"
                  >
                    {notification.actionPath ? (
                      <Link
                        to={notification.actionPath}
                        onClick={openNotification}
                        className={className}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={openNotification} className={className}>
                        {body}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => dismissOne.mutate(notification.id)}
                      className="absolute right-1.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-[4px] text-[15px] leading-none text-ink-dim transition-colors hover:bg-line/[0.06] hover:text-ink"
                      aria-label={`Clear notification: ${notification.title}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
