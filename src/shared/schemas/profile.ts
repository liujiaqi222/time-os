import { z } from "zod";

export const userNameSchema = z
  .string()
  .trim()
  .min(1, "请输入你的名称。")
  .max(40, "名称最多 40 个字符。");
