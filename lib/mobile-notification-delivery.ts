import { getNotificationCenter } from '@/lib/notification-store';
import { sendMobilePush } from '@/lib/mobile-companion';

export async function deliverMobilePriorityNotifications(profileId: string) {
  const center = await getNotificationCenter(profileId);
  const notifications = center.notifications.filter((item) => item.status === 'unread' && (item.severity === 'critical' || item.severity === 'high')).slice(0, 20);
  let sent = 0; let failed = 0;
  const results: Array<{ notificationId: string; sent: number; failed: number }> = [];
  for (const notification of notifications) {
    try {
      const delivery = await sendMobilePush(profileId, {
        title: notification.title,
        body: notification.summary,
        data: { url: 'https://elpgpt.com/notifications', notificationId: notification.id, severity: notification.severity, kind: notification.kind },
      });
      sent += delivery.sent; failed += delivery.failed; results.push({ notificationId: notification.id, ...delivery });
    } catch {
      failed += 1; results.push({ notificationId: notification.id, sent: 0, failed: 1 });
    }
  }
  return { attempted: notifications.length, sent, failed, results };
}
