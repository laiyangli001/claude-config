// 共享：角色模板
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
