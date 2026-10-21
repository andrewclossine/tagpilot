import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { dict, type Key } from "./i18n-dict";
import { money as fmtMoney, type Lang } from "./format";

export type { Key };
export type T = (key: Key) => string;

export const getI18n = cache(async () => {
  const lang: Lang = (await cookies()).get("konti_lang")?.value === "fr" ? "fr" : "en";
  const t: T = (key) => dict[lang][key] ?? dict.en[key] ?? key;
  /** Shows an error key coming back from an action, or the generic message for anything unknown. */
  const err = (key?: string | null) => (key ? (key in dict.en ? t(key as Key) : t("err_generic")) : "");
  const accName = (a: { nameEn: string; nameFr: string }) => (lang === "fr" && a.nameFr ? a.nameFr : a.nameEn);
  const money = (n: number | null | undefined, decimals = 0) => fmtMoney(n, lang, decimals);
  return { lang, t, err, accName, money };
});
