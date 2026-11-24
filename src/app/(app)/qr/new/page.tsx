import Link from "next/link";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { DEFAULT_STYLE } from "@/lib/qr";
import { ErrorNote, PageHead } from "@/components/ui";
import { saveQr } from "../actions";
import { QrBuilder } from "../QrBuilder";
import { qrLabels } from "../labels";

export const metadata = { title: "New QR code" };

export default async function NewQrPage({ searchParams }: { searchParams: SearchParams }) {
  await requireView("qr");
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  return (
    <div className="stack">
      <PageHead title={t("qr_new")}><Link className="btn ghost" href="/qr">{t("back")}</Link></PageHead>
      <ErrorNote message={err(q("error"))} />
      <QrBuilder action={saveQr} shortLink={null} labels={qrLabels(t)} initial={{ name: "", type: "url", data: {}, dynamic: true, style: DEFAULT_STYLE }} />
    </div>
  );
}
