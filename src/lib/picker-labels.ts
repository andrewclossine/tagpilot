import type { Key, T } from "./i18n";
import { ACCOUNT_KINDS } from "./account-kinds";

const ERRORS = ["err_acc_kind", "err_acc_name", "err_acc_code", "err_acc_code_used", "err_acc_name_used", "err_forbidden", "err_generic"] as const;

/** The words of the account picker: account types, and the "+ Add new account" form. */
export function pickerLabels(t: T) {
  return {
    kinds: Object.fromEntries(ACCOUNT_KINDS.map((k) => [k, t(`acck_${k}` as Key)])),
    add: t("acc_pick_add"), title: t("acc_pick_title"), kind: t("acc_pick_kind"), code: t("code"), codeHelp: t("acc_pick_code_help"),
    name: t("name"), save: t("save"), cancel: t("cancel"), choose: t("choose"),
    errors: Object.fromEntries(ERRORS.map((e) => [e, t(e as Key)])),
  };
}
