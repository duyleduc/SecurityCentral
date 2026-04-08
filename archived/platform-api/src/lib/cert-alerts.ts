import { prisma } from './prisma.js';
import { notificationsQueue } from '../jobs/queues.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'cert-alerts' });

/**
 * Alert type thresholds for certificate expiry notifications.
 * Each threshold triggers at most one alert per certificate.
 */
const EXPIRY_THRESHOLDS = [
  { type: 'expiry_90d', days: 90 },
  { type: 'expiry_60d', days: 60 },
  { type: 'expiry_30d', days: 30 },
  { type: 'expiry_7d', days: 7 },
  { type: 'expiry_1d', days: 1 },
  { type: 'expired', days: 0 },
] as const;

export type AlertType = (typeof EXPIRY_THRESHOLDS)[number]['type'];

/**
 * Determine which alert type applies for a certificate based on days until expiry.
 */
export function resolveAlertType(daysUntilExpiry: number): AlertType | null {
  // Iterate from most urgent (expired) to least urgent (90d)
  // Return the most specific threshold the cert has crossed
  for (let i = EXPIRY_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = EXPIRY_THRESHOLDS[i];
    if (daysUntilExpiry <= threshold.days) {
      return threshold.type;
    }
  }
  return null;
}

/**
 * Check if an alert has already been sent for this certificate + threshold.
 * If not, send the notification and record the alert.
 *
 * Returns true if a new alert was sent, false if deduplicated (already sent).
 */
export async function sendCertAlertIfNew(
  certificateId: string,
  alertType: AlertType,
  channel: string,
  notificationData: Record<string, unknown>,
): Promise<boolean> {
  // Check for existing alert
  const existing = await prisma.certAlert.findUnique({
    where: {
      certificateId_alertType: {
        certificateId,
        alertType,
      },
    },
  });

  if (existing) {
    log.debug('Alert already sent, suppressing', { certificateId, alertType });
    return false;
  }

  // Record the alert
  await prisma.certAlert.create({
    data: {
      certificateId,
      alertType,
      channel,
    },
  });

  // Enqueue notification
  await notificationsQueue.add('cert-expiry', {
    certificateId,
    alertType,
    channel,
    ...notificationData,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
  });

  log.info('Cert expiry alert sent', { certificateId, alertType, channel });
  return true;
}

/**
 * Process certificate expiry alerts for a given certificate.
 * Checks the current expiry date and sends alerts for any new thresholds crossed.
 */
export async function processCertExpiryAlerts(
  certificateId: string,
  subjectCn: string,
  notAfter: Date,
  orgId: string,
): Promise<number> {
  const daysUntilExpiry = Math.floor((notAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  let alertsSent = 0;

  for (const threshold of EXPIRY_THRESHOLDS) {
    if (daysUntilExpiry <= threshold.days) {
      const sent = await sendCertAlertIfNew(certificateId, threshold.type, 'slack', {
        orgId,
        subjectCn,
        daysUntilExpiry,
        notAfter: notAfter.toISOString(),
      });
      if (sent) alertsSent++;
    }
  }

  return alertsSent;
}
