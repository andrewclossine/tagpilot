import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import type { AccountKind } from "@/lib/account-kinds";
import { pickerLabels } from "@/lib/picker-labels";
import { AccountPicker, type PickAccount, type PickerLabels } from "./AccountPicker";

/** The words of the account picker, and whether this person may add accounts. */
export async function pickerProps(): Promise<{ labels: PickerLabels; canAdd: boolean }> {
  const { t } = await getI18n();
  const ctx = await getCtx();
  return { canAdd: ctx.can("accounts", "write"), labels: pickerLabels(t) };
}

type Row = { id?: string; code: string; nameEn?: string; nameFr?: string; name?: string; type: string; subtype?: string | null };

/** Accounts from the database as the picker shows them, in the reader's language, with an optional note each. */
export async function pickAccounts(rows: Row[], note?: (a: Row) => string | undefined): Promise<PickAccount[]> {
  const { accName } = await getI18n();
  return rows.map((a) => ({ id: a.id ?? a.code, code: a.code, name: a.name ?? accName({ nameEn: a.nameEn ?? a.code, nameFr: a.nameFr ?? "" }), type: a.type, subtype: a.subtype ?? null, note: note?.(a) }));
}

/** An account list on a server-rendered form: the account type beside each account and "+ Add new account". */
export async function AccountField({ accounts, note, noAdd, ...rest }: {
  accounts: Row[]; note?: (a: Row) => string | undefined; name?: string; id: string; defaultValue?: string; required?: boolean;
  disabled?: boolean; placeholder?: string; onlyTypes?: readonly string[]; kinds?: readonly AccountKind[]; by?: "id" | "code"; /** No "+ Add new account" here (a list a new account could not belong to, such as foreign-currency banks). */ noAdd?: boolean; style?: React.CSSProperties; className?: string; form?: string;
}) {
  const [{ labels, canAdd }, list] = await Promise.all([pickerProps(), pickAccounts(accounts, note)]);
  return <AccountPicker {...rest} accounts={list} labels={labels} canAdd={canAdd && !noAdd} />;
}
