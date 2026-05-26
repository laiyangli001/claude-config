// 共享：文件上传
import * as path from "path";
import * as fs from "fs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const MAX_FILE_COUNT = 10;

/**
 * 上传文件到 AI 聊天页
 * @param {import("playwright").Page} page
 * @param {string[]} filePaths
 * @param {object} opts
 * @param {string} [opts.fileInputSelector='input[type="file"]']
 * @param {string} [opts.duplicateBtnSelector]
 */
export async function uploadFiles(page, filePaths, opts = {}) {
  if (filePaths.length === 0) return;

  if (filePaths.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files: ${filePaths.length} (max ${MAX_FILE_COUNT})`);
  }
  let totalSize = 0;
  for (const fp of filePaths) {
    if (!path.isAbsolute(fp)) throw new Error(`Path must be absolute: ${fp}`);
    if (!fs.existsSync(fp)) throw new Error(`File not found: ${fp}`);
    const size = fs.statSync(fp).size;
    if (size > MAX_FILE_SIZE) throw new Error(`File ${path.basename(fp)} exceeds 100MB`);
    totalSize += size;
  }
  if (totalSize > MAX_TOTAL_SIZE) throw new Error(`Total upload exceeds 100MB limit`);

  const sel = opts.fileInputSelector || 'input[type="file"]';
  const fileInput = page.locator(sel).first();

  if ((await fileInput.count()) === 0) {
    // 可能需要先点 plus 按钮
    const plusBtn = page.locator('[data-testid="composer-plus-btn"]').first();
    if ((await plusBtn.count()) > 0 && (await plusBtn.isVisible())) {
      await plusBtn.click();
      await page.waitForSelector(sel, { timeout: 5000 });
    } else {
      throw new Error("No file input found");
    }
  }

  await fileInput.setInputFiles([]);
  await fileInput.setInputFiles(filePaths);
  await fileInput.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));

  // 处理重复文件对话框
  if (opts.duplicateBtnSelector) {
    try {
      const dupBtn = page.locator(opts.duplicateBtnSelector).first();
      if ((await dupBtn.count()) > 0 && (await dupBtn.isVisible())) {
        await dupBtn.click();
      }
    } catch {}
  }

  // 等附件出现（最多 5 秒）
  const attachSel = '[class*="attachment"], [class*="file-preview"]';
  for (let i = 0; i < 10; i++) {
    const count = await page.locator(attachSel).count().catch(() => 0);
    if (count >= filePaths.length) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // 上传验证：确认每个文件名确实出现在页面上
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const basenames = filePaths.map(fp => path.basename(fp));
  const missing = basenames.filter(name => !pageText.includes(name));
  if (missing.length > 0) {
    // 再等 3 秒重试一次（可能上传有延迟）
    await new Promise(r => setTimeout(r, 3000));
    const pageText2 = await page.evaluate(() => document.body.innerText).catch(() => "");
    const stillMissing = missing.filter(name => !pageText2.includes(name));
    if (stillMissing.length > 0) {
      throw new Error(`文件上传验证失败，以下文件名未在页面中检测到: ${stillMissing.join(", ")}`);
    }
  }
}
