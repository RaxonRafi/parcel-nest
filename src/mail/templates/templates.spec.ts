import {
  claimAccountTemplate,
  courierDecisionTemplate,
  verifyEmailTemplate,
} from './account.template';
import { escapeHtml } from './layout.template';
import { parcelStatusEmail } from './parcel-status.template';
import { passwordResetEmail } from './password-reset.template';

const HOSTILE = '<img src=x onerror=alert(1)>';

describe('email templates', () => {
  describe('escapeHtml', () => {
    it('neutralises markup', () => {
      expect(escapeHtml(`a & b <i>"q"</i>`)).toBe(
        'a &amp; b &lt;i&gt;&quot;q&quot;&lt;/i&gt;',
      );
    });
  });

  describe('verifyEmailTemplate', () => {
    const mail = verifyEmailTemplate('Jane', 'https://app/verify?token=t', 24);

    it('carries the link in both bodies', () => {
      expect(mail.html).toContain('https://app/verify?token=t');
      expect(mail.text).toContain('https://app/verify?token=t');
    });

    it('says how long the link lasts', () => {
      expect(mail.html).toContain('24 hours');
      expect(mail.text).toContain('24 hours');
    });

    it('escapes the name in the HTML body', () => {
      const hostile = verifyEmailTemplate(HOSTILE, 'https://app/v', 24);

      expect(hostile.html).not.toContain(HOSTILE);
      expect(hostile.html).toContain('&lt;img');
    });
  });

  describe('claimAccountTemplate', () => {
    const mail = claimAccountTemplate(
      'Jane',
      'John Sender',
      'TRK-1',
      'https://app/reset?token=t',
      '7 days',
    );

    it('names the sender, the parcel and the deadline', () => {
      expect(mail.subject).toContain('John Sender');
      for (const body of [mail.html, mail.text]) {
        expect(body).toContain('TRK-1');
        expect(body).toContain('7 days');
        expect(body).toContain('https://app/reset?token=t');
      }
    });

    it('escapes the sender’s name, which the sender chose', () => {
      const hostile = claimAccountTemplate('Jane', HOSTILE, 'TRK-1', 'u', '7 days');

      expect(hostile.html).not.toContain(HOSTILE);
    });
  });

  describe('courierDecisionTemplate', () => {
    it('sends an approved courier to their dashboard', () => {
      const mail = courierDecisionTemplate('Cal', true, 'https://app/dashboard');

      expect(mail.subject).toMatch(/approved/);
      expect(mail.html).toContain('https://app/dashboard');
      expect(mail.text).toContain('https://app/dashboard');
    });

    it('tells a rejected applicant their account still works, with no button', () => {
      const mail = courierDecisionTemplate('Cal', false, 'https://app/dashboard');

      expect(mail.subject).not.toMatch(/approved/);
      expect(mail.text).toMatch(/apply again/);
      expect(mail.html).not.toContain('https://app/dashboard');
      expect(mail.text).not.toContain('https://app/dashboard');
    });
  });

  describe('passwordResetEmail', () => {
    const mail = passwordResetEmail('Jane', 'https://app/reset?token=t', 30);

    it('carries the link and its lifetime', () => {
      for (const body of [mail.html, mail.text]) {
        expect(body).toContain('https://app/reset?token=t');
        expect(body).toContain('30 minutes');
      }
    });

    it('reassures someone who did not ask for it', () => {
      expect(mail.text).toMatch(/ignore this email/);
    });

    it('escapes the name', () => {
      expect(passwordResetEmail(HOSTILE, 'u', 30).html).not.toContain(HOSTILE);
    });
  });

  describe('parcelStatusEmail', () => {
    const base = {
      recipientName: 'Jane',
      trackingId: 'TRK-1',
      status: 'OUT_FOR_DELIVERY',
      trackingUrl: 'https://app/track/TRK-1',
    };

    it('leads with what happened and which parcel', () => {
      const mail = parcelStatusEmail(base);

      expect(mail.subject).toBe('Your parcel is out for delivery — TRK-1');
      expect(mail.html).toContain('https://app/track/TRK-1');
      expect(mail.text).toContain('Track it here: https://app/track/TRK-1');
    });

    it('mentions the courier and the note only when there are any', () => {
      const bare = parcelStatusEmail(base);
      expect(bare.text).not.toContain('Courier:');
      expect(bare.text).not.toContain('Note:');

      const full = parcelStatusEmail({
        ...base,
        courierName: 'Cal',
        note: 'Call on arrival',
      });
      expect(full.text).toContain('Courier: Cal');
      expect(full.text).toContain('Note: Call on arrival');
      expect(full.html).toContain('currently with Cal');
    });

    it('falls back to a neutral headline for a status it does not know', () => {
      expect(parcelStatusEmail({ ...base, status: 'TELEPORTED' }).subject).toBe(
        'Parcel update — TRK-1',
      );
    });

    it('escapes the note, which a courier typed', () => {
      const mail = parcelStatusEmail({ ...base, note: HOSTILE });

      expect(mail.html).not.toContain(HOSTILE);
    });
  });
});
