import type { BrowserContext, Page } from '@playwright/test';

import { expect, FACE_ID_LOCK_SECS, test } from './hub';
import { pair } from './phone';

/** A passkey for this page, standing in for the iPhone's Face ID: it says
 * yes to every check, as Face ID does for you. */
async function faceId(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('Face ID locks Airlock, and only this phone unlocks it', async ({ page, context, browser, hub }) => {
  await faceId(context, page);
  await pair(page, hub, 'E2E phone', hub.localUrl);

  // Offered once paired; setting it up keeps this phone unlocked.
  const offer = page.getByRole('region', { name: 'Lock Airlock with Face ID' });
  await offer.getByRole('button', { name: 'Set up Face ID' }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  expect(hub.airlock('devices')).toContain('Face ID');

  // Someone copies the device cookie (not the unlock) into another browser.
  const copied = (await context.cookies()).filter((cookie) => cookie.name === 'airlock_device');
  expect(copied).toHaveLength(1);
  const thief = await browser.newContext();
  await thief.addCookies(copied);
  const stolen = await thief.request.get(`${hub.localUrl}/api/terminals`);
  expect(stolen.status(), 'the copy gets nothing, even while the phone is unlocked').toBe(423);

  // The phone goes quiet past the lock time, then comes back: locked.
  await page.goto('about:blank');
  await page.waitForTimeout((FACE_ID_LOCK_SECS + 1.5) * 1000);
  await page.goto(hub.localUrl);
  await expect(page.getByText(/^Locked/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeHidden();

  // Face ID unlocks it.
  await page.getByRole('button', { name: 'Unlock with Face ID' }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  // Leaving Airlock (another app, the phone locking) locks it at once, on
  // the phone and on the laptop: a reload still asks for Face ID.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Unlock with Face ID' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlock with Face ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Unlock with Face ID' }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  // The copy still gets nothing.
  expect((await thief.request.get(`${hub.localUrl}/api/terminals`)).status()).toBe(423);
  await thief.close();
});

test('putting Face ID off hides the offer', async ({ page, hub }) => {
  await pair(page, hub, 'E2E phone', hub.localUrl);
  const offer = page.getByRole('region', { name: 'Lock Airlock with Face ID' });
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(offer).toBeHidden();
});
