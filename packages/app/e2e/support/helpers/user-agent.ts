import type { Page } from "@playwright/test";

/** A Mac Chrome user agent, for the app's Mac bindings on any host. */
export const MAC_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Pins `navigator.platform` for every load of `page`, keeping its user agent. The app takes a Mac
 * platform for a Mac whatever the user agent says, so a Mac host would otherwise get the Mac
 * bindings. Call before the first navigation.
 */
export async function pinPlatform(page: Page, platform: "Win32" | "MacIntel"): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  // Kept open: the override lasts as long as the session that set it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setUserAgentOverride", { userAgent, platform });
}
