// 共享：角色模板 & 提示词模板
import * as fs from "fs";
import * as path from "path";

/**
 * 加载角色模板
 * @param {string} rolesDir
 * @param {string} roleName
 * @returns {string|null}
 */
export function loadRole(rolesDir, roleName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(roleName)) return null;
  const filePath = path.join(rolesDir, `${roleName}.md`);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 加载提示词模板（从 templates/ 目录）
 * @param {string} templatesDir
 * @param {string} templateName
 * @returns {string|null}
 */
export function loadTemplate(templatesDir, templateName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(templateName)) return null;
  const filePath = path.join(templatesDir, `${templateName}.md`);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
