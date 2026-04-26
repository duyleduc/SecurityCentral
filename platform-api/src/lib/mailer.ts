import { getNotificationTransport, getFromHeader, isMailEnabled } from './mailer-shared.js';

export { isMailEnabled };

interface SendInvitationArgs {
  readonly to: string;
  readonly inviteeName: string;
  readonly orgName: string;
  readonly inviterName: string;
  readonly role: 'member' | 'admin';
  readonly acceptUrl: string;
  readonly expiresAt: Date;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderInvitationHtml(args: SendInvitationArgs): string {
  const { inviteeName, orgName, inviterName, role, acceptUrl, expiresAt } = args;
  return `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f6f8fa; margin:0; padding:32px;">
    <table role="presentation" style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:8px; padding:32px; border:1px solid #e5e7eb;">
      <tr><td>
        <h2 style="margin:0 0 8px; color:#111827;">Join ${escapeHtml(orgName)} on SecurityCentral</h2>
        <p style="margin:0 0 16px; color:#4b5563; line-height:1.5;">
          Hi ${escapeHtml(inviteeName)}, ${escapeHtml(inviterName)} invited you to join
          <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(role)}</strong>.
        </p>
        <p style="margin:0 0 24px; color:#4b5563;">
          Click the button below to set your password and join the organization.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${acceptUrl}"
             style="background:#2563eb; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-weight:600; display:inline-block;">
            Accept invitation
          </a>
        </p>
        <p style="margin:0 0 8px; color:#6b7280; font-size:13px;">
          Or paste this link into your browser:<br>
          <span style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all;">${acceptUrl}</span>
        </p>
        <p style="margin:24px 0 0; color:#9ca3af; font-size:12px; border-top:1px solid #e5e7eb; padding-top:16px;">
          This link expires on ${expiresAt.toUTCString()}. If you weren't expecting this invitation, you can safely ignore this email.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderInvitationText(args: SendInvitationArgs): string {
  const { inviteeName, orgName, inviterName, role, acceptUrl, expiresAt } = args;
  return [
    `Hi ${inviteeName},`,
    '',
    `${inviterName} invited you to join ${orgName} on SecurityCentral as a ${role}.`,
    '',
    'Accept the invitation and set your password here:',
    acceptUrl,
    '',
    `This link expires on ${expiresAt.toUTCString()}.`,
    '',
    "If you weren't expecting this, you can safely ignore this email.",
  ].join('\n');
}

export async function sendInvitationEmail(args: SendInvitationArgs): Promise<void> {
  const tx = getNotificationTransport();
  if (!tx) return;

  await tx.sendMail({
    from: getFromHeader(),
    to: args.to,
    subject: `You're invited to join ${args.orgName} on SecurityCentral`,
    html: renderInvitationHtml(args),
    text: renderInvitationText(args),
  });
}
