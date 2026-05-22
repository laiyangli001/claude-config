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

  // 等待附件出现
  const attachSel = '[class*="attachment"], [class*="file-preview"]';
  for (let i = 0; i < 15; i++) {
    const count = await page.locator(attachSel).count().catch(() => 0);
    if (count >= filePaths.length) break;
    await new Promise(r => setTimeout(r, 1000));
  }
}
