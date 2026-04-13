/**
 * Playwright 기반 스크린샷 렌더러
 * 변경된 노드만 캡처하여 PNG로 저장
 */

import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { join } from "path";

export interface ScreenshotResult {
  nodeId: string;
  nodeName: string;
  path: string;
}

/**
 * HTML 문자열을 렌더링하고 특정 노드들의 스크린샷을 찍는다
 */
export async function screenshotNodes(
  html: string,
  nodeIds: string[],
  outputDir: string,
  prefix: string
): Promise<ScreenshotResult[]> {
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 3000, height: 4000 },
    deviceScaleFactor: 2,
  });

  await page.setContent(html, { waitUntil: "networkidle" });

  // Wait for fonts + icons to load
  await page.evaluate(() =>
    document.fonts.ready.then(() => {
      // Trigger Lucide icon rendering if available
      if (typeof (window as unknown as Record<string, unknown>).lucide !== "undefined") {
        (window as unknown as Record<string, { createIcons: () => void }>).lucide.createIcons();
      }
      return new Promise((r) => setTimeout(r, 1000));
    })
  );

  const results: ScreenshotResult[] = [];

  for (const nodeId of nodeIds) {
    const el = page.locator(`[data-pen-id="${nodeId}"]`).first();
    const isVisible = await el.isVisible().catch(() => false);
    if (!isVisible) continue;

    const name = (await el.getAttribute("data-pen-name")) ?? nodeId;
    const filename = `${prefix}-${nodeId}.png`;
    const filepath = join(outputDir, filename);

    await el.screenshot({ path: filepath, omitBackground: true });
    results.push({ nodeId, nodeName: name, path: filepath });
  }

  await browser.close();
  return results;
}

/**
 * 전체 페이지 스크린샷 (디버그/풀 프리뷰용)
 */
export async function screenshotFullPage(
  html: string,
  outputPath: string
): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 3000, height: 4000 },
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() =>
    document.fonts.ready.then(() => {
      if (typeof (window as unknown as Record<string, unknown>).lucide !== "undefined") {
        (window as unknown as Record<string, { createIcons: () => void }>).lucide.createIcons();
      }
      return new Promise((r) => setTimeout(r, 1000));
    })
  );
  await page.screenshot({ path: outputPath, fullPage: true });
  await browser.close();
}
