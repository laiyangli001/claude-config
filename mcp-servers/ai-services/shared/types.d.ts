declare module "../../shared/browser.mjs" {
  export function launchBrowser(profileDir: string, headless?: boolean): Promise<import("playwright").BrowserContext>;
  export function closeBrowser(ctx: import("playwright").BrowserContext | null): Promise<void>;
}
declare module "../../shared/answer.mjs" {
  export function waitForAnswer(page: import("playwright").Page, answerSelector: string, stopBtnSelector: string): Promise<void>;
  export function extractNewAnswers(page: import("playwright").Page, selector: string, startIndex: number): Promise<string>;
}
declare module "../../shared/upload.mjs" {
  export function uploadFiles(page: import("playwright").Page, filePaths: string[], opts?: { fileInputSelector?: string; duplicateBtnSelector?: string }): Promise<void>;
}
declare module "../../shared/role.mjs" {
  export function loadRole(rolesDir: string, roleName: string): string | null;
}
