import type { T } from "@/lib/i18n";
import { CURRENCIES, ORG_TYPES, SECTORS } from "@/lib/template";
import { VatFields } from "./VatFields";

type Company = {
  name: string; registrationNo: string; tin: string; orgType: string; sector: string; country: string; city: string;
  address: string; phone: string; email: string; currency: string; vatRegistered: boolean; vatRate: number;
};

/** The organisation profile, shared by onboarding and settings. */
export function CompanyFields({ t, c }: { t: T; c?: Company }) {
  return (
    <>
      <div className="fields">
        <label className="f">{t("co_name")}<input id="co-name" name="name" defaultValue={c?.name} required /></label>
        <label className="f">{t("org_type")}
          <select id="co-orgType" name="orgType" defaultValue={c?.orgType ?? "company"}>{ORG_TYPES.map((o) => <option key={o} value={o}>{t(`org_${o}`)}</option>)}</select></label>
        <label className="f">{t("sector")}
          <select id="co-sector" name="sector" defaultValue={c?.sector ?? ""} required><option value="">—</option>{SECTORS.map((s) => <option key={s} value={s}>{t(`sec_${s}`)}</option>)}</select></label>
        <label className="f">{t("co_reg")}<input id="co-reg" name="registrationNo" defaultValue={c?.registrationNo} /></label>
        <label className="f">{t("tax_id_optional")}<input id="co-tin" name="tin" defaultValue={c?.tin} /></label>
      </div>
      <div className="fields">
        <label className="f">{t("country")}<input id="co-country" name="country" autoComplete="country-name" defaultValue={c?.country} required /></label>
        <label className="f">{t("city")}<input id="co-city" name="city" autoComplete="address-level2" defaultValue={c?.city} /></label>
        <label className="f">{t("address")}<input id="co-address" name="address" autoComplete="street-address" defaultValue={c?.address} /></label>
        <label className="f">{t("phone")}<input id="co-phone" name="phone" type="tel" defaultValue={c?.phone} /></label>
        <label className="f">{t("email")}<input id="co-email" name="email" type="email" defaultValue={c?.email} /></label>
        <label className="f">{t("home_currency")}
          <select id="co-currency" name="currency" defaultValue={c?.currency ?? "USD"}>{CURRENCIES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      <VatFields labels={{ vat: t("co_vat"), rate: t("co_rate"), yes: t("yes"), no: t("no") }} registered={c?.vatRegistered} rate={c?.vatRate} />
    </>
  );
}
